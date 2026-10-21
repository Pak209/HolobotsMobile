import { createHash } from 'node:crypto';

/**
 * duel-sim-3 integer + hash helpers, a line-for-line port of HolobotsUnity `Sim/Fight/FightHash.cs` (FightHash + FightMath).
 * Every division truncates toward zero (C# semantics): `div(a, b)` = Math.trunc(a / b), exact while |a| < 2^53 (every
 * product in the core and the brain stays far below it: the largest is the facing test, ~2.5e10).
 */
export function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** Floor integer square root, FightMath.Isqrt's Newton iteration (from n, while the next estimate shrinks). */
export function isqrt(n: number): number {
  if (n < 0) throw new RangeError('isqrt_negative');
  if (n < 2) return n;
  let x = n, y = div(x + 1, 2);
  while (y < x) { x = y; y = div(x + div(n, x), 2); }
  return x;
}

export function dist(dx: number, dz: number): number {
  return isqrt(dx * dx + dz * dz);
}

export function mulDiv(a: number, b: number, d: number): number {
  return div(a * b, d);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function sha256(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}

export function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');
}

const HEX64 = /^[0-9a-f]{64}(?![\s\S])/;

/** 64 lowercase hex chars -> 32 bytes (FightHash.SeedBytes; anything else is invalid_seed). */
export function seedBytes(seed: string): Buffer {
  if (typeof seed !== 'string' || !HEX64.test(seed)) throw new RangeError('invalid_seed');
  return Buffer.from(seed, 'hex');
}

/** The side's xorshift32 seed word: LE u32 of the first 4 bytes of SHA-256(ASCII "duel-sim-3/rng" || seed || side). */
export function rngSeedWord(seed: Uint8Array, side: number): number {
  const tag = Buffer.from('duel-sim-3/rng', 'ascii');
  const buf = Buffer.alloc(tag.length + 33);
  tag.copy(buf, 0);
  Buffer.from(seed).copy(buf, tag.length);
  buf[tag.length + 32] = side & 0xff;
  return sha256(buf).readUInt32LE(0);
}

/** Little-endian int32 writer (C# BinaryWriter.Write(int) / DataView.setInt32(o, v, true)). */
export class Int32Writer {
  private buf: Buffer;
  private at = 0;
  constructor(capacity = 1024) { this.buf = Buffer.alloc(capacity); }
  private room(n: number): void {
    if (this.at + n <= this.buf.length) return;
    const next = Buffer.alloc(Math.max(this.buf.length * 2, this.at + n));
    this.buf.copy(next, 0, 0, this.at);
    this.buf = next;
  }
  bytes(b: Uint8Array): this { this.room(b.length); Buffer.from(b).copy(this.buf, this.at); this.at += b.length; return this; }
  ascii(s: string): this { return this.bytes(Buffer.from(s, 'ascii')); }
  /** ToInt32 wrap, so a uint (the rng state) is written as C#'s (int) cast writes it. */
  int(v: number): this { this.room(4); this.buf.writeInt32LE(v | 0, this.at); this.at += 4; return this; }
  done(): Buffer { return this.buf.subarray(0, this.at); }
}
