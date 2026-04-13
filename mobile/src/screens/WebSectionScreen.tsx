import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import { HomeCogButton } from "@/components/HomeCogButton";
import { buildBridgeInjectionScript, getWebviewBridgeToken } from "@/lib/webAuthBridge";

type WebSectionScreenProps = {
  uri: string;
};

export function WebSectionScreen({ uri }: WebSectionScreenProps) {
  const [bridgeToken, setBridgeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadBridgeToken() {
      try {
        setLoading(true);
        setError(null);
        const token = await getWebviewBridgeToken();

        if (isMounted) {
          setBridgeToken(token);
        }
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : "Unable to connect app login to this section.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadBridgeToken();

    return () => {
      isMounted = false;
    };
  }, [uri]);

  const injectedBridge = useMemo(
    () => (bridgeToken ? buildBridgeInjectionScript(bridgeToken) : "true;"),
    [bridgeToken],
  );

  return (
    <View style={styles.page}>
      <HomeCogButton />
      {loading ? (
        <View style={styles.overlay}>
          <ActivityIndicator color="#f5c40d" size="large" />
          <Text style={styles.overlayText}>Connecting your Holobots session…</Text>
        </View>
      ) : null}
      {error ? (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>Web Login Bridge Failed</Text>
          <Text style={styles.errorCopy}>{error}</Text>
        </View>
      ) : null}
      {!error ? (
        <WebView
          injectedJavaScriptBeforeContentLoaded={injectedBridge}
          source={{ uri }}
          style={styles.webview}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  errorCopy: {
    color: "#f5e9ca",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  errorTitle: {
    color: "#ff8269",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: "#050606",
    justifyContent: "center",
    paddingHorizontal: 24,
    zIndex: 5,
  },
  overlayText: {
    color: "#fef1e0",
    fontSize: 15,
    marginTop: 12,
  },
  page: {
    flex: 1,
    backgroundColor: "#050606",
  },
  webview: {
    flex: 1,
  },
});
