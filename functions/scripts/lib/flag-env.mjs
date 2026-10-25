// Host feature-switch pinning for tests. Production runs with every merged HOLOCITY_* switch ON (DECISIONS #72.86),
// while CI runs with none set; a test that depends on a switch must set it itself so it passes under both.
// Switches are read at call time and are ON only for exactly "1" (undefined = OFF).
export function pinFlags(flags) {
  for (const [name, value] of Object.entries(flags)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
export function withFlags(flags, fn) {
  const prev = Object.fromEntries(Object.keys(flags).map(n => [n, process.env[n]]));
  pinFlags(flags);
  try { return fn(); } finally { pinFlags(prev); }
}
/** Async variant: the pins stay in force until the awaited fn settles (withFlags would restore them before an async body runs). */
export async function withFlagsAsync(flags, fn) {
  const prev = Object.fromEntries(Object.keys(flags).map(n => [n, process.env[n]]));
  pinFlags(flags);
  try { return await fn(); } finally { pinFlags(prev); }
}
/** Environment for a child process with the named switches pinned (undefined = removed). */
export function childEnv(flags) {
  const env = { ...process.env };
  for (const [name, value] of Object.entries(flags)) { if (value === undefined) delete env[name]; else env[name] = value; }
  return env;
}
