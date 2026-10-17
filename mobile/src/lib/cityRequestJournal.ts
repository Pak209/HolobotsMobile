type RequestStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
/** Persist receipt IDs before mutations so closing a sheet or restarting preserves retry identity. */
export function createCityRequestJournal(storage: RequestStorage, makeId: () => string) {
  const pending = new Map<string, Promise<string>>();
  const keyFor = (uid: string, action: string) => `city-request:v1:${uid}:${action}`;
  return {
    acquire(uid: string, action: string): Promise<string> {
      const key = keyFor(uid, action);
      const existing = pending.get(key); if (existing) return existing;
      const request = (async () => {
        const stored = await storage.getItem(key);
        if (stored && /^[a-zA-Z0-9_-]{1,128}$/.test(stored)) return stored;
        const id = makeId();
        await storage.setItem(key, id);
        return id;
      })();
      pending.set(key, request);
      void request.catch(() => { if (pending.get(key) === request) pending.delete(key); });
      return request;
    },
    async complete(uid: string, action: string, requestId: string): Promise<void> {
      const key = keyFor(uid, action);
      const current = await (pending.get(key) ?? storage.getItem(key));
      if (current !== requestId) return;
      await storage.removeItem(key);
      pending.delete(key);
    },
  };
}
