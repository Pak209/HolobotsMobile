using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Holobots.Sim.Fight;
using Holobots.Sim.Ai;

/// fight-host-1 cold oracle: the C# duel-sim-3 core + fight-ai-1 brain + fight-input-1 codec (fight-tune-1 0bae2cc16)
/// compiled off-editor, used ONLY to (1) re-check the 14 frozen vectors, (2) emit supplemental brain-driven vectors and
/// real duel-inputs-2 logs for the TS twin, (3) record the C# decoder's refusal code for every invalid fixture case.
static class Oracle
{
    static int Main(string[] args)
    {
        switch (args[0])
        {
            case "vectors": return Vectors(args[1]);
            case "brain": return Brain(args[1]);
            case "codes": return Codes(args[1], args[2]);
            case "profiles": Console.WriteLine(ProfilesJson().ToString(Formatting.Indented)); return 0;
            case "bench": return Bench();
            case "state": return State(args[1], int.Parse(args[2]), args.Length > 3 ? args[3] : null);
        }
        return 2;
    }

    static FightResult RunDoc(JObject doc)
    {
        var rules = FightRules.FromJson((JObject)doc["rules"]); string seed = (string)doc["seed"];
        bool cpu = (string)doc["drivers"][0] == "stub-brain";
        var script = FightScript.FromJson((JArray)doc["script"]);
        return FightRunner.Run(rules, seed, cpu ? FightDriver.Of(new FightStubBrain(), default, default) : FightDriver.Of(script),
            cpu ? FightDriver.Of(new FightStubBrain(), default, default) : FightDriver.Of(script), tickHashes: true);
    }

    static int Vectors(string dir)
    {
        var idx = JObject.Parse(File.ReadAllText(Path.Combine(dir, "index.json")));
        int bad = 0;
        foreach (var n in idx["vectors"])
        {
            var doc = JObject.Parse(File.ReadAllText(Path.Combine(dir, (string)n + ".json")));
            var r = RunDoc(doc); var ex = doc["expected"];
            bool ok = r.FinalHash == (string)ex["finalHash"] && r.InitialHash == (string)ex["initialHash"] && r.RulesHash == (string)ex["rulesHash"] && JToken.DeepEquals(r.Witness.ToJson(), ex["witness"]);
            if (ex["tickHashes"] is JArray all) for (int i = 0; i < all.Count; i++) ok &= r.TickHashes[i] == (string)all[i];
            Console.WriteLine((ok ? "OK   " : "FAIL ") + n);
            if (!ok) bad++;
        }
        return bad;
    }

    public static JObject ProfileJson(Holobots.Sim.Fight.FightProfile p) => new JObject
    {
        ["id"] = p.Id, ["aggressionPmPerSec"] = p.AggressionPmPerSec, ["engageMinStaminaPm"] = p.EngageMinStaminaPm, ["preferredBand"] = (int)p.PreferredBand,
        ["preferredBandOffsetMm"] = p.PreferredBandOffsetMm, ["chainMeanMilli"] = p.ChainMeanMilli, ["heavyRatioPm"] = p.HeavyRatioPm, ["feintRatePm"] = p.FeintRatePm,
        ["guardRatePm"] = p.GuardRatePm, ["counterRatePm"] = p.CounterRatePm, ["breakAtStaminaPm"] = p.BreakAtStaminaPm, ["circleBiasPm"] = p.CircleBiasPm,
        ["shoveRatePm"] = p.ShoveRatePm, ["specialPolicy"] = p.SpecialPolicy, ["beatSharePm"] = p.BeatSharePm, ["burstInPm"] = p.BurstInPm, ["lowHpRiskPm"] = p.LowHpRiskPm,
        ["escapeRatePm"] = p.EscapeRatePm, ["chargeSharePm"] = p.ChargeSharePm,   // duel-sim-3 r3 (fight-tune-2)
    };
    public static JObject SkillJson(FightSkill s) => new JObject { ["rank"] = s.Rank, ["reactionTicks"] = s.ReactionTicks, ["feintReadPm"] = s.FeintReadPm, ["perfectGuardPm"] = s.PerfectGuardPm };

    static JObject ProfilesJson()
    {
        var ps = new JArray(); foreach (var p in FightProfiles.All()) { var j = ProfileJson(FightProfiles.ToIssued(p)); j["style"] = p.Style; ps.Add(j); }
        var rs = new JArray(); foreach (var r in FightRankSkill.Table()) rs.Add(SkillJson(FightRankSkill.ToIssued(r)));
        return new JObject { ["profiles"] = ps, ["ranks"] = rs, ["profilesVersion"] = FightProfiles.Version };
    }

    static Holobots.Sim.Fight.FightProfile Prof(string id) => FightProfiles.ToIssued(FightProfiles.Get(id));
    static FightSkill Skill(string rank) => FightRankSkill.ToIssued(FightRankSkill.Get(rank));

    static string Seed(int i) => unchecked((uint)i * 2246822519u).ToString("x8") + "f1f2f3f4" + new string('0', 40) + i.ToString("x8");

    sealed class BrainSpec { public string Name, Note; public FightRules Rules; public string Seed; public string[] Prof = new string[2]; public string[] Rank = new string[2]; public bool Log; public int DeployAt = -1; }

    /// Deploy picks injected into a tapped brain's stream (the player's bench swap) at a fixed tick.
    sealed class DeployTap : IFightBrain
    {
        readonly IFightBrain inner; readonly int at; readonly byte to;
        public readonly List<FightTickRecord> Decisions = new List<FightTickRecord>();
        public DeployTap(IFightBrain inner, int at, byte to) { this.inner = inner; this.at = at; this.to = to; }
        public void Begin(int side, Holobots.Sim.Fight.FightProfile p, FightSkill s) => inner.Begin(side, p, s);
        public FightInput Decide(FightView v, FightRng rng)
        {
            var i = inner.Decide(v, rng);
            if (v.Tick + 1 == at) i.Deploy = to;
            Decisions.Add(i.ToRecord()); return i;
        }
    }

    sealed class RecInputs : IFightInputs
    {
        readonly List<FightTickRecord> r; public RecInputs(List<FightTickRecord> r) { this.r = r; }
        public FightInput Read(int tick, int side) => tick < r.Count ? r[tick].ToInput() : FightInput.Idle;
    }

    static FightRules Stats(FightRules r, int hp0, int atk0, int def0, int hp1, int atk1, int def1)
    {
        foreach (var f in r.Fighters)
        {
            if (f.Side == 0) { f.MaxHp = hp0; f.Hp = hp0; f.Attack = atk0; f.Defense = def0; }
            else { f.MaxHp = hp1; f.Hp = hp1; f.Attack = atk1; f.Defense = def1; }
        }
        return r;
    }

    static int Brain(string outPath)
    {
        var specs = new List<BrainSpec>();
        string[][] pairs = { new[] { "wolf", "kuma" }, new[] { "shadow", "ken" }, new[] { "ace", "hare" }, new[] { "tora", "era" }, new[] { "kurai", "gama" }, new[] { "jusan", "wake" }, new[] { "tsuin", "wolf" } };
        string[] ranks = { "Rookie", "Starter", "Champion", "Rare", "Elite", "Legendary", "Champion" };
        for (int i = 0; i < pairs.Length; i++)
        {
            var r = FightRules.Default(pairs[i][0], pairs[i][1]); r.MaxTicks = 1800;
            if (i % 2 == 1) Stats(r, 620, 88, 40, 540, 95, 35);
            specs.Add(new BrainSpec { Name = "brain-" + pairs[i][0] + "-" + pairs[i][1], Note = "FightCoreBrain vs FightCoreBrain, " + ranks[i] + "/" + ranks[(i + 2) % 6] + ", 60 s cap", Rules = r, Seed = Seed(i + 1),
                Prof = pairs[i], Rank = new[] { ranks[i], ranks[(i + 2) % 6] } });
        }
        {
            var sq = FightRules.Squad(new[] { "ace", "kuma", "tora" }, new[] { "wolf", "hare", "ken" }); sq.MaxTicks = 3600; Stats(sq, 260, 120, 30, 240, 125, 30);
            specs.Add(new BrainSpec { Name = "brain-squad-3v3", Note = "3v3 brains, low HP: forced swaps on KO, 120 s cap", Rules = sq, Seed = Seed(20), Prof = new[] { "ace", "wolf" }, Rank = new[] { "Elite", "Rare" } });
        }
        // duel-inputs-2 logs: side 0 = a tapped brain recorded as the PLAYER's inputs, side 1 = the CPU brain (recorded for parity)
        string[][] lp = { new[] { "ace", "wolf" }, new[] { "hare", "shadow" }, new[] { "kuma", "jusan" } };
        string[] lr = { "Rookie", "Champion", "Legendary" };
        for (int i = 0; i < lp.Length; i++)
        {
            var r = FightRules.Default(lp[i][0], lp[i][1]); r.MaxTicks = 5400; Stats(r, 480 + 40 * i, 90, 45, 450, 85 + 5 * i, 40);
            specs.Add(new BrainSpec { Name = "log-" + lp[i][0] + "-vs-cpu-" + lp[i][1], Note = "player log (a tapped brain as the player) vs CPU brain " + lr[i], Rules = r, Seed = Seed(30 + i), Prof = lp[i], Rank = new[] { "Champion", lr[i] }, Log = true });
        }
        {
            var sq = FightRules.Squad(new[] { "ace", "kuma" }, new[] { "wolf", "gama", "kurai" }); sq.MaxTicks = 5400; Stats(sq, 300, 110, 35, 260, 105, 30);
            specs.Add(new BrainSpec { Name = "log-squad-deploy", Note = "player 2-bot log with a voluntary bench deploy at tick 120 vs CPU 3-bot squad (Elite)", Rules = sq, Seed = Seed(40), Prof = new[] { "ace", "wolf" }, Rank = new[] { "Champion", "Elite" }, Log = true, DeployAt = 120 });
        }

        var outArr = new JArray();
        foreach (var s in specs)
        {
            var p0 = Prof(s.Prof[0]); var p1 = Prof(s.Prof[1]); var k0 = Skill(s.Rank[0]); var k1 = Skill(s.Rank[1]);
            IFightBrain b0 = new FightCoreBrain(); var tap1 = new FightBrainTap(new FightCoreBrain());
            DeployTap tap0 = null; FightBrainTap tap0b = null;
            if (s.Log) { if (s.DeployAt >= 0) { tap0 = new DeployTap(b0, s.DeployAt, 1); b0 = tap0; } else { tap0b = new FightBrainTap(b0); b0 = tap0b; } }
            var res = FightRunner.Run(s.Rules, s.Seed, FightDriver.Of(b0, p0, k0), FightDriver.Of(tap1, p1, k1), tickHashes: true);
            List<FightTickRecord> rec0 = null;
            if (s.Log)
            {
                // A logged side never draws (the player presses; no brain): run 1 only produced the player's presses. Run 2 is
                // the authoritative fight: side 0 from those records, side 1 a fresh CPU brain (its own stream is unaffected).
                rec0 = tap0 != null ? tap0.Decisions : tap0b.Decisions;
                tap1 = new FightBrainTap(new FightCoreBrain());
                res = FightRunner.Run(s.Rules, s.Seed, FightDriver.Of(new RecInputs(rec0)), FightDriver.Of(tap1, p1, k1), tickHashes: true);
                rec0 = rec0.Take(res.EndTick + 1).ToList();
                while (rec0.Count < res.EndTick + 1) rec0.Add(FightTickRecord.Idle);
            }
            var core = res.Core;
            var roster = new JArray();
            for (int side = 0; side < 2; side++)
            {
                var a = new JArray(); foreach (var m in core.Roster[side]) a.Add(new JObject { ["id"] = m.Def.Id, ["hp"] = m.Hp, ["sta"] = m.Sta, ["sync"] = m.Sync, ["ko"] = m.Ko });
                roster.Add(a);
            }
            var expected = new JObject
            {
                ["rulesHash"] = res.RulesHash, ["initialHash"] = res.InitialHash, ["finalHash"] = res.FinalHash, ["winner"] = res.Winner, ["reason"] = res.Reason, ["endTick"] = res.EndTick,
                ["roster"] = roster, ["active"] = new JArray(core.Active[0], core.Active[1]), ["rngDraws"] = new JArray(core.Rng[0].Draws, core.Rng[1].Draws),
                ["witness"] = res.Witness.ToJson(), ["tickHashPrefixes"] = string.Concat(res.TickHashes.Select(h => h.Substring(0, 16))),
                ["events"] = new JArray(res.Events.Select(e => e.ToString()).ToArray()),
            };
            var doc = new JObject
            {
                ["name"] = s.Name, ["note"] = s.Note, ["seed"] = s.Seed, ["rules"] = s.Rules.ToJson(),
                ["drivers"] = new JArray(new JObject { ["kind"] = s.Log ? "log" : "brain", ["profile"] = ProfileJson(p0), ["skill"] = SkillJson(k0) }, new JObject { ["kind"] = "brain", ["profile"] = ProfileJson(p1), ["skill"] = SkillJson(k1) }),
                ["expected"] = expected,
            };
            if (s.Log)
            {
                var log = new FightInputLog { RulesId = "duel-rules-3:oracle-" + s.Name, RulesHash = res.RulesHash, Seed = s.Seed, TickCount = res.EndTick + 1, HashEvery = 30, FinalHash = res.FinalHash };
                for (int k = 0; k < log.TickCount / log.HashEvery; k++) log.Hashes.Add(res.TickHashes[(k + 1) * log.HashEvery - 1].Substring(0, 16));
                var r0 = core.Roster[0].Select(m => new FightRosterEntry(m.Def.Id, null)).ToArray();
                var r1 = core.Roster[1].Select(m => new FightRosterEntry(m.Def.Id, s.Prof[1])).ToArray();
                log.Sides[0] = new FightLogSide { Side = 0, Source = "player", Rank = null, Roster = r0, Ticks = rec0.ToArray() };
                log.Sides[1] = new FightLogSide { Side = 1, Source = "cpu", Rank = k1.Rank, Roster = r1, Ticks = tap1.Decisions.ToArray() };
                var wire = log.ToWire();
                // replay check (host-shaped): side 0 from the log, side 1 a fresh brain
                var parsed = FightInputLog.Parse(wire);
                var rr = FightRunner.Run(s.Rules, s.Seed, FightDriver.Of(new FightLogInputs(parsed)), FightDriver.Of(new FightCoreBrain(), p1, k1), tickHashes: true);
                if (parsed.FirstDivergentSample(rr.TickHashes) != -1) throw new Exception("oracle self-replay diverged " + s.Name);
                doc["log"] = JObject.Parse(wire); doc["wireBytes"] = log.WireBytes;
            }
            outArr.Add(doc);
            Console.WriteLine(s.Name + ": " + res.Reason + " w" + res.Winner + " @" + res.EndTick + " " + res.FinalHash.Substring(0, 16) + " draws " + core.Rng[0].Draws + "/" + core.Rng[1].Draws + (s.Log ? " wire " + doc["wireBytes"] + " B" : ""));
        }
        var top = new JObject
        {
            ["vectorVersion"] = "duel-sim-3-brain-vectors-1",
            ["provenance"] = "fight-host-1 cold oracle (re-run by fight-tune-2, duel-sim-3 r3): HolobotsUnity claude/fight-tune-2 (stacks on PR #120 incl. #117/#118/#119 and #134) C# FightCore + FightCoreBrain/FightBrain + FightInputLog compiled with Unity 6000.5.4f1's bundled .NET 8 Roslyn, no Unity process. Supplemental to Schemas/fixtures/duel-sim-3 (which drive scripts + the stub brain only): these drive the SHIPPED brain and 13-profile table, so the host twin's CPU replay is pinned too.",
            ["profiles"] = ProfilesJson(), ["vectors"] = outArr,
        };
        File.WriteAllText(outPath, top.ToString(Formatting.None) + "\n");
        return 0;
    }

    static int Codes(string fixturePath, string outPath)
    {
        var fx = JObject.Parse(File.ReadAllText(fixturePath));
        var codes = new JObject();
        foreach (JObject c in (JArray)fx["invalid"])
        {
            string code;
            try { FightInputLog.Parse(c["log"].ToString(Formatting.None)); code = "ACCEPTED"; }
            catch (ArgumentException e) { code = e.Message; }
            catch (FormatException e) { code = "FormatException:" + e.Message; }
            codes[(string)c["name"]] = code;
        }
        var valid = new JObject();
        foreach (JObject c in (JArray)fx["valid"])
        {
            var wire = c["log"].ToString(Formatting.None); var log = FightInputLog.Parse(wire);
            valid[(string)c["name"]] = log.ToWire() == wire ? "roundtrip" : "DIFF";
        }
        File.WriteAllText(outPath, new JObject { ["invalid"] = codes, ["valid"] = valid }.ToString(Formatting.Indented) + "\n");
        Console.WriteLine(File.ReadAllText(outPath));
        return 0;
    }

    static int Bench()
    {
        var rules = FightRules.Default("wolf", "kuma"); rules.MaxTicks = 1800;
        long ticks = 0; var sw = Stopwatch.StartNew();
        for (int i = 0; i < 20; i++)
        {
            var r = FightRunner.Run(rules, Seed(i), FightDriver.Of(new FightCoreBrain(), Prof("wolf"), Skill("Champion")), FightDriver.Of(new FightCoreBrain(), Prof("kuma"), Skill("Champion")), tickHashes: true);
            ticks += r.EndTick + 1;
        }
        sw.Stop();
        Console.WriteLine("C# bench (brain vs brain, per-tick SHA-256): " + ticks + " ticks in " + sw.ElapsedMilliseconds + " ms = " + (sw.Elapsed.TotalMilliseconds * 1000.0 / ticks).ToString("F2") + " us/tick");
        return 0;
    }

    /// `state <doc.json> <tick> [vectorName]`: the C# canonical state bytes (hex) at the END of `tick`, for the host diff tool
    /// (functions/scripts/fight-sim3-diff.mjs --csharp-state). doc = a frozen duel-sim-3 vector, or the brain-vectors file + name.
    static int State(string path, int tick, string name)
    {
        var doc = JObject.Parse(File.ReadAllText(path));
        if (name != null) doc = (JObject)((JArray)doc["vectors"]).First(v => (string)v["name"] == name);
        var rules = FightRules.FromJson((JObject)doc["rules"]); string seed = (string)doc["seed"];
        FightDriver D(JToken d, int side)
        {
            if (d.Type == JTokenType.String) return (string)d == "stub-brain" ? FightDriver.Of(new FightStubBrain(), default, default) : FightDriver.Of(FightScript.FromJson((JArray)doc["script"]));
            if ((string)d["kind"] == "log") return FightDriver.Of(new FightLogInputs(FightInputLog.Parse(doc["log"].ToString(Formatting.None))));
            var p = d["profile"]; var k = d["skill"];
            var prof = FightProfiles.ToIssued(FightProfiles.Get((string)p["id"]));
            var skill = new FightSkill { Rank = (string)k["rank"], ReactionTicks = (int)k["reactionTicks"], FeintReadPm = (int)k["feintReadPm"], PerfectGuardPm = (int)k["perfectGuardPm"] };
            return FightDriver.Of(new FightCoreBrain(), prof, skill);
        }
        var d0 = D(doc["drivers"][0], 0); var d1 = D(doc["drivers"][1], 1);
        var core = new FightCore(rules, seed); var views = new[] { core.View(0), core.View(1) }; var ds = new[] { d0, d1 };
        for (int s = 0; s < 2; s++) ds[s].Brain?.Begin(s, ds[s].Profile, ds[s].Skill);
        while (!core.Ended && core.Tick < tick)
        {
            int t = core.Tick + 1; var inp = new FightInput[2];
            for (int s = 0; s < 2; s++) inp[s] = ds[s].Brain != null ? ds[s].Brain.Decide(views[s], core.Rng[s]) : ds[s].Inputs.Read(t, s);
            core.Step(inp[0], inp[1]);
        }
        Console.WriteLine(FightHash.Hex(core.StateBytes()));
        return 0;
    }
}
