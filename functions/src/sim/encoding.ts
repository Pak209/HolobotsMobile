import { createHash } from 'node:crypto';
/** duel-sim-1 canonical values: null=0, false=1, true=2, i64=3,
 * ASCII string=4 + u32 byte length, array=5 + u32 count, object=6 + u32
 * count + sorted ASCII key/value pairs. All lengths/integers little endian.
 * No floats, undefined, prototypes, UTF-16 normalization, or JSON formatting. */
export function canonicalBytes(value: unknown): Buffer {
    const parts: Buffer[] = [];
    let nodes = 0, bytes = 0;
    const push = (b: Buffer) => { bytes += b.length; if (bytes > 2097152)
        throw new Error('encoding_size'); parts.push(b); };
    const count = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); push(b); };
    const write = (v: unknown, depth: number): void => {
        if (depth > 32)
            throw new Error('encoding_depth');
        if (++nodes > 100000)
            throw new Error('encoding_size');
        if (v === null) {
            push(Buffer.from([0]));
            return;
        }
        if (typeof v === 'boolean') {
            push(Buffer.from([v ? 2 : 1]));
            return;
        }
        if (typeof v === 'number') {
            if (!Number.isSafeInteger(v) || Object.is(v, -0))
                throw new Error('encoding_integer');
            const b = Buffer.alloc(9);
            b[0] = 3;
            b.writeBigInt64LE(BigInt(v), 1);
            push(b);
            return;
        }
        if (typeof v === 'string') {
            if (!/^[\x20-\x7e]*$/.test(v) || v.length > 256)
                throw new Error('encoding_ascii');
            push(Buffer.from([4]));
            count(v.length);
            push(Buffer.from(v, 'ascii'));
            return;
        }
        if (Array.isArray(v)) {
            if (v.length > 8192 || Object.keys(v).length !== v.length)
                throw new Error('encoding_array');
            push(Buffer.from([5]));
            count(v.length);
            for (let i = 0; i < v.length; i++) {
                if (!Object.hasOwn(v, i))
                    throw new Error('encoding_array');
                write(v[i], depth + 1);
            }
            return;
        }
        if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
            const o = v as Record<string, unknown>, keys = Object.keys(o).sort();
            if (keys.length > 128)
                throw new Error('encoding_size');
            push(Buffer.from([6]));
            count(keys.length);
            for (const key of keys) {
                write(key, depth + 1);
                write(o[key], depth + 1);
            }
            return;
        }
        throw new Error('encoding_type');
    };
    write(value, 0);
    return Buffer.concat(parts);
}
export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
export const canonicalHash = (value: unknown): string => sha256(canonicalBytes(value));
export function rngWord(seed: string, streamId: number, tick: number, eventIndex: number, drawIndex: number): number {
    if (!/^[0-9a-f]{64}$/.test(seed))
        throw new Error('invalid_seed');
    const counters = Buffer.alloc(16);
    [streamId, tick, eventIndex, drawIndex].forEach((n, i) => {
        if (!Number.isInteger(n) || n < 0 || n > 0xffffffff)
            throw new Error('rng_counter');
        counters.writeUInt32LE(n, i * 4);
    });
    return createHash('sha256').update(Buffer.from('duel-sim-1/rng', 'utf8'))
        .update(Buffer.from(seed, 'hex')).update(counters).digest().readUInt32LE(0);
}
/** Rejected words consume drawIndex only, never another event's stream. */
export function boundedWord(bound: number, draw: (index: number) => number): number {
    if (!Number.isInteger(bound) || bound < 1 || bound > 0x100000000)
        throw new Error('rng_bound');
    const limit = Math.floor(0x100000000 / bound) * bound;
    for (let i = 0; i < 65536; i++) {
        const n = draw(i);
        if (!Number.isInteger(n) || n < 0 || n > 0xffffffff)
            throw new Error('rng_word');
        if (n < limit)
            return n % bound;
    }
    throw new Error('rng_exhausted');
}
export const randomChoice = (seed: string, stream: number, tick: number, event: number, bound: number): number => boundedWord(bound, draw => rngWord(seed, stream, tick, event, draw));
