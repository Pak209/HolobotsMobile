/** Off-editor transaction model, not a Firestore/emulator substitute.
 * Enforces read-before-write and atomic rollback, serialises transactions.
 */
export function memoryFirestore() {
  const rows = new Map(); let queue = Promise.resolve();
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const snap = path => ({ exists: rows.has(path), data: () => clone(rows.get(path)) });
  const db = {
    doc(path) { return { path, get: async () => snap(path), set: async value => { rows.set(path, clone(value)); }, update: async value => { if (!rows.has(path)) throw new Error('missing doc'); rows.set(path, { ...rows.get(path), ...clone(value) }); } }; },
    collection(path) { return { get: async () => ({ size: [...rows.keys()].filter(key => key.startsWith(path + '/') && key.slice(path.length + 1).indexOf('/') < 0).length }) }; },
    recursiveDelete: async ref => { for (const key of rows.keys()) if (key === ref.path || key.startsWith(ref.path + '/')) rows.delete(key); },
    runTransaction(fn) {
      const run = queue.then(async () => {
        const pending = []; let writing = false;
        const tx = {
          async get(ref) { if (writing) throw new Error('transaction read after write'); return snap(ref.path); },
          set(ref, value) { writing = true; pending.push(['set', ref.path, clone(value)]); },
          update(ref, value) { writing = true; if (!rows.has(ref.path)) throw new Error('missing update'); pending.push(['update', ref.path, clone(value)]); },
          create(ref, value) { writing = true; if (rows.has(ref.path)) throw new Error('exists'); pending.push(['set', ref.path, clone(value)]); },
        };
        const result = await fn(tx);
        for (const [op, path, value] of pending) rows.set(path, op === 'update' ? { ...rows.get(path), ...value } : value);
        return result;
      });
      queue = run.catch(() => {}); return run;
    },
  }; return db;
}
