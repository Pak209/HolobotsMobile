import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, Image } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { GameFeedbackModal } from "@/components/GameFeedbackModal";
import { HomeCogButton } from "@/components/HomeCogButton";
import { getMarketplaceItemImageSource, getPartImageSource } from "@/config/gameAssets";
import { BATTLE_CARD_TEMPLATES } from "@/lib/battleCards/catalog";
import { useAuth } from "@/contexts/AuthContext";
import {
  purchaseMarketplaceBoosterAuthoritative,
  purchaseMarketplaceItemAuthoritative,
  purchaseMarketplacePartAuthoritative,
} from "@/lib/economyClient";
import { deriveReferralCode, GENESIS_BOTS, GENESIS_REFERRALS_REQUIRED } from "@/lib/genesis";
import {
  applyReferralCodeAuthoritative,
  claimGenesisSquadAuthoritative,
} from "@/lib/genesisClient";
import {
  getMarketplacePrice,
  MARKETPLACE_BOOSTER_PRICES,
  MARKETPLACE_PART_CATALOG,
  WILDCARD_PACK_COOLDOWN_MS,
} from "@/lib/marketplace";

const tabs = ["Items", "Parts", "Booster Packs", "Genesis"] as const;
type MarketplaceTab = (typeof tabs)[number];

const itemDescriptions: Record<string, string> = {
  "Arena Pass": "Grants entry to one arena battle without costing HOLOS tokens.",
  "Energy Refill": "Instantly restores your daily energy to full.",
  "EXP Booster": "Doubles experience gained from battles for 24 hours.",
  "Gacha Ticket": "Can be used for one pull in the Gacha system.",
  "Rank Skip": "Skip to the next rank instantly.",
  "Wildcard Blueprints": "5 blueprint pieces assignable to ANY Holobot. One pack per week.",
};

function getMoveDisplayName(templateId: string): string {
  return BATTLE_CARD_TEMPLATES[templateId]?.name ?? templateId;
}

function HolosMark() {
  return (
    <Svg width={34} height={34} viewBox="0 0 34 34">
      <Circle cx={17} cy={17} r={13} stroke="#00e3ff" strokeWidth={3.5} fill="none" />
      <Circle cx={17} cy={17} r={6} fill="#07080d" />
    </Svg>
  );
}

const marketplaceBoosterPacks = [
  {
    accent: "#17d9ff",
    description: "Guaranteed 1 Part + 1 Item + 1 Move unlock with standard drop rates.",
    guaranteed: 3,
    icon: "□",
    id: "common",
    name: "Common Rank Booster",
    price: MARKETPLACE_BOOSTER_PRICES.common,
    subtitle: "STANDARD DROP RATES",
  },
  {
    accent: "#2f87ff",
    description: "Guaranteed 1 Part + 1 Item + 1 Move unlock with improved drop rates.",
    guaranteed: 3,
    icon: "⬡",
    id: "champion",
    name: "Champion Rank Booster",
    price: MARKETPLACE_BOOSTER_PRICES.champion,
    subtitle: "IMPROVED DROP RATES",
  },
  {
    accent: "#ae4cff",
    description: "Guaranteed 1 Part + 1 Item + 1 Move unlock with enhanced rare-plus chances.",
    guaranteed: 3,
    icon: "✦",
    id: "rare",
    name: "Rare Rank Booster",
    price: MARKETPLACE_BOOSTER_PRICES.rare,
    subtitle: "ENHANCED RARE+ CHANCES",
  },
  {
    accent: "#ff3b7d",
    description:
      "Guaranteed 1 Part + 1 Item + 1 Move unlock with premium drop rates. Rare chance of a GOD PACK: everything tripled.",
    guaranteed: 3,
    icon: "★",
    id: "elite",
    name: "Elite Rank Booster",
    price: MARKETPLACE_BOOSTER_PRICES.elite,
    subtitle: "PREMIUM RATES • GOD PACK ⚡",
  },
] as const;

export function MarketplaceScreen() {
  const { user, profile, updateProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<MarketplaceTab>("Items");
  const [pendingPurchaseId, setPendingPurchaseId] = useState<string | null>(null);
  const [referralCodeInput, setReferralCodeInput] = useState("");
  const [feedback, setFeedback] = useState<{
    accent?: string;
    lines?: string[];
    message?: string;
    title: string;
  } | null>(null);
  const items = [
    { name: "Arena Pass", quantity: profile?.arena_passes || 0 },
    { name: "Gacha Ticket", quantity: profile?.gachaTickets || 0 },
    { name: "Energy Refill", quantity: profile?.energy_refills || 0 },
    { name: "EXP Booster", quantity: profile?.exp_boosters || 0 },
    { name: "Rank Skip", quantity: profile?.rank_skips || 0 },
    { name: "Wildcard Blueprints", quantity: profile?.wildcardBlueprints || 0 },
  ];

  const myReferralCode = user ? deriveReferralCode(user.uid) : "";

  // Lazy-publish the (uid-derived) code onto the profile so friends'
  // applyReferralCode calls can find this account by query.
  useEffect(() => {
    if (activeTab !== "Genesis" || !profile || !myReferralCode) {
      return;
    }
    if (profile.referralCode !== myReferralCode) {
      void updateProfile({ referralCode: myReferralCode }).catch(() => undefined);
    }
  }, [activeTab, myReferralCode, profile, updateProfile]);
  // Owned counts per catalog part. Legacy inventory names may carry a rarity
  // suffix ("Quantum Core (Epic)"), so match on the stripped base name.
  const ownedPartCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const part of profile?.parts || []) {
      const name = String((part as { name?: string }).name || "")
        .replace(/\s*\(.*\)\s*$/, "")
        .trim()
        .toLowerCase();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return counts;
  }, [profile?.parts]);

  const totalOwnedParts = profile?.parts?.length || 0;

  const purchasePart = async (partId: string) => {
    if (!profile) {
      Alert.alert("Sign in required", "Please sign in before making a purchase.");
      return;
    }

    const offer = MARKETPLACE_PART_CATALOG.find((entry) => entry.id === partId);
    if (!offer) {
      return;
    }

    if ((profile.holosTokens || 0) < offer.price) {
      Alert.alert("Not enough Holos", `You need ${offer.price - (profile.holosTokens || 0)} more Holos.`);
      return;
    }

    try {
      setPendingPurchaseId(partId);
      const part = await purchaseMarketplacePartAuthoritative(profile, updateProfile, partId);
      setFeedback({
        accent: "#17d9ff",
        message: `${part.name} has been added to your parts inventory. Equip it from a holobot's loadout.`,
        title: "Part Acquired",
      });
    } catch (error) {
      Alert.alert("Purchase failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setPendingPurchaseId(null);
    }
  };

  const purchaseItem = async (itemName: string) => {
    if (!profile) {
      Alert.alert("Sign in required", "Please sign in before making a purchase.");
      return;
    }

    const price = getMarketplacePrice(itemName);
    if ((profile.holosTokens || 0) < price) {
      Alert.alert("Not enough Holos", `You need ${price - (profile.holosTokens || 0)} more Holos.`);
      return;
    }

    try {
      setPendingPurchaseId(itemName);
      await purchaseMarketplaceItemAuthoritative(profile, updateProfile, itemName);
      setFeedback({
        accent: "#17d9ff",
        message: `${itemName} has been added to your account.`,
        title: "Purchase Complete",
      });
    } catch (error) {
      Alert.alert("Purchase failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setPendingPurchaseId(null);
    }
  };

  const purchaseBoosterPack = async (packId: (typeof marketplaceBoosterPacks)[number]["id"]) => {
    if (!profile) {
      Alert.alert("Sign in required", "Please sign in before making a purchase.");
      return;
    }

    const pack = marketplaceBoosterPacks.find((entry) => entry.id === packId);
    if (!pack) {
      return;
    }

    if ((profile.holosTokens || 0) < pack.price) {
      Alert.alert("Not enough Holos", `You need ${pack.price - (profile.holosTokens || 0)} more Holos.`);
      return;
    }

    try {
      setPendingPurchaseId(pack.id);
      const granted = await purchaseMarketplaceBoosterAuthoritative(profile, updateProfile, pack.id);
      setFeedback(
        granted.godPack
          ? {
              accent: "#f0bf14",
              lines: [
                ...granted.parts.map((part) => `Part: ${part.name}`),
                `Item: ${granted.itemName} ×${granted.itemQuantity}`,
                ...granted.battleCardIds.map((cardId) => `Move unlocked: ${getMoveDisplayName(cardId)}`),
              ],
              message: "The whole pack hit — everything is TRIPLED.",
              title: "⚡ GOD PACK ⚡",
            }
          : {
              accent: pack.accent,
              lines: [
                `Part: ${granted.part.name}`,
                `Item: ${granted.itemName}`,
                `Move unlocked: ${getMoveDisplayName(granted.battleCardId)}`,
              ],
              message: `${pack.name} opened.`,
              title: "Booster Purchased",
            },
      );
    } catch (error) {
      Alert.alert("Purchase failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setPendingPurchaseId(null);
    }
  };

  const shareReferralCode = async () => {
    try {
      await Share.share({
        message: `Join me on Holobots! Use my invite code ${myReferralCode} when you sign up — complete your first workout and we both get rewards.`,
      });
    } catch {
      // Share sheet dismissed — nothing to do.
    }
  };

  const submitReferralCode = async () => {
    const code = referralCodeInput.trim().toUpperCase();
    if (!code) {
      return;
    }
    try {
      setPendingPurchaseId("apply_referral");
      const { referrerUsername } = await applyReferralCodeAuthoritative(code);
      setReferralCodeInput("");
      setFeedback({
        accent: "#17d9ff",
        message: `You're linked to ${referrerUsername}. Complete your first workout to unlock the welcome bonus: 5 Wildcard Blueprints + 200 Holos.`,
        title: "Invite Accepted",
      });
    } catch (error) {
      Alert.alert("Code not applied", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setPendingPurchaseId(null);
    }
  };

  const claimGenesisSquad = async () => {
    try {
      setPendingPurchaseId("claim_genesis");
      const { granted, converted } = await claimGenesisSquadAuthoritative();
      setFeedback({
        accent: "#f0bf14",
        lines: [
          ...granted.map((name) => `${name} joined your roster!`),
          ...converted.map((entry) => `${entry.name} owned — +${entry.blueprints} blueprints instead`),
          "+500 Holos • +50 Sync Points",
          "GENESIS badge unlocked — founders only, forever.",
        ],
        message: "The Genesis Squad is yours.",
        title: "GENESIS SQUAD CLAIMED",
      });
    } catch (error) {
      Alert.alert("Claim failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setPendingPurchaseId(null);
    }
  };

  const renderContent = () => {
    if (activeTab === "Items") {
      return items.map((item) => {
        const affordable = (profile?.holosTokens || 0) >= Number(getMarketplacePrice(item.name));
        // The weekly wildcard pack surfaces its throttle up front instead of
        // failing the purchase with a misleading "not enough Holos".
        const wildcardCooldownMsLeft =
          item.name === "Wildcard Blueprints"
            ? Math.max(0, Number(profile?.lastWildcardPackAt || 0) + WILDCARD_PACK_COOLDOWN_MS - Date.now())
            : 0;
        const onCooldown = wildcardCooldownMsLeft > 0;
        const cooldownDays = Math.max(1, Math.ceil(wildcardCooldownMsLeft / (24 * 60 * 60 * 1000)));
        const disabled = !affordable || onCooldown || pendingPurchaseId === item.name;
        return (
          <View key={item.name} style={styles.itemCard}>
            <View style={styles.itemIconFrame}>
              <Image source={getMarketplaceItemImageSource(item.name)} style={styles.itemIcon} resizeMode="contain" />
            </View>
            <View style={styles.itemBody}>
              <Text style={styles.itemTitle}>{item.name.toUpperCase()}</Text>
              <View style={styles.itemDivider} />
              <Text style={styles.itemCopy}>{itemDescriptions[item.name] || "Usable in the Holobots mobile game."}</Text>
            </View>
            <View style={styles.itemActions}>
              <View style={styles.qtyBox}>
                <View style={styles.priceRow}>
                  <Text style={styles.qtyValue}>{getMarketplacePrice(item.name)}</Text>
                  <HolosMark />
                </View>
              </View>
              <Pressable
                onPress={() => void purchaseItem(item.name)}
                disabled={disabled}
                style={[styles.useButton, disabled ? styles.useButtonDisabled : null]}
              >
                <Text
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  style={[styles.useButtonText, disabled ? styles.useButtonTextDisabled : null]}
                >
                  {pendingPurchaseId === item.name ? "..." : onCooldown ? `${cooldownDays}d` : "BUY"}
                </Text>
              </Pressable>
            </View>
          </View>
        );
      });
    }

    if (activeTab === "Parts") {
      const slotOrder = ["head", "torso", "arms", "core"];
      return slotOrder.map((slot) => {
        const offers = MARKETPLACE_PART_CATALOG.filter((offer) => offer.slot === slot).sort(
          (left, right) => left.price - right.price || left.name.localeCompare(right.name),
        );
        if (offers.length === 0) {
          return null;
        }

        return (
          <View key={slot}>
            <Text style={styles.partSectionLabel}>{`${slot.toUpperCase()} PARTS`}</Text>
            {offers.map((offer) => {
              const image = getPartImageSource(offer.name, offer.slot);
              const owned = ownedPartCounts.get(offer.name.toLowerCase()) || 0;
              const affordable = (profile?.holosTokens || 0) >= offer.price;
              const pending = pendingPurchaseId === offer.id;

              return (
                <View key={offer.id} style={styles.itemCard}>
                  <View style={styles.itemIconFrame}>
                    {image ? <Image source={image} style={styles.itemIcon} resizeMode="contain" /> : null}
                  </View>
                  <View style={styles.itemBody}>
                    <Text style={styles.itemTitle}>{`${offer.name} (${offer.rarity})`.toUpperCase()}</Text>
                    <View style={styles.itemDivider} />
                    <Text style={styles.itemCopy}>{`${offer.slot.toUpperCase()} equipment part. Equip it to a holobot from Inventory.`}</Text>
                    <Text style={styles.partOwned}>{`OWNED x${owned}`}</Text>
                  </View>
                  <View style={styles.itemActions}>
                    <View style={styles.qtyBox}>
                      <View style={styles.priceRow}>
                        <Text
                          adjustsFontSizeToFit
                          numberOfLines={1}
                          style={[styles.qtyValue, styles.partPrice]}
                        >
                          {offer.price.toLocaleString()}
                        </Text>
                        <HolosMark />
                      </View>
                    </View>
                    <Pressable
                      onPress={() => void purchasePart(offer.id)}
                      disabled={!affordable || pending}
                      style={[styles.useButton, (!affordable || pending) ? styles.useButtonDisabled : null]}
                    >
                      <Text style={[styles.useButtonText, (!affordable || pending) ? styles.useButtonTextDisabled : null]}>
                        {pending ? "..." : "BUY"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        );
      });
    }

    if (activeTab === "Booster Packs") {
      return (
        <View style={styles.packsSection}>
          <Text style={styles.packsTitle}>SELECT BOOSTER PACK</Text>
          <Text style={styles.packsSubtitle}>Choose your boost pack and unlock parts, items, and new moves.</Text>
          {marketplaceBoosterPacks.map((pack) => {
            const canAfford = (profile?.holosTokens || 0) >= pack.price;

            return (
              <Pressable key={pack.id} style={[styles.packCard, { borderColor: pack.accent }]}>
                <View style={[styles.packIconFrame, { borderColor: pack.accent }]}>
                  <Text style={[styles.packIconGlyph, { color: pack.accent }]}>{pack.icon}</Text>
                </View>
                <View style={styles.packBody}>
                  <Text style={styles.packTitle}>{pack.name.toUpperCase()}</Text>
                  <Text style={styles.packGuaranteed}>{`${pack.guaranteed} ITEMS GUARANTEED`}</Text>
                  <Text style={styles.packSubtitleLine}>{pack.subtitle}</Text>
                  <Text style={styles.packDescription}>{pack.description}</Text>
                </View>
                <View style={styles.packRight}>
                  <View style={[styles.packPriceBox, { borderColor: pack.accent }]}>
                    <Text style={styles.packPrice}>{pack.price.toLocaleString()}</Text>
                    <HolosMark />
                  </View>
                  <Pressable
                    onPress={() => void purchaseBoosterPack(pack.id)}
                    disabled={!canAfford || pendingPurchaseId === pack.id}
                    style={[styles.packBuyButton, (!canAfford || pendingPurchaseId === pack.id) ? styles.useButtonDisabled : null]}
                  >
                    <Text style={[styles.packBuyText, (!canAfford || pendingPurchaseId === pack.id) ? styles.useButtonTextDisabled : null]}>
                      {pendingPurchaseId === pack.id ? "..." : canAfford ? "BUY" : "NEED MORE"}
                    </Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          })}
        </View>
      );
    }

    if (activeTab === "Genesis") {
      const qualified = Number(profile?.referrals?.qualified || 0);
      const pending = Number(profile?.referrals?.pending || 0);
      const claimed = Boolean(profile?.genesisSquadClaimed);
      const claimable = !claimed && qualified >= GENESIS_REFERRALS_REQUIRED;
      const wildcards = Number(profile?.wildcardBlueprints || 0);

      return (
        <View style={styles.packsSection}>
          <View style={styles.genesisHero}>
            <Text style={styles.genesisEyebrow}>FOUNDERS ONLY</Text>
            <Text style={styles.genesisTitle}>GENESIS SQUAD</Text>
            <Text style={styles.genesisCopy}>
              {`Recruit ${GENESIS_REFERRALS_REQUIRED} friends and unlock ${GENESIS_BOTS.join(" + ")}, a 500 Holos + 50 SP celebration pack, and the permanent GENESIS badge. Every extra recruit after that pays 5 Wildcard Blueprints — and your 10th recruit drops an Elite Pack's worth of Gacha Tickets.`}
            </Text>
            {profile?.genesisBadge ? (
              <Text style={styles.genesisBadge}>★ GENESIS FOUNDER ★</Text>
            ) : null}
          </View>

          <View style={styles.genesisCard}>
            <Text style={styles.genesisCardTitle}>YOUR INVITE CODE</Text>
            <Text style={styles.genesisCode}>{myReferralCode || "—"}</Text>
            <Text style={styles.genesisMeta}>
              {`Recruits qualify when they finish their first workout. Qualified: ${qualified} / ${GENESIS_REFERRALS_REQUIRED}${pending > 0 ? ` • Pending: ${pending}` : ""}`}
            </Text>
            <Pressable onPress={() => void shareReferralCode()} style={styles.genesisButton}>
              <Text style={styles.genesisButtonText}>SHARE INVITE</Text>
            </Pressable>
            {claimed ? (
              <Text style={styles.genesisClaimed}>GENESIS SQUAD CLAIMED ✓</Text>
            ) : (
              <Pressable
                onPress={() => void claimGenesisSquad()}
                disabled={!claimable || pendingPurchaseId === "claim_genesis"}
                style={[styles.genesisButton, styles.genesisClaimButton, !claimable ? styles.useButtonDisabled : null]}
              >
                <Text style={[styles.genesisButtonText, !claimable ? styles.useButtonTextDisabled : null]}>
                  {pendingPurchaseId === "claim_genesis"
                    ? "..."
                    : claimable
                      ? "CLAIM GENESIS SQUAD"
                      : `${GENESIS_REFERRALS_REQUIRED - qualified} MORE TO CLAIM`}
                </Text>
              </Pressable>
            )}
          </View>

          {!profile?.referredBy ? (
            <View style={styles.genesisCard}>
              <Text style={styles.genesisCardTitle}>GOT AN INVITE CODE?</Text>
              <Text style={styles.genesisMeta}>
                Enter it within your first week, then complete a workout: you get 5 Wildcard Blueprints + 200 Holos.
              </Text>
              <TextInput
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
                onChangeText={setReferralCodeInput}
                placeholder="FRIEND CODE"
                placeholderTextColor="#6b6b58"
                style={styles.genesisInput}
                value={referralCodeInput}
              />
              <Pressable
                onPress={() => void submitReferralCode()}
                disabled={!referralCodeInput.trim() || pendingPurchaseId === "apply_referral"}
                style={[
                  styles.genesisButton,
                  (!referralCodeInput.trim() || pendingPurchaseId === "apply_referral") ? styles.useButtonDisabled : null,
                ]}
              >
                <Text
                  style={[
                    styles.genesisButtonText,
                    (!referralCodeInput.trim() || pendingPurchaseId === "apply_referral") ? styles.useButtonTextDisabled : null,
                  ]}
                >
                  {pendingPurchaseId === "apply_referral" ? "..." : "APPLY CODE"}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.genesisCard}>
              <Text style={styles.genesisCardTitle}>INVITE LINKED</Text>
              <Text style={styles.genesisMeta}>
                {profile?.referralQualified
                  ? "Welcome bonus delivered. Wildcards can be assigned from any Holobot's stats screen."
                  : "Complete your first workout to unlock the welcome bonus: 5 Wildcard Blueprints + 200 Holos."}
              </Text>
            </View>
          )}

          <View style={styles.genesisCard}>
            <Text style={styles.genesisCardTitle}>WILDCARD BLUEPRINTS</Text>
            <Text style={styles.genesisWildcardCount}>{`×${wildcards}`}</Text>
            <Text style={styles.genesisMeta}>
              Assign them to ANY Holobot from its stats screen. Earn more from referrals, Legendary gacha drops, or the weekly pack in Items.
            </Text>
          </View>
        </View>
      );
    }

    return null;
  };

  return (
    <>
      <View style={styles.page}>
        <HomeCogButton showSettings={false} />
        <View style={styles.header}>
          <Text style={styles.headerEyebrow}>SHOP</Text>
          <Text style={styles.headerTitle}>Marketplace</Text>
          <Text style={styles.headerMeta}>
            {`Holos ${profile?.holosTokens || 0} • Tickets ${profile?.gachaTickets || 0} • Parts ${totalOwnedParts}`}
          </Text>
        </View>

        <View style={styles.tabRow}>
          {tabs.map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[styles.tabButton, activeTab === tab ? styles.tabButtonActive : null]}
            >
              <Text style={[styles.tabButtonText, activeTab === tab ? styles.tabButtonTextActive : null]}>
                {tab}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {renderContent()}
        </ScrollView>
      </View>
      <GameFeedbackModal
        visible={!!feedback}
        title={feedback?.title || ""}
        message={feedback?.message}
        lines={feedback?.lines}
        accent={feedback?.accent}
        onClose={() => setFeedback(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: "#050606",
    borderBottomColor: "#f0bf14",
    borderBottomWidth: 3,
    paddingBottom: 18,
    paddingHorizontal: 24,
    paddingTop: 94,
  },
  headerEyebrow: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  headerTitle: {
    color: "#fef1e0",
    fontSize: 34,
    fontWeight: "900",
    marginTop: 6,
  },
  headerMeta: {
    color: "#ddd2b5",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  page: {
    backgroundColor: "#f5c40d",
    flex: 1,
  },
  itemActions: {
    alignItems: "flex-end",
    justifyContent: "flex-start",
    marginLeft: 0,
    marginRight: 10,
    minHeight: 112,
    width: 84,
  },
  itemBody: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
    paddingRight: 6,
  },
  itemCard: {
    backgroundColor: "#07080d",
    borderColor: "#f0bf14",
    borderWidth: 4,
    flexDirection: "row",
    gap: 9,
    minHeight: 146,
    padding: 12,
  },
  itemCopy: {
    color: "#aeb6c3",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
  itemDivider: {
    backgroundColor: "#344057",
    height: 4,
    marginTop: 8,
    width: "96%",
  },
  itemIcon: {
    height: 72,
    width: 72,
  },
  itemIconFrame: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#7b6312",
    borderWidth: 1,
    height: 84,
    justifyContent: "center",
    width: 84,
  },
  itemTitle: {
    color: "#fef1e0",
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 18,
  },
  packBody: {
    flex: 1,
    gap: 3,
    justifyContent: "center",
    minWidth: 0,
  },
  packBuyButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 30,
    minWidth: 82,
    paddingHorizontal: 8,
  },
  packBuyText: {
    color: "#050606",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  packCard: {
    backgroundColor: "#07080d",
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 4,
    borderTopWidth: 4,
    flexDirection: "row",
    gap: 10,
    minHeight: 106,
    padding: 10,
  },
  packDescription: {
    color: "#8e98aa",
    fontSize: 9,
    lineHeight: 12,
  },
  packGuaranteed: {
    color: "#c8cfdb",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  packIconFrame: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderWidth: 2,
    height: 58,
    justifyContent: "center",
    marginTop: 2,
    width: 58,
  },
  packIconGlyph: {
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 28,
  },
  packPrice: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  packPriceBox: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    minWidth: 82,
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderWidth: 2,
  },
  packRight: {
    alignItems: "flex-end",
    gap: 7,
    justifyContent: "center",
    marginRight: 8,
    width: 86,
  },
  packsSection: {
    gap: 8,
  },
  packsSubtitle: {
    color: "#8e98aa",
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 2,
  },
  packSubtitleLine: {
    color: "#aeb6c3",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  packsTitle: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1,
  },
  packTitle: {
    color: "#fef1e0",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 16,
  },
  price: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
  },
  qtyBox: {
    alignItems: "center",
    borderColor: "#00d9ff",
    borderWidth: 2,
    minWidth: 78,
    paddingHorizontal: 6,
    paddingVertical: 7,
  },
  partOwned: {
    color: "#17d9ff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    marginTop: 6,
  },
  partPrice: {
    flexShrink: 1,
    fontSize: 13,
  },
  partSectionLabel: {
    color: "#07080d",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 8,
    marginTop: 14,
  },
  qtyLabel: {
    color: "#9ca4b0",
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 2,
  },
  qtyValue: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  priceRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  scrollContent: {
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  simpleCard: {
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    gap: 18,
    padding: 18,
  },
  simpleCardFooter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tabButton: {
    borderColor: "#7a6412",
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12,
  },
  tabButtonActive: {
    backgroundColor: "#050606",
    borderColor: "#050606",
  },
  tabButtonText: {
    color: "#3f3104",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  tabButtonTextActive: {
    color: "#fef1e0",
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  useButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    borderRadius: 8,
    justifyContent: "center",
    marginTop: 8,
    minHeight: 34,
    minWidth: 78,
    paddingHorizontal: 10,
  },
  useButtonDisabled: {
    backgroundColor: "#8c7612",
  },
  useButtonText: {
    color: "#050606",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  useButtonTextDisabled: {
    color: "#1c1805",
  },
  genesisHero: {
    backgroundColor: "#07080d",
    borderColor: "#f0bf14",
    borderRadius: 12,
    borderWidth: 4,
    marginBottom: 14,
    padding: 18,
  },
  genesisEyebrow: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  genesisTitle: {
    color: "#fef1e0",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 4,
  },
  genesisCopy: {
    color: "#ddd2b5",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  genesisBadge: {
    color: "#f0bf14",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginTop: 12,
  },
  genesisCard: {
    backgroundColor: "#07080d",
    borderColor: "#2a2b33",
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 14,
    padding: 16,
  },
  genesisCardTitle: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  genesisCode: {
    color: "#fef1e0",
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: 6,
    marginTop: 8,
  },
  genesisMeta: {
    color: "#ddd2b5",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  genesisButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    borderRadius: 8,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  genesisClaimButton: {
    backgroundColor: "#17d9ff",
  },
  genesisButtonText: {
    color: "#050606",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
  },
  genesisClaimed: {
    color: "#38e08c",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 14,
    textAlign: "center",
  },
  genesisInput: {
    backgroundColor: "#101218",
    borderColor: "#2a2b33",
    borderRadius: 8,
    borderWidth: 1,
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 3,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  genesisWildcardCount: {
    color: "#fef1e0",
    fontSize: 30,
    fontWeight: "900",
    marginTop: 6,
  },
});
