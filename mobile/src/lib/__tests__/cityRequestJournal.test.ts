import { describe, expect, it, vi } from "vitest";
import { createCityRequestJournal } from "../cityRequestJournal";
function memory() {
  const values = new Map<string, string>();
  return { values, getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); }, removeItem: async (key: string) => { values.delete(key); } };
}
describe("workshop request journal", () => {
  it("reuses one request through duplicate taps, sheet dismissal and app restart", async () => {
    const storage = memory(), id = vi.fn(() => "request-one");
    const journal = createCityRequestJournal(storage, id);
    expect(await Promise.all([journal.acquire("a", "craft"), journal.acquire("a", "craft")])).toEqual(["request-one", "request-one"]);
    expect(id).toHaveBeenCalledTimes(1);
    const restarted = createCityRequestJournal(storage, () => "must-not-replace");
    expect(await restarted.acquire("a", "craft")).toBe("request-one");
  });
  it("isolates accounts/actions and rotates only after successful receipt completion", async () => {
    const storage = memory(); let n = 0;
    const journal = createCityRequestJournal(storage, () => `request-${++n}`);
    const a = await journal.acquire("a", "craft"), b = await journal.acquire("b", "craft"), heal = await journal.acquire("a", "heal");
    expect(new Set([a, b, heal]).size).toBe(3);
    await journal.complete("a", "craft", "wrong-receipt");
    expect(await journal.acquire("a", "craft")).toBe(a);
    await journal.complete("a", "craft", a);
    expect(await journal.acquire("a", "craft")).not.toBe(a);
    expect(await journal.acquire("b", "craft")).toBe(b);
  });
  it("fails before a mutation when the receipt cannot be persisted", async () => {
    const storage = memory(); storage.setItem = async () => { throw new Error("disk unavailable"); };
    const journal = createCityRequestJournal(storage, () => "request");
    await expect(journal.acquire("a", "craft")).rejects.toThrow("disk unavailable");
  });
});
