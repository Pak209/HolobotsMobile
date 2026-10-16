import { Command, InputLog, RulesSnapshot } from './types';
export function integer(n: unknown, min: number, max: number, field: string): asserts n is number {
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || Object.is(n, -0) || n < min || n > max)
        throw new Error(`invalid_${field}`);
}
export function shape(v: unknown, required: string[]): asserts v is Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype)
        throw new Error('invalid_shape');
    const keys = Object.keys(v);
    if (keys.length !== required.length || required.some(k => !keys.includes(k)))
        throw new Error('invalid_fields');
}
function dense(v: unknown, min: number, max: number): asserts v is unknown[] { if (!Array.isArray(v) || v.length < min || v.length > max || Object.keys(v).length !== v.length)
    throw new Error('invalid_array'); for (let i = 0; i < v.length; i++)
    if (!Object.hasOwn(v, i))
        throw new Error('invalid_array'); }
export function validate(r: RulesSnapshot, log: InputLog, seed: string): void {
    if (typeof seed !== 'string' || !/^[0-9a-f]{64}$/.test(seed))
        throw new Error('invalid_seed');
    shape(r, ['simVersion', 'tickHz', 'maxTicks', 'arenaHalfSizeMm', 'heldTicks', 'guardDamageBps', 'guardWindowTicks', 'cpuEveryTicks', 'timeout', 'fighters']);
    if (r.simVersion !== 'duel-sim-1' || r.tickHz !== 30)
        throw new Error('invalid_version');
    integer(r.maxTicks, 1, 7200, 'maxTicks');
    integer(r.arenaHalfSizeMm, 1, 1000000, 'arena');
    integer(r.heldTicks, 1, 15, 'heldTicks');
    integer(r.guardWindowTicks, 1, 7200, 'guardWindow');
    integer(r.guardDamageBps, 0, 10000, 'guardDamage');
    integer(r.cpuEveryTicks, 1, 7200, 'cpuEveryTicks');
    if (!['draw', 'remaining_hp'].includes(r.timeout))
        throw new Error('invalid_timeout');
    dense(r.fighters, 2, 6);
    const ids = new Set<string>();
    for (const f of r.fighters) {
        shape(f, ['id', 'side', 'cpu', 'deployed', 'hp', 'stamina', 'sync', 'maxHp', 'maxStamina', 'maxSync', 'x', 'z', 'radiusMm', 'speedMmPerTick', 'regenPerTick', 'disengageRegenPerTick', 'moves']);
        if (typeof f.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(f.id) || ids.has(f.id))
            throw new Error('invalid_id');
        ids.add(f.id);
        integer(f.side, 0, 1, 'side');
        if (typeof f.cpu !== 'boolean' || typeof f.deployed !== 'boolean')
            throw new Error('invalid_boolean');
        for (const k of ['maxHp', 'maxStamina', 'maxSync', 'regenPerTick', 'disengageRegenPerTick'] as const)
            integer(f[k], k === 'maxHp' ? 1 : 0, 1000000000, k);
        integer(f.hp, 0, f.maxHp, 'hp');
        integer(f.stamina, 0, f.maxStamina, 'stamina');
        integer(f.sync, 0, f.maxSync, 'sync');
        integer(f.radiusMm, 1, r.arenaHalfSizeMm, 'radius');
        integer(f.speedMmPerTick, 0, 100000, 'speed');
        integer(f.x, -r.arenaHalfSizeMm + f.radiusMm, r.arenaHalfSizeMm - f.radiusMm, 'x');
        integer(f.z, -r.arenaHalfSizeMm + f.radiusMm, r.arenaHalfSizeMm - f.radiusMm, 'z');
        if (f.deployed && f.hp === 0)
            throw new Error('deployed_ko');
        shape(f.moves, ['strike', 'heavy', 'finisher']);
        for (const m of Object.values(f.moves)) {
            shape(m, ['damage', 'staminaCost', 'syncCost', 'syncGain', 'windupTicks', 'recoveryTicks', 'rangeMm', 'hitChanceBps', 'variance', 'interruptTicks', 'cancelAfterTicks']);
            for (const k of ['damage', 'staminaCost', 'syncCost', 'syncGain', 'variance'] as const)
                integer(m[k], 0, 1000000000, k);
            for (const k of ['windupTicks', 'recoveryTicks', 'interruptTicks', 'cancelAfterTicks'] as const)
                integer(m[k], k === 'windupTicks' ? 1 : 0, 7200, k);
            integer(m.rangeMm, 0, 2000000, 'range');
            integer(m.hitChanceBps, 0, 10000, 'chance');
            if (m.cancelAfterTicks >= m.windupTicks)
                throw new Error('invalid_cancel_window');
        }
    }
    for (const side of [0, 1]) {
        const team = r.fighters.filter(f => f.side === side);
        if (team.length < 1 || team.length > 3 || team.filter(f => f.deployed).length !== 1 || team.some(f => f.cpu !== team[0].cpu))
            throw new Error('invalid_team');
    }
    // Every spawn must be separated from every opposing spawn, including bench entries.
    for (const a of r.fighters)
        for (const b of r.fighters) {
            if (a.side === b.side)
                continue;
            const x = BigInt(a.x - b.x), z = BigInt(a.z - b.z), rr = BigInt(a.radiusMm + b.radiusMm);
            if (x * x + z * z < rr * rr)
                throw new Error('initial_overlap');
        }
    shape(log, ['schemaVersion', 'events']);
    if (log.schemaVersion !== 'duel-inputs-1')
        throw new Error('invalid_log');
    dense(log.events, 0, 8192);
    let previous = -1, perTick = 0;
    log.events.forEach((e: Command, i: number) => {
        if (!e || typeof e !== 'object')
            throw new Error('invalid_event');
        const extra = e.action === 'move' ? ['x', 'z'] : ['strike', 'heavy', 'finisher', 'select_target', 'deploy'].includes(e.action) ? ['target'] : [];
        shape(e, ['seq', 'tick', 'actor', 'action', ...extra]);
        integer(e.seq, i, i, 'seq');
        integer(e.tick, 0, r.maxTicks - 1, 'tick');
        if (e.tick < previous)
            throw new Error('unordered_ticks');
        perTick = e.tick === previous ? perTick + 1 : 1;
        previous = e.tick;
        if (perTick > 4)
            throw new Error('too_many_commands');
        const a = r.fighters.find(f => f.id === e.actor);
        if (!a || a.cpu)
            throw new Error('invalid_actor');
        if (e.action === 'move') {
            integer(e.x, -127, 127, 'axis');
            integer(e.z, -127, 127, 'axis');
        }
        else if (extra[0] === 'target') {
            const t = r.fighters.find(f => f.id === e.target);
            if (!t || t.id === a.id || (e.action === 'deploy' ? t.side !== a.side : t.side === a.side))
                throw new Error('invalid_target');
        }
        else if (!['guard_down', 'guard_up', 'disengage'].includes(e.action))
            throw new Error('invalid_action');
    });
}
