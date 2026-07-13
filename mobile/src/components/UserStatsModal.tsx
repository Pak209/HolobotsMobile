import { useState } from "react";
import { Alert, Image as RNImage, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Svg, Path } from "@/components/FigmaSvg";
import { DailyMissionsModal } from "@/components/DailyMissionsModal";
import { fitnessAssets } from "@/config/figmaAssets";
import { useAuth } from "@/contexts/AuthContext";
import { useEnergyRefillAuthoritative } from "@/lib/progressionClient";
import { getDailyMissionSummary } from "@/lib/dailyMissions";
import type { UserProfile } from "@/types/profile";

function getPlayerRank(profile: UserProfile | null) {
  if (!profile) return "Rookie";

  const maxLevel = Math.max(0, ...(profile.holobots || []).map((holobot) => holobot.level || 0));
  const wins = profile.stats?.wins || 0;
  const score = maxLevel + wins * 0.35 + (profile.prestigeCount || 0) * 8;

  if (score >= 80) return "Legend";
  if (score >= 55) return "Elite";
  if (score >= 30) return "Champion";
  return "Rookie";
}

type UserStatsModalProps = {
  onClose: () => void;
  onOpenGacha: () => void;
  onOpenLeaderboard: () => void;
  profile: UserProfile | null;
  visible: boolean;
};

type LegalDocument = "privacy" | "terms";

const LEGAL_COPY: Record<LegalDocument, { title: string; updated: string; sections: Array<{ heading: string; body: string }> }> = {
  privacy: {
    title: "Privacy Policy",
    updated: "Effective May 27, 2026",
    sections: [
      {
        heading: "Information We Collect",
        body: "Holobots collects account details, pilot profile data, gameplay progress, inventory, battle results, and app diagnostics needed to operate the game. If you enable fitness features, Holobots may read activity data such as steps, distance, workout sessions, motion, location during workouts, and related fitness summaries that you choose to sync.",
      },
      {
        heading: "How We Use Information",
        body: "We use this information to sign you in, save your Holobots, calculate rewards, sync PvP battles, restore purchases or inventory where applicable, improve reliability, and protect the game from abuse. Fitness data is used to calculate in-game rewards and progress connected to activity features.",
      },
      {
        heading: "Storage And Sharing",
        body: "Game and account data is stored with our backend providers, including Firebase services. We do not sell personal information. We may share limited data with service providers only when needed to run authentication, storage, analytics, crash diagnostics, gameplay sync, or legal compliance.",
      },
      {
        heading: "Your Choices",
        body: "You can choose not to enable fitness, location, motion, or biometric unlock features. You may sign out at any time. Platform permissions can be changed in iOS or Android settings. Contact support if you want help with account access or deletion requests.",
      },
      {
        heading: "Children And Safety",
        body: "Holobots is intended for users old enough to manage an online game account under applicable local rules and platform requirements. Do not submit sensitive personal information through usernames, feedback, or support messages.",
      },
      {
        heading: "Contact",
        body: "For privacy questions, account requests, or policy concerns, contact the Holobots team at support@holobots.fun.",
      },
    ],
  },
  terms: {
    title: "Terms of Use",
    updated: "Effective May 27, 2026",
    sections: [
      {
        heading: "Use Of Holobots",
        body: "By using Holobots, you agree to use the app only for lawful gameplay, testing, and account activity. You are responsible for keeping your account credentials secure and for activity that happens through your account.",
      },
      {
        heading: "Game Progress And Virtual Items",
        body: "Holobots may include virtual currency, tickets, rewards, cards, parts, ranks, and other in-game items. These items are part of the game experience, have no cash value unless explicitly stated by us, and may be adjusted to fix bugs, balance gameplay, or protect the game economy.",
      },
      {
        heading: "PvP And Fair Play",
        body: "Do not cheat, exploit bugs, automate gameplay, interfere with matchmaking, attack backend services, or manipulate battle results. We may restrict access, reset progress, or remove rewards when activity harms other players or the service.",
      },
      {
        heading: "Fitness Features",
        body: "Fitness-based rewards are for entertainment and motivation only. Holobots is not medical advice and should not be used to diagnose, treat, or measure health conditions. Use safe judgment during workouts and follow platform permission prompts carefully.",
      },
      {
        heading: "Updates And Availability",
        body: "We may update, rebalance, suspend, or discontinue features as the game evolves. Testing builds may contain bugs, incomplete systems, or temporary data resets. We are not liable for loss of access caused by outages, platform changes, or test-track limits.",
      },
      {
        heading: "Contact",
        body: "For terms, account, or support questions, contact the Holobots team at support@holobots.fun.",
      },
    ],
  },
};

export function UserStatsModal({
  onClose,
  onOpenGacha,
  onOpenLeaderboard,
  profile,
  visible,
}: UserStatsModalProps) {
  const { updateProfile } = useAuth();
  const [isMissionsOpen, setIsMissionsOpen] = useState(false);
  const [legalDocument, setLegalDocument] = useState<LegalDocument | null>(null);
  const missionSummary = getDailyMissionSummary(profile);
  const playerRank = getPlayerRank(profile);

  const handleRefillEnergy = async () => {
    if (!profile) return;

    if ((profile.energy_refills || 0) <= 0) {
      Alert.alert("No Energy Refills", "You need an Energy Refill item to top up daily energy.");
      return;
    }

    if ((profile.dailyEnergy || 0) >= (profile.maxDailyEnergy || 100)) {
      Alert.alert("Energy Full", "Daily energy is already full.");
      return;
    }

    try {
      // Server-authoritative: consumes the refill item and tops up energy
      // in one transaction (energy_refills is a frozen economy field now).
      await useEnergyRefillAuthoritative(profile, updateProfile);
    } catch (error) {
      Alert.alert("Refill failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleClose = () => {
    setLegalDocument(null);
    setIsMissionsOpen(false);
    onClose();
  };

  const activeLegalCopy = legalDocument ? LEGAL_COPY[legalDocument] : null;

  return (
    <>
      <Modal
        animationType="fade"
        presentationStyle="overFullScreen"
        transparent
        visible={visible}
        onRequestClose={handleClose}
      >
        <View style={styles.backdrop}>
          <View style={[styles.card, activeLegalCopy && styles.legalCard]}>
            {activeLegalCopy ? (
              <>
                <Text style={styles.eyebrow}>LEGAL</Text>
                <Text style={styles.title}>{activeLegalCopy.title}</Text>
                <Text style={styles.legalUpdated}>{activeLegalCopy.updated}</Text>
                <ScrollView style={styles.legalScroll} contentContainerStyle={styles.legalScrollContent}>
                  {activeLegalCopy.sections.map((section) => (
                    <View key={section.heading} style={styles.legalSection}>
                      <Text style={styles.legalHeading}>{section.heading}</Text>
                      <Text style={styles.legalBody}>{section.body}</Text>
                    </View>
                  ))}
                </ScrollView>
                <Pressable style={styles.closeButton} onPress={() => setLegalDocument(null)}>
                  <Text style={styles.closeText}>BACK</Text>
                </Pressable>
              </>
            ) : isMissionsOpen ? (
              <DailyMissionsModal onClose={() => setIsMissionsOpen(false)} />
            ) : (
              <>
                <Text style={styles.eyebrow}>PILOT DATA</Text>
                <Text style={styles.title}>{profile?.username || "Pilot"}</Text>

                <View style={styles.grid}>
                  <View style={styles.statTile}>
                    <Text style={styles.statLabel}>Player Rank</Text>
                    <Text style={styles.statValue}>{playerRank}</Text>
                  </View>
                  <View style={styles.statTile}>
                    <View style={styles.tileHeaderRow}>
                      <Text style={styles.statLabel}>Daily Energy</Text>
                      <Pressable accessibilityLabel="Refill daily energy" onPress={() => void handleRefillEnergy()} style={styles.miniIconButton}>
                        <Svg width="18" height="18" viewBox="0 0 24 24">
                          <Path d="M16 7h1a2 2 0 0 1 2 2v.5a.5.5 0 0 0 .5.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5a.5.5 0 0 0-.5.5v.5a2 2 0 0 1-2 2h-2M8 7H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1m5-9l-2 4h3l-2 4" stroke="#f0bf14" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      </Pressable>
                    </View>
                    <Text style={styles.statValue}>{`${profile?.dailyEnergy || 0}/${profile?.maxDailyEnergy || 100}`}</Text>
                    <Text style={styles.statMeta}>{`${profile?.energy_refills || 0} refills ready`}</Text>
                  </View>
                  <View style={styles.statTile}>
                    <Text style={styles.statLabel}>Sync Points</Text>
                    <View style={styles.valueRow}>
                      <RNImage source={fitnessAssets.rewardSync} style={styles.currencyIcon} resizeMode="contain" />
                      <Text style={styles.statValue}>{`${profile?.syncPoints || 0}`}</Text>
                    </View>
                  </View>
                  <View style={styles.statTile}>
                    <Text style={styles.statLabel}>Holos</Text>
                    <View style={styles.valueRow}>
                      <RNImage source={fitnessAssets.rewardHolos} style={styles.currencyIcon} resizeMode="contain" />
                      <Text style={styles.statValue}>{`${profile?.holosTokens || 0}`}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.actionColumn}>
                  <Pressable style={styles.actionButton} onPress={onOpenGacha}>
                    <Text style={styles.actionText}>OPEN GACHA</Text>
                  </Pressable>
                  <Pressable style={styles.missionButton} onPress={() => setIsMissionsOpen(true)}>
                    <View>
                      <Text style={styles.missionButtonTitle}>DAILY MISSIONS</Text>
                      <Text style={styles.missionButtonMeta}>{`${missionSummary.completed}/${missionSummary.available} complete`}</Text>
                    </View>
                    <Text style={styles.missionButtonMeta}>{missionSummary.unclaimed ? `${missionSummary.unclaimed} ready` : "View"}</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={onOpenLeaderboard}>
                    <Text style={styles.secondaryText}>LEADERBOARD</Text>
                  </Pressable>
                  <View style={styles.legalButtonRow}>
                    <Pressable style={styles.legalButton} onPress={() => setLegalDocument("privacy")}>
                      <Text style={styles.legalButtonText}>PRIVACY POLICY</Text>
                    </Pressable>
                    <Pressable style={styles.legalButton} onPress={() => setLegalDocument("terms")}>
                      <Text style={styles.legalButtonText}>TERMS OF USE</Text>
                    </Pressable>
                  </View>
                </View>

                <Pressable style={styles.closeButton} onPress={handleClose}>
                  <Text style={styles.closeText}>CLOSE</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    minHeight: 54,
    justifyContent: "center",
  },
  actionColumn: {
    gap: 12,
    marginTop: 22,
  },
  actionText: {
    color: "#050606",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.84)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#111111",
    borderColor: "#f0bf14",
    borderWidth: 3,
    maxWidth: 420,
    padding: 22,
    width: "100%",
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#2a2a2a",
    borderWidth: 2,
    marginTop: 18,
    minHeight: 52,
    justifyContent: "center",
  },
  closeText: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
  currencyIcon: {
    height: 22,
    width: 22,
  },
  eyebrow: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 18,
  },
  miniIconButton: {
    alignItems: "center",
    backgroundColor: "#111111",
    borderColor: "#f0bf14",
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  missionButton: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  missionButtonMeta: {
    color: "#ddd2b5",
    fontSize: 12,
    fontWeight: "700",
  },
  missionButtonTitle: {
    color: "#f0bf14",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  legalBody: {
    color: "#ddd2b5",
    fontSize: 13,
    lineHeight: 20,
  },
  legalButton: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 10,
  },
  legalButtonRow: {
    flexDirection: "row",
    gap: 10,
  },
  legalButtonText: {
    color: "#ddd2b5",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  legalCard: {
    maxHeight: "82%",
  },
  legalHeading: {
    color: "#f0bf14",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.4,
    marginBottom: 7,
  },
  legalScroll: {
    marginTop: 14,
  },
  legalScrollContent: {
    gap: 14,
    paddingBottom: 8,
  },
  legalSection: {
    borderBottomColor: "#242424",
    borderBottomWidth: 1,
    paddingBottom: 14,
  },
  legalUpdated: {
    color: "#8f866f",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#fef1e0",
    minHeight: 50,
    justifyContent: "center",
  },
  secondaryText: {
    color: "#050606",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  statLabel: {
    color: "#ddd2b5",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },
  statTile: {
    backgroundColor: "#050606",
    borderColor: "#2b2b2b",
    borderWidth: 1,
    minHeight: 82,
    padding: 12,
    width: "47%",
  },
  statMeta: {
    color: "#8f866f",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 6,
  },
  statValue: {
    color: "#fef1e0",
    fontSize: 22,
    fontWeight: "900",
  },
  tileHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  title: {
    color: "#fef1e0",
    fontSize: 30,
    fontWeight: "900",
    marginTop: 8,
  },
  valueRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
});
