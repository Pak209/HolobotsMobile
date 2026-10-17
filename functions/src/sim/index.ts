import { moveFighter, sqrtCeil } from './movement';
export * from './movement';
import { canonicalHash, randomChoice } from './encoding';
import { validate } from './validate';
import { Command, FighterState, InputLog, Move, RulesSnapshot, SimEvent, SimResult, SimState } from './types';
export * from './types';
export * from './encoding';
const moves: Move[] = ['strike', 'heavy', 'finisher'];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export function mulDiv(a: number, b: number, divisor: number): number {
    if (![a, b, divisor].every(Number.isSafeInteger) || divisor === 0)
        throw new Error('invalid_arithmetic');
    const p = BigInt(a) * BigInt(b);
    if (p < -(1n << 63n) || p > (1n << 63n) - 1n)
        throw new Error('arithmetic_overflow');
    const n = p / BigInt(divisor);
    if (n < BigInt(Number.MIN_SAFE_INTEGER) || n > BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error('arithmetic_overflow');
    return Number(n);
}
const within = (a: FighterState, b: FighterState, r: number) => { const x = BigInt(a.x - b.x), z = BigInt(a.z - b.z); return x * x + z * z <= BigInt(r) * BigInt(r); };
/** Standalone replay; caller supplies trusted immutable rules. No live host integration. */
export function simulate(rules: RulesSnapshot, seed: string, log: InputLog): SimResult {
    validate(rules, log, seed);
    const definitions = [...rules.fighters].sort((a, b) => a.id < b.id ? -1 : 1);
    const movementV2 = rules.simVersion === 'duel-sim-2';
    const state: SimState = { simVersion: rules.simVersion, rulesHash: canonicalHash({ ...rules, fighters: definitions }), seed, tick: -1, winner: null, reason: 'running', fighters: definitions.map(f => ({ id: f.id, side: f.side, deployed: f.deployed, hp: f.hp, stamina: f.stamina, sync: f.sync, x: f.x, z: f.z, facingX: 0, facingZ: 0, moveX: 0, moveZ: 0, moveUntil: 0, guardUntil: 0, guardStarted: -1, disengaged: false, readyTick: 0, stunnedUntil: 0, target: null, attack: null, ...(movementV2 ? {movement: {queued: null, dashReadyTick: 0, dashTicks: 0, dashX: 0, dashZ: 0, runRemainder: 0}} : {}) })) };
    const result: SimResult = { initialHash: canonicalHash(state), inputHash: canonicalHash(log), ticks: [], finalState: state, finalHash: '' };
    const def = (f: FighterState) => definitions.find(d => d.id === f.id)!;
    const lookup = (id: string) => state.fighters.find(f => f.id === id)!;
    let cursor = 0;
    for (let tick = 0; tick < rules.maxTicks && state.reason === 'running'; tick++) {
        state.tick = tick;
        const events: SimEvent[] = [];
        const emit = (f: FighterState, action: string, target: string | null, reason: string, damage = 0, hit = false) => events.push({ tick, actor: f.id, action, target, damage, hit, reason });
        for (const f of state.fighters) {
            if (tick >= f.moveUntil)
                f.moveX = f.moveZ = 0;
            if (tick >= f.guardUntil) {
                f.guardUntil = 0;
                f.guardStarted = -1;
            }
        }
        const cancel = (f: FighterState) => { if (!f.attack)
            return true; if (tick - f.attack.startTick < def(f).moves[f.attack.move].cancelAfterTicks)
            return false; f.attack = null; return true; };
        const command = (e: Command) => {
            const f = lookup(e.actor), d = def(f), target = e.target ? lookup(e.target) : null;
            const deny = (reason: string) => emit(f, e.action, e.target ?? null, reason);
            if (!f.deployed || f.hp === 0 || tick < f.stunnedUntil) {
                deny('inactive');
                return;
            }
            if (e.action === 'move' || e.action === 'disengage') {
                if (!cancel(f)) {
                    deny('cancel_window');
                    return;
                }
                if (f.movement) { f.movement.queued = null; f.movement.dashTicks = 0; f.movement.dashX = f.movement.dashZ = 0; }
                f.moveX = e.action === 'move' ? e.x! : 0;
                f.moveZ = e.action === 'move' ? e.z! : 0;
                f.moveUntil = tick + rules.heldTicks;
                f.disengaged = e.action === 'disengage';
                f.guardUntil = 0;
                f.guardStarted = -1;
            }
            else if (e.action === 'guard_down') {
                if (!cancel(f)) {
                    deny('cancel_window');
                    return;
                }
                if (f.movement) { f.movement.queued = null; f.movement.dashTicks = 0; f.movement.dashX = f.movement.dashZ = 0; }
                if (!f.guardUntil)
                    f.guardStarted = tick;
                f.guardUntil = tick + rules.heldTicks;
                f.moveX = f.moveZ = 0;
                f.disengaged = false;
            }
            else if (e.action === 'guard_up') {
                f.guardUntil = 0;
                f.guardStarted = -1;
            }
            else if (e.action === 'select_target') {
                if (!target!.deployed || target!.hp === 0) {
                    deny('target_inactive');
                    return;
                }
                f.target = target!.id;
            }
            else if (e.action === 'deploy') {
                if (target!.deployed || target!.hp === 0 || f.attack || tick < f.readyTick) {
                    deny('deploy_unavailable');
                    return;
                }
                // Switch to the target's host-pinned spawn; reject collision with the current opposing body.
                if (state.fighters.some(o => o.side !== f.side && o.deployed && within(target!, o, def(target!).radiusMm + def(o).radiusMm))) {
                    deny('deploy_blocked');
                    return;
                }
                if (f.movement) { f.movement.queued = null; f.movement.dashTicks = 0; f.movement.dashX = f.movement.dashZ = 0; }
                f.deployed = false;
                f.moveX = f.moveZ = 0;
                f.guardUntil = 0;
                f.guardStarted = -1;
                f.disengaged = false;
                target!.deployed = true;
            }
            else {
                const move = e.action as Move, m = d.moves[move];
                if (!target!.deployed || target!.hp === 0) {
                    deny('target_inactive');
                    return;
                }
                if (f.attack || tick < f.readyTick) {
                    deny('cooldown');
                    return;
                }
                if (f.stamina < m.staminaCost) {
                    deny('insufficient_stamina');
                    return;
                }
                if (f.sync < m.syncCost) {
                    deny('insufficient_sync');
                    return;
                }
                if (f.movement && (f.movement.dashTicks > 0 || !within(f, target!, m.rangeMm))) {
                    f.movement.queued = {move, target: target!.id};
                    f.target = target!.id;
                    f.disengaged = false;
                    f.guardUntil = 0; f.guardStarted = -1;
                    f.moveX = f.moveZ = 0;
                    emit(f, move, target!.id, 'queued_close');
                    return;
                }
                if (f.movement) f.movement.queued = null;
                f.stamina -= m.staminaCost;
                f.sync -= m.syncCost;
                f.attack = { move, target: target!.id, startTick: tick, contactTick: tick + m.windupTicks };
                f.readyTick = tick + m.windupTicks + m.recoveryTicks;
                f.target = target!.id;
                f.guardUntil = 0;
                f.guardStarted = -1;
                f.disengaged = false;
                f.moveX = f.moveZ = 0;
                f.facingX = Math.sign(target!.x - f.x);
                f.facingZ = Math.sign(target!.z - f.z);
            }
            emit(f, e.action, e.target ?? null, 'accepted');
        };
        while (cursor < log.events.length && log.events[cursor].tick === tick)
            command(log.events[cursor++]);
        if (tick % rules.cpuEveryTicks === 0)
            state.fighters.forEach((f, index) => {
                if (!def(f).cpu || !f.deployed || f.hp === 0)
                    return;
                const target = state.fighters.find(o => o.side !== f.side && o.deployed && o.hp > 0);
                if (!target)
                    return;
                const move = moves[randomChoice(seed, 1, tick, index, moves.length)];
                if (f.movement?.queued) return;
                if (movementV2 || within(f, target, def(f).moves[move].rangeMm))
                    command({ seq: 0, tick, actor: f.id, action: move, target: target.id });
                else {
                    const x = target.x - f.x, z = target.z - f.z;
                    command({ seq: 0, tick, actor: f.id, action: 'move', x: Math.abs(x) >= Math.abs(z) ? Math.sign(x) * 127 : 0, z: Math.abs(z) > Math.abs(x) ? Math.sign(z) * 127 : 0 });
                }
            });
        if (movementV2) for (const f of state.fighters) {
            const queued = f.movement!.queued;
            if (!queued || !f.deployed || f.hp === 0 || f.attack || tick < f.stunnedUntil || tick < f.readyTick || f.movement!.dashTicks > 0) continue;
            const target = lookup(queued.target);
            if (!target.deployed || target.hp === 0) { f.movement!.queued = null; emit(f, queued.move, target.id, 'target_inactive'); }
            else if (within(f, target, def(f).moves[queued.move].rangeMm)) {
                // Clear before execution: a dash can consume the last STA while closing.
                f.movement!.queued = null;
                command({seq: 0, tick, actor: f.id, action: queued.move, target: target.id});
            }
        }
        const positions = state.fighters.map(f => ({ x: f.x, z: f.z }));
        for (const f of state.fighters) {
            if (!f.deployed || f.hp === 0 || f.attack || tick < f.stunnedUntil)
                continue;
            if (movementV2) {
                if (f.guardUntil > tick) continue;
                const queued = f.movement!.queued;
                const target = (queued ? lookup(queued.target) : f.target ? lookup(f.target) : null);
                const opponent = target?.deployed && target.hp > 0 ? target : state.fighters.find(o => o.side !== f.side && o.deployed && o.hp > 0);
                const movement = rules.movement![f.id];
                const goal = queued ? def(f).moves[queued.move].rangeMm : f.disengaged && opponent
                    ? Math.max(Number(sqrtCeil(BigInt(positions[state.fighters.indexOf(opponent)].x - f.x)**2n + BigInt(positions[state.fighters.indexOf(opponent)].z - f.z)**2n)), Math.max(...Object.values(def(opponent).moves).map(m => m.rangeMm)) + 1)
                    : Math.floor(movement.preferredRangeMm * 9 / 10);
                const targetPosition = opponent && !(f.moveX || f.moveZ) ? positions[state.fighters.indexOf(opponent)] : null;
                moveFighter(f, movement, tick, targetPosition, goal, def(f).radiusMm, () => emit(f, 'dash', opponent?.id ?? null, 'accepted'));
                continue;
            }
            const d = def(f), den = Math.max(127, Math.abs(f.moveX) + Math.abs(f.moveZ));
            f.x = clamp(f.x + mulDiv(d.speedMmPerTick, f.moveX, den), -rules.arenaHalfSizeMm + d.radiusMm, rules.arenaHalfSizeMm - d.radiusMm);
            f.z = clamp(f.z + mulDiv(d.speedMmPerTick, f.moveZ, den), -rules.arenaHalfSizeMm + d.radiusMm, rules.arenaHalfSizeMm - d.radiusMm);
            if (f.moveX || f.moveZ) {
                f.facingX = Math.sign(f.moveX);
                f.facingZ = Math.sign(f.moveZ);
            }
        }
        // Swept circle collision prevents crossing through each other between ticks.
        const active = state.fighters.map((f, i) => ({ f, i })).filter(x => x.f.deployed && x.f.hp > 0);
        if (active.length === 2) {
            const [a, b] = active, ax = BigInt(positions[a.i].x - positions[b.i].x), az = BigInt(positions[a.i].z - positions[b.i].z), vx = BigInt(a.f.x - b.f.x) - ax, vz = BigInt(a.f.z - b.f.z) - az, len = vx * vx + vz * vz, dot = ax * vx + az * vz, rr = BigInt(def(a.f).radiusMm + def(b.f).radiusMm);
            const endX = ax + vx, endZ = az + vz;
            const collision = len === 0n || dot >= 0n ? ax * ax + az * az < rr * rr : -dot >= len ? endX * endX + endZ * endZ < rr * rr : (ax * ax + az * az) * len - dot * dot < rr * rr * len;
            if (collision) {
                Object.assign(a.f, positions[a.i]);
                Object.assign(b.f, positions[b.i]);
            }
        }
        const hits: {
            f: FighterState;
            target: FighterState;
            damage: number;
            stun: number;
            sync: number;
            move: Move;
            hit: boolean;
        }[] = [];
        state.fighters.forEach((f, index) => { const attack = f.attack; if (!attack || attack.contactTick !== tick)
            return; f.attack = null; const target = lookup(attack.target), m = def(f).moves[attack.move]; const eligible = f.deployed && f.hp > 0 && target.deployed && target.hp > 0 && within(f, target, m.rangeMm); const hit = eligible && randomChoice(seed, 2, tick, index, 10000) < m.hitChanceBps; const variance = randomChoice(seed, 3, tick, index, m.variance * 2 + 1) - m.variance; let damage = hit ? Math.max(0, m.damage + variance) : 0; if (target.guardUntil > tick && tick - target.guardStarted < rules.guardWindowTicks)
            damage = mulDiv(damage, rules.guardDamageBps, 10000); hits.push({ f, target, damage, stun: hit ? m.interruptTicks : 0, sync: hit ? m.syncGain : 0, move: attack.move, hit }); });
        // All contact decisions above use the same pre-contact state (mutual KO is a draw).
        for (const h of hits) {
            h.target.hp = Math.max(0, h.target.hp - h.damage);
            h.f.sync = Math.min(def(h.f).maxSync, h.f.sync + h.sync);
            if (h.stun > 0) {
                h.target.stunnedUntil = Math.max(h.target.stunnedUntil, tick + h.stun + 1);
                h.target.attack = null;
                if (h.target.movement) { h.target.movement.dashTicks = 0; h.target.movement.dashX = h.target.movement.dashZ = 0; }
                h.target.moveX = h.target.moveZ = 0;
                h.target.guardUntil = 0;
                h.target.guardStarted = -1;
            }
            emit(h.f, h.move, h.target.id, h.hit ? 'contact' : 'miss', h.damage, h.hit);
        }
        for (const f of state.fighters) {
            if (f.hp === 0) {
                f.deployed = false;
                f.attack = null;
                if (f.movement) { f.movement.queued = null; f.movement.dashTicks = 0; f.movement.dashX = f.movement.dashZ = 0; }
                f.moveX = f.moveZ = 0;
                f.guardUntil = 0;
                f.guardStarted = -1;
            }
            else if (!f.attack && tick >= f.stunnedUntil)
                f.stamina = Math.min(def(f).maxStamina, f.stamina + (f.disengaged ? def(f).disengageRegenPerTick : def(f).regenPerTick));
        }
        // Bench survivors stay undeployed until a legal command from a living active fighter.
        // KO auto-deploy chooses first living instance at its validated snapshot spawn, blocking overlap.
        for (const side of [0, 1])
            if (!state.fighters.some(f => f.side === side && f.deployed)) {
                const next = state.fighters.find(f => f.side === side && f.hp > 0);
                if (next && !state.fighters.some(o => o.side !== side && o.deployed && within(next, o, def(next).radiusMm + def(o).radiusMm))) {
                    next.deployed = true;
                    emit(next, 'deploy', next.id, 'auto_deploy');
                }
            }
        const alive = [0, 1].map(side => state.fighters.some(f => f.side === side && f.hp > 0));
        if (!alive[0] || !alive[1]) {
            state.reason = 'ko';
            state.winner = alive[0] === alive[1] ? null : alive[0] ? 0 : 1;
        }
        else if (tick === rules.maxTicks - 1) {
            state.reason = 'timeout';
            if (rules.timeout === 'remaining_hp') {
                const hp = [0, 1].map(side => state.fighters.filter(f => f.side === side).reduce((s, f) => s + f.hp, 0));
                state.winner = hp[0] === hp[1] ? null : hp[0] > hp[1] ? 0 : 1;
            }
        }
        result.ticks.push({ tick, hash: canonicalHash(state), events });
    }
    result.finalHash = canonicalHash(state);
    return result;
}
