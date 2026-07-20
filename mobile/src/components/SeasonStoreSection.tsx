import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { PurchasesPackage } from "react-native-purchases";

import { useAuth } from "@/contexts/AuthContext";
import {
  ENTITLEMENT_BATTLE_PASS,
  ENTITLEMENT_GENESIS_SQUAD,
  GENESIS_IAP_PRODUCT_IDS,
  IAP_PRODUCT_BATTLE_PASS_MONTHLY,
  describeEntitlementGrant,
} from "@/lib/monetization";
import { getOfferings, isIapEnabled, purchasePackage } from "@/lib/purchases";

/**
 * Season 1 store: the two real-money offers (Genesis Squad unlock + Battle
 * Pass monthly) from the RevenueCat `default` offering. Renders nothing
 * useful unless the purchases layer is live (see useIapEnabled); fulfillment
 * is server-only via the RevenueCat webhook — on success we just tell the
 * pilot the server is delivering and let the profile listener update.
 */

const TERMS_URL = "https://holobots.fun/terms";
const PRIVACY_URL = "https://holobots.fun/privacy";

export type SeasonStoreFeedback = {
  accent?: string;
  lines?: string[];
  message?: string;
  title: string;
};

/** True once the remote iapEnabled flag (plus key + platform) resolves. */
export function useIapEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isIapEnabled().then((value) => {
      if (!cancelled) {
        setEnabled(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
}

type StorePackages = {
  battlePass: PurchasesPackage | null;
  genesis: PurchasesPackage | null;
};

function pickStorePackages(packages: readonly PurchasesPackage[]): StorePackages {
  let genesis: PurchasesPackage | null = null;
  let battlePass: PurchasesPackage | null = null;

  for (const pkg of packages) {
    const productId = pkg.product.identifier;
    if ((GENESIS_IAP_PRODUCT_IDS as readonly string[]).includes(productId)) {
      genesis = pkg;
    } else if (productId === IAP_PRODUCT_BATTLE_PASS_MONTHLY) {
      battlePass = pkg;
    }
  }

  return { battlePass, genesis };
}

export function SeasonStoreSection({
  onFeedback,
}: {
  onFeedback: (feedback: SeasonStoreFeedback) => void;
}) {
  const { profile } = useAuth();
  const [packages, setPackages] = useState<StorePackages | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);

  const genesisGrant = describeEntitlementGrant(ENTITLEMENT_GENESIS_SQUAD);
  const battlePassGrant = describeEntitlementGrant(ENTITLEMENT_BATTLE_PASS);

  const ownsGenesis = Boolean(profile?.genesisSquadClaimed);
  const battlePassActiveUntil = Number(
    (profile as { battlePassActiveUntil?: unknown } | null)?.battlePassActiveUntil || 0,
  );
  const battlePassActive = battlePassActiveUntil > Date.now();

  const loadOfferings = useCallback(async () => {
    setLoadFailed(false);
    setPackages(null);
    const offerings = await getOfferings();
    const available = offerings?.current?.availablePackages ?? [];
    if (available.length === 0) {
      setLoadFailed(true);
      return;
    }
    setPackages(pickStorePackages(available));
  }, []);

  useEffect(() => {
    void loadOfferings();
  }, [loadOfferings]);

  const buy = async (pkg: PurchasesPackage) => {
    const productId = pkg.product.identifier;
    try {
      setPendingProductId(productId);
      const customerInfo = await purchasePackage(pkg);
      if (!customerInfo) {
        // Dormant or the pilot cancelled the StoreKit sheet: stay quiet.
        return;
      }
      onFeedback({
        accent: "#f0bf14",
        message:
          "The server is delivering your rewards — they will appear on your account in a moment. Already purchased before? Use Restore Purchases in Pilot Stats → Settings.",
        title: "PURCHASE COMPLETE",
      });
    } catch (error) {
      Alert.alert(
        "Purchase failed",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setPendingProductId(null);
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>SEASON 1</Text>
        <Text style={styles.title}>SUPPLY DROP</Text>
        <Text style={styles.copy}>
          Optional paid unlocks. Every purchase is delivered by the server to your
          account — no gameplay advantage is exclusive to paying pilots.
        </Text>
      </View>

      {packages === null && !loadFailed ? (
        <View style={styles.card}>
          <Text style={styles.meta}>Contacting the App Store…</Text>
        </View>
      ) : null}

      {loadFailed ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>STORE UNAVAILABLE</Text>
          <Text style={styles.meta}>
            The App Store catalog could not be loaded. Check your connection and try
            again.
          </Text>
          <Pressable onPress={() => void loadOfferings()} style={styles.buyButton}>
            <Text style={styles.buyButtonText}>RETRY</Text>
          </Pressable>
        </View>
      ) : null}

      {packages?.genesis ? (
        <View style={styles.offerCard}>
          <Text style={styles.cardTitle}>{genesisGrant?.title.toUpperCase()}</Text>
          <Text style={styles.price}>
            {`${packages.genesis.product.priceString} • ONE-TIME`}
          </Text>
          <Text style={styles.meta}>{genesisGrant?.description}</Text>
          {ownsGenesis ? (
            <Text style={styles.owned}>OWNED ✓</Text>
          ) : (
            <Pressable
              disabled={pendingProductId !== null}
              onPress={() => void buy(packages.genesis as PurchasesPackage)}
              style={[styles.buyButton, pendingProductId !== null ? styles.buttonDisabled : null]}
            >
              <Text style={styles.buyButtonText}>
                {pendingProductId === packages.genesis.product.identifier
                  ? "..."
                  : `UNLOCK ${packages.genesis.product.priceString}`}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {packages?.battlePass ? (
        <View style={styles.offerCard}>
          <Text style={styles.cardTitle}>{battlePassGrant?.title.toUpperCase()}</Text>
          <Text style={styles.price}>
            {`${packages.battlePass.product.priceString} / MONTH`}
          </Text>
          <Text style={styles.meta}>{battlePassGrant?.description}</Text>
          {battlePassActive ? (
            <Text style={styles.owned}>
              {`ACTIVE THROUGH ${new Date(battlePassActiveUntil).toLocaleDateString()}`}
            </Text>
          ) : (
            <Pressable
              disabled={pendingProductId !== null}
              onPress={() => void buy(packages.battlePass as PurchasesPackage)}
              style={[styles.buyButton, pendingProductId !== null ? styles.buttonDisabled : null]}
            >
              <Text style={styles.buyButtonText}>
                {pendingProductId === packages.battlePass.product.identifier
                  ? "..."
                  : `SUBSCRIBE ${packages.battlePass.product.priceString}/MO`}
              </Text>
            </Pressable>
          )}
          <Text style={styles.finePrint}>
            Auto-renews monthly until cancelled. Payment is charged to your Apple
            account at confirmation; manage or cancel any time in App Store
            subscription settings.
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.finePrint}>
          Purchases are tied to your pilot account and restorable on any device via
          Pilot Stats → Settings → Restore Purchases.
        </Text>
        <View style={styles.linksRow}>
          <Pressable onPress={() => void Linking.openURL(TERMS_URL)}>
            <Text style={styles.link}>Terms of Use</Text>
          </Pressable>
          <Text style={styles.finePrint}> • </Text>
          <Pressable onPress={() => void Linking.openURL(PRIVACY_URL)}>
            <Text style={styles.link}>Privacy Policy</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  buttonDisabled: {
    opacity: 0.5,
  },
  buyButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    borderRadius: 8,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  buyButtonText: {
    color: "#050606",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
  },
  card: {
    backgroundColor: "#07080d",
    borderColor: "#2a2b33",
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 14,
    padding: 16,
  },
  cardTitle: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  copy: {
    color: "#ddd2b5",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  eyebrow: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  finePrint: {
    color: "#8f8a76",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
  },
  hero: {
    backgroundColor: "#07080d",
    borderColor: "#f0bf14",
    borderRadius: 12,
    borderWidth: 4,
    marginBottom: 14,
    padding: 18,
  },
  link: {
    color: "#17d9ff",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 10,
    textDecorationLine: "underline",
  },
  linksRow: {
    alignItems: "center",
    flexDirection: "row",
  },
  meta: {
    color: "#ddd2b5",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  offerCard: {
    backgroundColor: "#07080d",
    borderColor: "#f0bf14",
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 14,
    padding: 16,
  },
  owned: {
    color: "#38e08c",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 12,
  },
  price: {
    color: "#fef1e0",
    fontSize: 22,
    fontWeight: "900",
    marginTop: 6,
  },
  title: {
    color: "#fef1e0",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 4,
  },
  section: {
    paddingBottom: 8,
  },
});
