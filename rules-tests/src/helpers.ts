import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const RULES_PATH = path.join(REPO_ROOT, "firestore.rules");

function parseEmulatorHost(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
  const [host, portStr] = raw.split(":");
  const port = Number.parseInt(portStr ?? "8085", 10);
  return { host: host || "127.0.0.1", port: Number.isFinite(port) ? port : 8085 };
}

export async function initTestEnv(): Promise<RulesTestEnvironment> {
  const { host, port } = parseEmulatorHost();

  return initializeTestEnvironment({
    projectId: "holobots-rules-test",
    firestore: {
      rules: readFileSync(RULES_PATH, "utf8"),
      host,
      port,
    },
  });
}

export function authedDb(env: RulesTestEnvironment, uid: string) {
  return env.authenticatedContext(uid).firestore();
}

export function unauthedDb(env: RulesTestEnvironment) {
  return env.unauthenticatedContext().firestore();
}

export async function seedDoc(
  env: RulesTestEnvironment,
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(path).set(data);
  });
}

export async function seedUser(
  env: RulesTestEnvironment,
  uid: string,
  data: Record<string, unknown>,
): Promise<void> {
  await seedDoc(env, `users/${uid}`, data);
}

/** The checked-in firestore.rules text (for suites that derive a variant of it). */
export function readRulesText(): string {
  return readFileSync(RULES_PATH, "utf8");
}

/**
 * A RulesTestEnvironment over arbitrary rules text under its own projectId,
 * e.g. a deliberately weakened copy of firestore.rules for a known-bad
 * control. The emulator keeps rules per project, so this never replaces the
 * rules the other suites load under "holobots-rules-test".
 */
export async function initTestEnvWithRules(
  rules: string,
  projectId: string,
): Promise<RulesTestEnvironment> {
  const { host, port } = parseEmulatorHost();

  return initializeTestEnvironment({
    projectId,
    firestore: { rules, host, port },
  });
}
