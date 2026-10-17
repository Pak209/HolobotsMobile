import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ getDefault: vi.fn(), apps: [] as { name: string }[], initialize: vi.fn(() => ({ name: "test" })), auth: vi.fn(), db: vi.fn(), functions: vi.fn() }));
vi.mock("firebase/app", () => ({ getApps: () => calls.apps, getApp: calls.getDefault, initializeApp: calls.initialize }));
vi.mock("firebase/auth", () => ({ initializeAuth: () => ({}), getAuth: () => ({}), connectAuthEmulator: calls.auth,
  createUserWithEmailAndPassword: vi.fn(), deleteUser: vi.fn(), onAuthStateChanged: vi.fn(), signInWithEmailAndPassword: vi.fn(), signOut: vi.fn() }));
vi.mock("@firebase/auth/dist/rn/index", () => ({ getReactNativePersistence: vi.fn() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));
vi.mock("firebase/firestore", () => ({ getFirestore: () => ({}), connectFirestoreEmulator: calls.db,
  collection: vi.fn(), deleteDoc: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), limit: vi.fn(), onSnapshot: vi.fn(), orderBy: vi.fn(), query: vi.fn(), serverTimestamp: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn() }));
vi.mock("firebase/functions", () => ({ getFunctions: () => ({}), connectFunctionsEmulator: calls.functions, httpsCallable: vi.fn() }));
beforeEach(() => { vi.stubEnv("EXPO_PUBLIC_HOLOCITY_LITE", "1"); calls.getDefault.mockImplementation(() => { const app = calls.apps.find(a => a.name === "[DEFAULT]"); if (!app) throw new Error("No default app"); return app; }); });
afterEach(() => { calls.apps.length = 0; vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules(); });
describe("offline preview backend isolation", () => {
  it("known-bad: shared screen imports cannot initialize production during offline preview", async () => {
    vi.stubGlobal("__DEV__", true); vi.stubEnv("EXPO_PUBLIC_HOLOCITY_PREVIEW", "1");
    await import("../../../config/firebase");
    expect(calls.initialize).toHaveBeenCalledWith(expect.objectContaining({ projectId: "demo-holocity-offline" }), "holocity-offline");
    expect(calls.auth).toHaveBeenCalledWith(expect.anything(), "http://127.0.0.1:9", { disableWarnings: true });
    expect(calls.db).toHaveBeenCalledWith(expect.anything(), "127.0.0.1", 9);
    expect(calls.functions).toHaveBeenCalledWith(expect.anything(), "127.0.0.1", 9);
  });
  it("reuses an initialized offline app without reconnecting used services", async () => {
    vi.stubGlobal("__DEV__", true); vi.stubEnv("EXPO_PUBLIC_HOLOCITY_PREVIEW", "1"); calls.apps.push({ name: "holocity-offline" });
    await import("../../../config/firebase"); expect(calls.initialize).not.toHaveBeenCalled();
    expect(calls.auth).not.toHaveBeenCalled(); expect(calls.db).not.toHaveBeenCalled(); expect(calls.functions).not.toHaveBeenCalled();
  });
  it("creates production default when only the prior named preview app exists", async () => {
    vi.stubGlobal("__DEV__", true); vi.stubEnv("EXPO_PUBLIC_HOLOCITY_PREVIEW", "0"); calls.apps.push({ name: "holocity-offline" });
    await import("../../../config/firebase"); expect(calls.getDefault).not.toHaveBeenCalled(); expect(calls.initialize).toHaveBeenCalledWith(expect.objectContaining({ projectId: "holobots-24046" }));
  });
  it.each([[false, "1"], [true, "0"], [true, ""]])("preserves shipping config when development=%s and preview=%s", async (dev, flag) => {
    vi.stubGlobal("__DEV__", dev); vi.stubEnv("EXPO_PUBLIC_HOLOCITY_PREVIEW", flag);
    await import("../../../config/firebase");
    expect(calls.initialize).toHaveBeenCalledWith(expect.objectContaining({ projectId: "holobots-24046" }));
    expect(calls.auth).not.toHaveBeenCalled(); expect(calls.db).not.toHaveBeenCalled(); expect(calls.functions).not.toHaveBeenCalled();
  });
});
