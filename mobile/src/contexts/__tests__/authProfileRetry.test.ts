import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Runs the real AuthProvider under a minimal hooks harness (react-test-renderer is not needed). `H.sync` renders after
 * every state setter called outside React, the way a legacy (old-architecture, iOS) root handles Firestore/timer
 * callbacks; otherwise those setters are batched into one render.
 * lite-main-shared-1: retryProfile is additive. Without it (profileRevision 0, the original app) the profile states are
 * exactly the pre-change sequence; with it, a retry keeps the failed read's error until the read answers.
 */
type Slot = { v?: unknown; deps?: unknown[]; cleanup?: (() => void) | void; current?: unknown };
// Vitest compiles AuthContext's JSX with the classic React.createElement transform: give it a plain element factory.
vi.hoisted(() => { (globalThis as { React?: unknown }).React = { createElement: (type: unknown, props: unknown) => ({ type, props: props ?? {} }), Fragment: "Fragment" }; });
const H = vi.hoisted(() => ({
  slots: [] as Slot[], i: 0, inReact: false, dirty: false, sync: false, renders: 0,
  pending: [] as { i: number; fn: () => (() => void) | void; deps?: unknown[] }[],
  value: null as null | Record<string, any>, states: [] as string[], component: null as null | ((p: { children: null }) => any),
  authCallback: null as null | ((user: unknown) => void),
  subs: [] as { uid: string; next: (p: unknown) => void; fail: (e: Error) => void; unsubscribe: () => void; closed: boolean }[],
}));

function render() {
  H.inReact = true;
  do {
    H.dirty = false; H.i = 0; H.pending = []; H.renders++;
    const element = H.component!({ children: null });
    H.value = element.props.value;
    const snap = JSON.stringify({ user: H.value!.user?.uid ?? null, profile: H.value!.profile?.id ?? null, loading: H.value!.profileLoading, error: H.value!.profileError });
    if (H.states[H.states.length - 1] !== snap) H.states.push(snap);
    for (const effect of H.pending) {
      const slot = H.slots[effect.i];
      if (typeof slot.cleanup === "function") slot.cleanup();
      slot.deps = effect.deps;
      slot.cleanup = effect.fn();
    }
  } while (H.dirty);
  H.inReact = false;
}

vi.mock("react", () => {
  const changed = (a?: unknown[], b?: unknown[]) => !a || !b || a.length !== b.length || a.some((x, k) => !Object.is(x, b[k]));
  const useState = (init: unknown) => {
    const i = H.i++;
    if (!H.slots[i]) H.slots[i] = { v: typeof init === "function" ? (init as () => unknown)() : init };
    const slot = H.slots[i];
    const set = (next: unknown) => {
      const value = typeof next === "function" ? (next as (p: unknown) => unknown)(slot.v) : next;
      if (Object.is(value, slot.v)) return;
      slot.v = value; H.dirty = true;
      if (!H.inReact && H.sync) render();
    };
    return [slot.v, set];
  };
  const useRef = (init: unknown) => { const i = H.i++; if (!H.slots[i]) H.slots[i] = { current: init }; return H.slots[i]; };
  const useMemo = (fn: () => unknown, deps: unknown[]) => {
    const i = H.i++; const slot = H.slots[i];
    if (slot && !changed(slot.deps, deps)) return slot.v;
    H.slots[i] = { v: fn(), deps }; return H.slots[i].v;
  };
  const useEffect = (fn: () => (() => void) | void, deps?: unknown[]) => {
    const i = H.i++; if (!H.slots[i]) H.slots[i] = {};
    if (!H.slots[i].deps || changed(H.slots[i].deps, deps)) H.pending.push({ i, fn, deps });
  };
  const createElement = (type: unknown, props: Record<string, unknown> | null) => ({ type, props: props ?? {} });
  const api = { createContext: () => ({ Provider: "Provider" }), useContext: () => null, useState, useRef, useMemo, useEffect, createElement, Fragment: "Fragment" };
  return { ...api, default: api };
});
vi.mock("react/jsx-runtime", () => ({ jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }), Fragment: "Fragment" }));
vi.mock("react/jsx-dev-runtime", () => ({ jsxDEV: (type: unknown, props: unknown) => ({ type, props }), Fragment: "Fragment" }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined } }));
vi.mock("expo-local-authentication", () => ({ hasHardwareAsync: async () => false, isEnrolledAsync: async () => false, supportedAuthenticationTypesAsync: async () => [], AuthenticationType: { FACIAL_RECOGNITION: 2 } }));
vi.mock("@/config/firebase", () => ({
  auth: {}, db: {}, functions: {}, doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(), httpsCallable: vi.fn(), serverTimestamp: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(), signOut: vi.fn(async () => undefined),
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => { H.authCallback = callback; return () => { H.authCallback = null; }; },
}));
vi.mock("@/config/holobots", () => ({ createGenesisStarterHolobot: vi.fn(), getHolobotRank: vi.fn() }));
vi.mock("@/lib/async", () => ({ AUTH_TIMEOUT_MS: 1, FIRESTORE_TIMEOUT_MS: 1, withTimeout: (p: unknown) => p }));
vi.mock("@/lib/battleCards/catalog", () => ({ getGenesisStarterDeckGrants: vi.fn() }));
vi.mock("@/lib/purchases", () => ({ initPurchases: vi.fn(async () => undefined) }));
vi.mock("@/lib/syncProgression", () => ({ getSyncRank: vi.fn() }));
vi.mock("@/lib/profile", () => ({
  computeLeaderboardScore: vi.fn(), updateUserProfile: vi.fn(async () => undefined),
  subscribeToUserProfile: (uid: string, next: (p: unknown) => void, fail: (e: Error) => void) => {
    const sub = { uid, next: (p: unknown) => { if (!sub.closed) next(p); }, fail: (e: Error) => { if (!sub.closed) fail(e); }, unsubscribe: () => { sub.closed = true; }, closed: false };
    H.subs.push(sub);
    return sub.unsubscribe;
  },
}));

import { AuthProvider } from "../AuthContext";

const state = (user: string | null, profile: string | null, loading: boolean, error: string | null) => JSON.stringify({ user, profile, loading, error });
const pilot = { uid: "pilot-1" };
// Complete progression fields and a claimed starter deck, so the existing backfill effect has nothing to write.
const profileDoc = { id: "pilot-1", holobots: [], leaderboardScore: 0, lifetimeSyncPoints: 0, seasonSyncPoints: 0, syncRank: "Rookie", starter_deck_claimed: true };

async function signedIn(sync: boolean) {
  H.sync = sync;
  H.component = AuthProvider as never;
  render();
  await new Promise((resolve) => setTimeout(resolve, 0)); // preferences + Face ID probes settle
  if (H.dirty) render();
  H.authCallback!(pilot);
  if (H.dirty) render();
  H.states = [];
  H.renders = 0;
}

beforeEach(() => { H.slots = []; H.states = []; H.subs = []; H.renders = 0; H.authCallback = null; H.dirty = false; });
afterEach(() => { H.sync = false; });

describe.each([false, true])("AuthProvider profile read (unbatched callbacks: %s)", (sync) => {
  it("without retryProfile: the original sequence (read starts the render after sign-in; success; failure)", async () => {
    await signedIn(sync);
    // signedIn() ran the sign-in render and the profile effect that subscribes.
    expect(H.subs).toHaveLength(1);
    expect(H.value!.profileLoading).toBe(true);
    expect(H.value!.profileError).toBeNull();
    H.subs[0].next(profileDoc); if (H.dirty) render();
    expect(H.states).toEqual([state("pilot-1", "pilot-1", true, null), state("pilot-1", "pilot-1", false, null)].slice(sync ? 0 : 1));
    // Exactly one render per changed setter (none for the error, which a non-retried read never touches).
    expect(H.renders).toBe(sync ? 2 : 1);
  });

  it("without retryProfile: a failed read, then a new user object for the same uid clears the error up front as before", async () => {
    await signedIn(sync);
    H.subs[0].fail(new Error("permission-denied")); if (H.dirty) render();
    expect(H.value!.profileError).toBe("permission-denied");
    H.states = [];
    H.authCallback!({ uid: "pilot-1" }); if (H.dirty) render();
    expect(H.subs[0].closed).toBe(true);
    expect(H.subs).toHaveLength(2);
    expect(H.states[H.states.length - 1]).toBe(state("pilot-1", null, true, null));
  });

  it("sign-out resets the profile state", async () => {
    await signedIn(sync);
    H.subs[0].next(profileDoc); if (H.dirty) render();
    H.authCallback!(null); if (H.dirty) render();
    expect(H.states[H.states.length - 1]).toBe(state(null, null, false, null));
    expect(H.subs[0].closed).toBe(true);
  });

  it.each<[string, unknown, string]>([
    ["a profile", profileDoc, state("pilot-1", "pilot-1", false, null)],
    ["no document", null, state("pilot-1", null, false, null)],
  ])("retryProfile after a failed read keeps the error until the read answers (%s)", async (_name, answer, final) => {
    await signedIn(sync);
    H.subs[0].fail(new Error("permission-denied")); if (H.dirty) render();
    H.states = [];
    H.value!.retryProfile(); if (H.dirty) render();
    expect(H.subs[0].closed).toBe(true);
    expect(H.subs).toHaveLength(2);
    expect(H.value!.profileLoading).toBe(true);
    expect(H.value!.profileError).toBe("permission-denied");
    H.subs[1].next(answer); if (H.dirty) render();
    expect(H.states[H.states.length - 1]).toBe(final);
    // LiteApp covers the whole app only for "signed in, no profile, loading, no error": a retry must never show it.
    expect(H.states).not.toContain(state("pilot-1", null, true, null));
  });

  it("retryProfile then another failure reports the new error", async () => {
    await signedIn(sync);
    H.subs[0].fail(new Error("permission-denied")); if (H.dirty) render();
    H.value!.retryProfile(); if (H.dirty) render();
    H.subs[1].fail(new Error("unavailable")); if (H.dirty) render();
    expect(H.states[H.states.length - 1]).toBe(state("pilot-1", null, false, "unavailable"));
  });
});

describe("shared AuthContext sign-in order", () => {
  it("still sets the user before the profile read starts (lite #142's same-batch read stays off the original app)", () => {
    const source = readFileSync(path.resolve(__dirname, "../AuthContext.tsx"), "utf8");
    expect(source).not.toMatch(/setProfileLoading\(true\);\s*setUser\(nextUser\)/);
    expect(source.match(/setUser\(nextUser\)/g)).toHaveLength(2);
  });
});
