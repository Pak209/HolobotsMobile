import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOGIN_FALLBACK_ERROR, loginErrorText } from "../loginErrors";

const firebaseError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });

describe("lite login error copy (lite-button-crawl-1)", () => {
  it("never shows a raw Firebase Auth error", () => {
    // Seen in the Release crawl: a wrong password printed "Firebase: Error (auth/wrong-password)." under the form.
    for (const code of ["auth/wrong-password", "auth/invalid-credential", "auth/user-not-found", "auth/too-many-requests", "auth/some-new-code"]) {
      const text = loginErrorText(firebaseError(code));
      expect(text).not.toMatch(/firebase|auth\//i);
    }
    expect(loginErrorText(firebaseError("auth/invalid-credential"))).toBe("That email and password don't match. Check them and try again.");
    expect(loginErrorText(firebaseError("auth/some-new-code"))).toBe(LOGIN_FALLBACK_ERROR);
    expect(loginErrorText(new Error("Firebase: Error (auth/internal-error)."))).toBe(LOGIN_FALLBACK_ERROR);
  });
  it("keeps AuthContext's own player messages", () => {
    const own = "That email already has a Holobots account. Please sign in instead.";
    expect(loginErrorText(new Error(own))).toBe(own);
    expect(loginErrorText(new Error("Sign-in timed out. Check your connection and try again."))).toBe("Sign-in timed out. Check your connection and try again.");
    expect(loginErrorText("nope")).toBe(LOGIN_FALLBACK_ERROR);
  });
  it("LoginScreen routes every submit failure through it", () => {
    const src = readFileSync(fileURLToPath(new URL("../../screens/LoginScreen.tsx", import.meta.url) as unknown as string), "utf8");
    expect(src).toContain("setError(loginErrorText(nextError));");
    expect(src).not.toContain("nextError.message");
  });
});
