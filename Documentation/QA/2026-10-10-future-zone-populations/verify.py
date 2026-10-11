#!/usr/bin/env python3
"""Draft-only data check. No mutation, network, dependencies or runtime install.

v2 (2026-10-11, chair lane): a row is either NEEDS_TUNING (every tuning field null) or PRODUCER_DEFAULT (the
holozone-run-2 population shape, only the four Unity beast ids, no invented boss, and the producer ceiling rule
spawnCount + sum(timer maxRespawns) == 25). Either way the draft stays inert: not approved, no scene, runtime disabled,
only neonforest approved at runtime, and neither zone in the runtime tables. Every rule has a known-bad control.
"""
import copy, datetime, hashlib, json, math, pathlib, re

root = pathlib.Path(__file__).resolve().parents[3]
draft = json.loads((root / 'Documentation/DRAFTS/2026-10-10-future-zone-populations.json').read_text())

CEILING = 25  # MAX_PERFORMANCE_EVENTS (functions/src/lib/battleSettlement.ts)
CEILING_RULE = 'spawnCount + sum(timer maxRespawns) == 25'
UNITY_BEAST_IDS = {'scrapling', 'nullstalker', 'cacheback', 'wyrm'}  # Unity BeastSnapshot ids (encounter-payload.sample.json)
STABLE_ID = re.compile(r'[a-z][a-z0-9_]{0,63}')
ZONES = ['tide_hollow', 'sky_reach']
ROW_KEYS = {'zoneId', 'displayName', 'state', 'approved', 'tier', 'beasts', 'boss', 'spawnCount', 'maxKillsCredited', 'sceneName'}
TUNING = ['tier', 'beasts', 'boss', 'spawnCount', 'maxKillsCredited', 'sceneName']
TODAY = datetime.datetime.now(datetime.timezone.utc).date()


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def respawn_ok(r):
    if r == {'kind': 'none'}:
        return True
    return (isinstance(r, dict) and set(r) == {'kind', 'delaySeconds', 'maxRespawns'} and r['kind'] == 'timer'
            and isinstance(r['delaySeconds'], (int, float)) and not isinstance(r['delaySeconds'], bool)
            and math.isfinite(r['delaySeconds']) and r['delaySeconds'] >= 0 and is_int(r['maxRespawns']) and r['maxRespawns'] >= 0)


def beast_ok(b):
    return (isinstance(b, dict) and set(b) == {'beastId', 'count', 'respawn'} and isinstance(b['beastId'], str)
            and STABLE_ID.fullmatch(b['beastId']) is not None and b['beastId'] in UNITY_BEAST_IDS
            and is_int(b['count']) and b['count'] >= 1 and respawn_ok(b['respawn']))


def producer_default_ok(r):
    beasts = r['beasts']
    if not (is_int(r['tier']) and r['tier'] >= 0 and isinstance(beasts, list) and beasts and all(beast_ok(b) for b in beasts)):
        return False
    if len({b['beastId'] for b in beasts}) != len(beasts) or r['boss'] is not None:  # no boss is named for these zones yet
        return False
    spawn = sum(b['count'] for b in beasts)
    returns = sum(b['respawn']['maxRespawns'] for b in beasts if b['respawn']['kind'] == 'timer')
    return is_int(r['spawnCount']) and r['spawnCount'] == spawn and is_int(r['maxKillsCredited']) and r['maxKillsCredited'] == CEILING and spawn + returns == CEILING


def row_ok(r):
    if not (set(r) == ROW_KEYS and r['approved'] is False and r['sceneName'] is None):
        return False
    if r['state'] == 'NEEDS_TUNING':
        return all(r[k] is None for k in TUNING)
    return r['state'] == 'PRODUCER_DEFAULT' and producer_default_ok(r)


def recorded_ok(d):
    try:
        return datetime.date.fromisoformat(d.get('producerDefaultsRecordedAt')) <= TODAY  # never ahead of the clock
    except (TypeError, ValueError):
        return False


def inert(d):
    rows = d.get('rows', [])
    return (d.get('draftVersion') == 2 and d.get('runtimeEnabled') is False and d.get('approvedRuntimeZones') == ['neonforest']
            and d.get('producerCeilingRule') == CEILING_RULE and recorded_ok(d) and all(isinstance(r, dict) for r in rows)
            and [r.get('zoneId') for r in rows] == ZONES and all(row_ok(r) for r in rows))


def put(*path_and_value):
    *path, value = path_and_value
    def edit(d):
        for k in path[:-1]:
            d = d[k]
        d[path[-1]] = value
    return edit


def refused(name, edit, base):
    bad = copy.deepcopy(base)
    edit(bad)
    assert not inert(bad), 'KNOWN-BAD must fail: ' + name
    return 1


assert inert(draft), 'draft must stay inert: PRODUCER_DEFAULT rows validate, NEEDS_TUNING rows carry no tuning'
assert [r['state'] for r in draft['rows']] == ['PRODUCER_DEFAULT', 'PRODUCER_DEFAULT'], 'both rows carry the producer defaults'
controls = 0
for name, edit in {
    'malformed beast id': put('rows', 0, 'beasts', 0, 'beastId', 'Bad Id'),
    'count 0': put('rows', 0, 'beasts', 0, 'count', 0),
    'ceiling 26 (maxRespawns 15)': put('rows', 0, 'beasts', 0, 'respawn', 'maxRespawns', 15),
    'ceiling 24 (maxRespawns 13)': put('rows', 0, 'beasts', 0, 'respawn', 'maxRespawns', 13),
    'spawnCount not the sum of counts': put('rows', 0, 'spawnCount', 6),
    'maxKillsCredited not 25': put('rows', 0, 'maxKillsCredited', 26),
    'invented beast id (well-formed)': put('rows', 1, 'beasts', 1, 'beastId', 'kraken'),
    'duplicate beast id': put('rows', 0, 'beasts', 1, 'beastId', 'cacheback'),
    'invented boss': put('rows', 0, 'boss', {'bossId': 'root_nexus', 'count': 1, 'respawn': {'kind': 'none'}}),
    'unknown respawn kind': put('rows', 0, 'beasts', 1, 'respawn', {'kind': 'random'}),
    'negative delay': put('rows', 1, 'beasts', 0, 'respawn', 'delaySeconds', -1),
    'negative tier': put('rows', 1, 'tier', -1),
    'boolean tier': put('rows', 1, 'tier', True),
    'approved': put('rows', 0, 'approved', True),
    'invented scene': put('rows', 0, 'sceneName', 'HoloZone_TideHollow'),
    'invented reward field': put('rows', 0, 'rewards', {'holos': 100}),
    'v1 row-level respawn key': put('rows', 0, 'respawn', None),
    'unknown state': put('rows', 1, 'state', 'APPROVED'),
    'runtime enabled': put('runtimeEnabled', True),
    'future zone approved at runtime': put('approvedRuntimeZones', ['neonforest', 'tide_hollow']),
    'invented zone row': lambda d: d['rows'].append(dict(copy.deepcopy(d['rows'][0]), zoneId='crystal_caves')),
    'recorded ahead of the clock': put('producerDefaultsRecordedAt', (TODAY + datetime.timedelta(days=1)).isoformat()),
    'ceiling rule changed': put('producerCeilingRule', 'spawnCount + sum(timer maxRespawns) <= 25'),
    'draftVersion 1': put('draftVersion', 1),
}.items():
    controls += refused(name, edit, draft)
needs = copy.deepcopy(draft)  # the NEEDS_TUNING path: accepted with no tuning, refused with any invented tuning
needs['rows'][0].update(state='NEEDS_TUNING', **{k: None for k in TUNING})
assert inert(needs), 'a NEEDS_TUNING row with no tuning is still accepted'
for field, value in [('tier', 0), ('beasts', [{'beastId': 'scrapling', 'count': 3, 'respawn': {'kind': 'timer', 'delaySeconds': 8, 'maxRespawns': 22}}]),
                     ('boss', {'bossId': 'root_nexus', 'count': 1, 'respawn': {'kind': 'none'}}), ('spawnCount', 3), ('maxKillsCredited', 25),
                     ('sceneName', 'HoloZone_TideHollow')]:
    controls += refused('NEEDS_TUNING row with invented ' + field, put('rows', 0, field, value), needs)

# Runtime files the draft must leave alone. holoZonePopulation.ts re-pinned 2026-10-11 (was 63d45fec...): it gained
# populationFromRow, the one builder the drafts reuse; its table literal keeps the 0ef98cc hash in TABLE_PINS.
PINS = {
    'functions/src/lib/holoZonePopulation.ts': '8a5b85803dbe68ea7c51d92ace477d319cb94b621c070af068c3f7065201c779',
    'functions/src/lib/holoZoneRuns.ts': '2c8adec62d6159f18be6537b42dbff66d4e34894432b0ed182135f049f1c50c2',
    'functions/src/lib/holoZoneWire.ts': '8a2d470cf86df9b298a39ec7e6842f77dc8cc60678a5ec221127f4c507765de9',
    'functions/src/holozone/holoZoneStore.ts': 'db65e7066f566bb2a4770180c150bc70dc0b39c4d5abe8ca5a5b6de2b082594f',
}
TABLE_PINS = {  # sha256 of each live table literal's text, as in the 0ef98cc files
    ('functions/src/lib/holoZonePopulation.ts', 'HOLOZONE_POPULATION_TABLE'): '63dfd0630d2635688b77079b796c97945db1b57dc8419a3cae4275426140f353',
    ('functions/src/lib/holoZoneRuns.ts', 'HOLOZONE_ZONE_TIERS'): '23c11afce351180106c5a6ef6496bd6424eac73bf63c78bbead54c7266dcac97',
}
sha = lambda b: hashlib.sha256(b).hexdigest()
tamper = 0
for file, pin in PINS.items():
    data = (root / file).read_bytes()
    assert sha(data) == pin, 'runtime changed: ' + file
    assert sha(data + b'\n') != pin, 'KNOWN-BAD one byte more must fail: ' + file
    tamper += 1
for (file, name), pin in TABLE_PINS.items():
    table = (root / file).read_text().split(name + ':')[1].split('});')[0]
    assert sha(table.encode()) == pin, 'live table changed: ' + name
    for zone in ZONES:
        assert zone not in table, 'unknown zones cannot enter the runtime table: ' + name
        injected = table.replace('Object.freeze({\n', 'Object.freeze({\n  ' + zone + ': 1,\n', 1)
        assert zone in injected and sha(injected.encode()) != pin, 'KNOWN-BAD injected zone must fail: ' + name
        tamper += 1
print('PASS: two inert PRODUCER_DEFAULT rows (tide_hollow tier 1, sky_reach tier 2; 5 + 20 = 25 each), ' + str(controls)
      + ' known-bad draft controls refused; 4 runtime file hashes + 2 live table literals pinned (' + str(tamper)
      + ' tamper controls caught; holoZonePopulation.ts re-pinned for populationFromRow); no future zone enabled')
