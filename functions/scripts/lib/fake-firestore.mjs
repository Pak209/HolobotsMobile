// In-memory Firestore double for store tests (no emulator): docs by path with create times, direct-child
// collection queries (==, >, orderBy, limit) and buffered transactions that refuse a read after a write.
/** Minimal Firestore double: docs by path, direct-child collection queries (==, >, orderBy, limit), buffered transactions. */
export function fakeDb(clock = { now: 0 }) {
  const docs = new Map();
  let autoIds = 0;
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const snap = (path) => {
    const row = docs.get(path);
    return { id: path.split('/').pop(), exists: !!row, data: () => (row ? structuredClone(row.data) : undefined), createTime: row ? { toMillis: () => row.createdAtMs } : undefined };
  };
  const docRef = (path) => ({ kind: 'doc', path, collection: (c) => collRef(`${path}/${c}`), get: async () => snap(path),
    set: async (data) => { docs.set(path, { data: structuredClone(data), createdAtMs: docs.get(path)?.createdAtMs ?? clock.now }); },
    update: async (data) => { const row = docs.get(path); if (!row) throw new Error('missing'); row.data = { ...row.data, ...structuredClone(data) }; } });
  const collRef = (path, filters = [], order = null, lim = Infinity) => ({
    kind: 'query', path,
    doc: (id) => docRef(`${path}/${id ?? `auto${String(++autoIds).padStart(16, '0')}`}`), // doc() with no id: a fresh auto-id, as Firestore does.
    where: (f, op, v) => collRef(path, [...filters, [f, op, v]], order, lim),
    orderBy: (f) => collRef(path, filters, f, lim),
    limit: (n) => collRef(path, filters, order, n),
    run() {
      let rows = [...docs.keys()].filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(snap);
      for (const [f, op, v] of filters) rows = rows.filter(s => { const x = get(s.data(), f); return op === '==' ? x === v : op === '>' ? typeof x === 'number' && x > v : false; });
      if (order) rows.sort((a, b) => get(a.data(), order) - get(b.data(), order));
      rows = rows.slice(0, lim);
      return { docs: rows, empty: rows.length === 0, size: rows.length };
    },
  });
  const db = {
    docs, clock,
    doc: docRef, collection: (p) => collRef(p),
    put(path, data, createdAtMs = clock.now) { docs.set(path, { data: structuredClone(data), createdAtMs }); },
    read(path) { return docs.get(path)?.data; },
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        async getAll(...refs) { return Promise.all(refs.map(r => this.get(r))); },
        async get(ref) { if (writes.length) throw new Error(`read after write: ${ref.path}`); return ref.kind === 'doc' ? snap(ref.path) : ref.run(); },
        set(ref, data) { writes.push(() => docs.set(ref.path, { data: structuredClone(data), createdAtMs: docs.get(ref.path)?.createdAtMs ?? clock.now })); },
        create(ref, data) { if (docs.has(ref.path)) throw new Error('exists'); writes.push(() => docs.set(ref.path, { data: structuredClone(data), createdAtMs: clock.now })); },
        update(ref, data) { if (!docs.has(ref.path)) throw new Error('missing'); writes.push(() => { const row = docs.get(ref.path); row.data = { ...row.data, ...structuredClone(data) }; }); },
      };
      const out = await fn(tx);
      for (const w of writes) w();
      return out;
    },
  };
  return db;
}
