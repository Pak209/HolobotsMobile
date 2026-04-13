import { auth, httpsCallable, functions } from "@/config/firebase";

type CreateWebviewBridgeTokenResponse = {
  token: string;
};

const createWebviewBridgeToken = httpsCallable<void, CreateWebviewBridgeTokenResponse>(
  functions,
  "createWebviewBridgeToken",
);

export async function getWebviewBridgeToken() {
  if (!auth.currentUser) {
    throw new Error("You must be signed in before opening the web sections.");
  }

  await auth.currentUser.getIdToken(true);
  const response = await createWebviewBridgeToken();

  if (!response.data?.token) {
    throw new Error("Bridge token was not returned by Firebase Functions.");
  }

  return response.data.token;
}

export function buildBridgeInjectionScript(token: string) {
  const serializedToken = JSON.stringify(token);

  return `
    window.__HOLOBOTS_NATIVE_BRIDGE__ = { customToken: ${serializedToken} };
    true;
  `;
}
