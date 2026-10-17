import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import {
  AvailableMovesPanel,
  type AvailableMoveItem,
} from "@/components/move-lab/AvailableMovesPanel";
import { BattleLoadoutPanel } from "@/components/move-lab/BattleLoadoutPanel";
import { MoveDetailPanel } from "@/components/move-lab/MoveDetailPanel";
import { getAbility } from '@/features/arena/abilities';
import {
  getSignatureFinisher,
  resolveCombatKit,
  resolveMove,
  STOCK_KIT_TEMPLATE_IDS,
} from "@/features/arena/moveKits";
import {
  applyMoveProgress,
  CATEGORY_SPECIALIZATIONS,
  MOVE_RANK_SP_COSTS,
  type HolobotMoveProgress,
  type MoveRank,
} from "@/features/arena/moveProgression";
import { BATTLE_CARD_TEMPLATES } from "@/lib/battleCards/catalog";
import {
  saveHolobotCombatKitAuthoritative,
  upgradeHolobotMoveAuthoritative,
} from "@/lib/moveLabClient";
import type { ActionCard, CardType } from "@/types/arena";
import { getSyncAbilityDefinition } from "@/lib/syncProgression";

const SLOT_META: Array<{ label: string; type: CardType }> = [
  { label: "STRIKE", type: "strike" },
  { label: "DEFEND", type: "defense" },
  { label: "COMBO", type: "combo" },
  { label: "FINISHER", type: "finisher" },
];

const MAX_MOVE_RANK: MoveRank = 3;

function toMoveRank(value: unknown): MoveRank {
  const numeric = Math.floor(Number(value ?? 0));
  if (numeric >= 3) return 3;
  if (numeric === 2) return 2;
  if (numeric === 1) return 1;
  return 0;
}

function diffMovePreview(before: ActionCard, after: ActionCard): string[] {
  const rows: string[] = [];
  if (after.baseDamage !== before.baseDamage) {
    rows.push(`DMG ${before.baseDamage} → ${after.baseDamage}`);
  }
  if (after.staminaCost !== before.staminaCost) {
    rows.push(`COST ${before.staminaCost} → ${after.staminaCost}`);
  }
  if (after.speedModifier !== before.speedModifier) {
    rows.push(`SPD ${before.speedModifier} → ${after.speedModifier}`);
  }
  return rows;
}

export function MoveLabPanel() {
  const { profile, updateProfile } = useAuth();
  const [selectedHolobotName, setSelectedHolobotName] = useState<string | null>(null);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [showAvailableMoves, setShowAvailableMoves] = useState(false);

  const holobots = profile?.holobots || [];
  const holobot =
    holobots.find((entry) => entry.name === selectedHolobotName) || holobots[0] || null;

  const kit = useMemo(() => {
    if (!profile || !holobot) {
      return null;
    }

    try {
      return resolveCombatKit({
        savedKitTemplateIds: holobot.combatKit?.slots,
        deckTemplateIds: profile.arena_deck_template_ids,
        ownedBattleCards: profile.battle_cards,
        moveProgress: holobot.moveProgress,
        idPrefix: "movelab",
      });
    } catch {
      return null;
    }
  }, [profile, holobot]);

  const progressOf = (templateId: string): HolobotMoveProgress => {
    const raw = holobot?.moveProgress?.[templateId];
    if (!raw) {
      return { rank: 0 };
    }
    return raw.specializationId
      ? { rank: toMoveRank(raw.rank), specializationId: raw.specializationId }
      : { rank: toMoveRank(raw.rank) };
  };

  const slotIndex = Math.max(0, Math.min(SLOT_META.length - 1, selectedSlotIndex));
  const slotMeta = SLOT_META[slotIndex];
  const equippedMove = kit ? kit.slots[slotIndex] : null;
  const equippedTemplateId = equippedMove?.templateId || null;

  useEffect(() => {
    setSelectedBranchId(null);
    setShowAvailableMoves(false);
  }, [holobot?.name, slotIndex, equippedTemplateId]);

  const replaceOptions = useMemo(() => {
    if (!kit) {
      return [];
    }

    const otherSlotTemplateIds = kit.slots
      .filter((_, index) => index !== slotIndex)
      .map((move) => move.templateId);

    return Object.entries(BATTLE_CARD_TEMPLATES)
      .filter(([, template]) => template.type === slotMeta.type)
      .filter(
        ([templateId]) =>
          (profile?.battle_cards?.[templateId] || 0) > 0 ||
          (STOCK_KIT_TEMPLATE_IDS as readonly string[]).includes(templateId),
      )
      .filter(([templateId]) => !otherSlotTemplateIds.includes(templateId))
      .map(([templateId, template]) => ({
        baseDamage: template.baseDamage,
        battleTier: template.battleTier || 0,
        description: template.description,
        name: template.name,
        speedModifier: template.speedModifier,
        staminaCost: template.staminaCost,
        templateId,
        type: template.type,
      }))
      .sort((left, right) => {
        const tierDelta = left.battleTier - right.battleTier;
        if (tierDelta !== 0) return tierDelta;
        return left.name.localeCompare(right.name);
      });
  }, [kit, profile?.battle_cards, slotIndex, slotMeta.type]);

  const syncPoints = profile?.syncPoints || 0;
  const equippedProgress: HolobotMoveProgress = equippedTemplateId
    ? progressOf(equippedTemplateId)
    : { rank: 0 };
  const currentRank = equippedProgress.rank;
  const nextRank = currentRank < MAX_MOVE_RANK ? ((currentRank + 1) as 1 | 2 | 3) : null;
  const upgradeCost = nextRank !== null ? MOVE_RANK_SP_COSTS[nextRank] : 0;
  const branchRequired = nextRank === 2;
  const baseMove = equippedTemplateId ? resolveMove(equippedTemplateId, "preview") : null;

  const previewRows: string[] = [];
  if (baseMove && nextRank !== null) {
    const beforeCard = applyMoveProgress(
      baseMove,
      equippedProgress.specializationId
        ? { rank: currentRank, specializationId: equippedProgress.specializationId }
        : { rank: currentRank },
    );
    const previewBranchId = branchRequired
      ? selectedBranchId || undefined
      : equippedProgress.specializationId;
    const afterCard = applyMoveProgress(
      baseMove,
      previewBranchId ? { rank: nextRank, specializationId: previewBranchId } : { rank: nextRank },
    );
    previewRows.push(...diffMovePreview(beforeCard, afterCard));
  }

  const isBusy = pendingAction !== null;
  const canUpgrade =
    nextRank !== null &&
    syncPoints >= upgradeCost &&
    (!branchRequired || !!selectedBranchId) &&
    !isBusy;
  const handleDetailTabChange = useCallback(
    (tab: "details" | "upgrade" | "available") => {
      setShowAvailableMoves(tab === "available");
    },
    [],
  );

  const handleEquip = async (templateId: string) => {
    if (!profile || !holobot || !kit) {
      return;
    }

    const nextSlots = kit.slots.map((move) => move.templateId) as [
      string,
      string,
      string,
      string,
    ];
    nextSlots[slotIndex] = templateId;

    setPendingAction(`equip:${templateId}`);
    try {
      await saveHolobotCombatKitAuthoritative(
        profile,
        updateProfile,
        holobot.name,
        nextSlots,
        holobot.combatKit?.revision ?? 0,
      );
    } catch (error) {
      Alert.alert("Equip Failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleUpgrade = async () => {
    if (!profile || !holobot || !equippedTemplateId || nextRank === null) {
      return;
    }

    setPendingAction("upgrade");
    try {
      await upgradeHolobotMoveAuthoritative(
        profile,
        updateProfile,
        holobot.name,
        equippedTemplateId,
        currentRank,
        branchRequired ? selectedBranchId || undefined : undefined,
      );
      setSelectedBranchId(null);
    } catch (error) {
      Alert.alert("Upgrade Failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setPendingAction(null);
    }
  };

  if (!profile || !holobot || !kit || !equippedMove) {
    return (
      <View style={styles.panel}>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>MOVE LAB</Text>
          <Text style={styles.emptyBody}>Mint a Holobot to open the Move Lab.</Text>
        </View>
      </View>
    );
  }

  const signature = getSignatureFinisher(holobot.name);
  const ability = getAbility(holobot.name);
  const equippedSyncAbility = getSyncAbilityDefinition(holobot.equippedSyncAbilityId);
  const equippedBranch = equippedProgress.specializationId
    ? CATEGORY_SPECIALIZATIONS[equippedMove.type]?.find(
        (branch) => branch.id === equippedProgress.specializationId,
      )
    : undefined;

  return (
    <View style={styles.panel}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.selectorRow}
      >
        {holobots.map((entry, index) => {
          const isSelected = entry.name === holobot.name;
          return (
            <Pressable
              key={`${entry.name}:${index}`}
              style={[styles.selectorChip, isSelected ? styles.selectorChipActive : null]}
              onPress={() => setSelectedHolobotName(entry.name)}
            >
              <Text
                style={[
                  styles.selectorChipText,
                  isSelected ? styles.selectorChipTextActive : null,
                ]}
              >
                {entry.name.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <BattleLoadoutPanel
        abilityDescription={ability.description}
        abilityName={ability.name}
        moves={kit.slots}
        onSelectMove={setSelectedSlotIndex}
        rankOf={(templateId) => progressOf(templateId).rank}
        selectedIndex={slotIndex}
        signatureDamage={signature.baseDamage}
        signatureName={signature.name}
        syncAbilityDescription={equippedSyncAbility?.description}
        syncAbilityName={equippedSyncAbility?.name}
      />

      <View style={styles.spRow}>
        <Text style={styles.spLabel}>SYNC POINTS</Text>
        <Text style={styles.spValue}>{`SP ${syncPoints}`}</Text>
      </View>

      <MoveDetailPanel
        branchOptions={CATEGORY_SPECIALIZATIONS[equippedMove.type]}
        canUpgrade={canUpgrade}
        currentRank={currentRank}
        equippedBranchName={equippedBranch?.name}
        isBusy={pendingAction === "upgrade"}
        move={equippedMove}
        nextRank={nextRank}
        onAvailablePress={() => setSelectedBranchId(null)}
        onPreview={() => {
          Alert.alert(
            equippedMove.name,
            `${equippedMove.description}\n\nCost ${equippedMove.staminaCost} • Speed ${equippedMove.speedModifier.toFixed(2)}`,
          );
        }}
        onSelectBranch={setSelectedBranchId}
        onTabChange={handleDetailTabChange}
        onUpgrade={() => void handleUpgrade()}
        previewRows={previewRows}
        selectedBranchId={selectedBranchId}
        syncPoints={syncPoints}
        upgradeCost={upgradeCost}
      />

      {showAvailableMoves ? (
        <AvailableMovesPanel
          disabled={isBusy}
          items={replaceOptions.map((option): AvailableMoveItem => {
            const progress = progressOf(option.templateId);
            return {
              baseDamage: option.baseDamage,
              description: option.description,
              equipped: option.templateId === equippedMove.templateId,
              name: option.name,
              pending: pendingAction === `equip:${option.templateId}`,
              rank: progress.rank,
              staminaCost: option.staminaCost,
              templateId: option.templateId,
              type: option.type,
            };
          })}
          onEquip={(templateId) => void handleEquip(templateId)}
          slotLabel={slotMeta.label}
        />
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  branchCard: {
    backgroundColor: "#11141c",
    borderColor: "#2a3142",
    borderWidth: 1,
    flex: 1,
    minWidth: 130,
    padding: 12,
  },
  branchCardActive: {
    borderColor: "#17d9ff",
  },
  branchDescription: {
    color: "#9aa3b5",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
  },
  branchName: {
    color: "#e8ecf5",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  branchNameActive: {
    color: "#17d9ff",
  },
  branchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  branchTag: {
    borderColor: "#17d9ff",
    borderWidth: 1,
    color: "#17d9ff",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  emptyBody: {
    color: "#9aa3b5",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  emptyCard: {
    backgroundColor: "#0b0d13",
    borderColor: "#f0bf14",
    borderWidth: 2,
    padding: 18,
  },
  emptyTitle: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  innateBadge: {
    backgroundColor: "#17d9ff",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  innateBadgeText: {
    color: "#050606",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  maxRankText: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 12,
  },
  optionAction: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  optionActionDisabled: {
    color: "#6a7186",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  optionBody: {
    flex: 1,
    minWidth: 0,
  },
  optionList: {
    gap: 8,
    marginTop: 12,
  },
  optionMeta: {
    color: "#9aa3b5",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  optionName: {
    color: "#e8ecf5",
    fontSize: 15,
    fontWeight: "800",
  },
  optionRow: {
    alignItems: "center",
    backgroundColor: "#11141c",
    borderColor: "#2a3142",
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    padding: 12,
  },
  optionRowEquipped: {
    borderColor: "#f0bf14",
  },
  panel: {
    gap: 14,
  },
  pip: {
    backgroundColor: "#2a3142",
    height: 8,
    width: 14,
  },
  pipFilled: {
    backgroundColor: "#17d9ff",
  },
  pipRow: {
    flexDirection: "row",
    gap: 4,
  },
  previewBlock: {
    backgroundColor: "#11141c",
    borderColor: "#2a3142",
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  previewHint: {
    color: "#9aa3b5",
    fontSize: 12,
    lineHeight: 16,
  },
  previewRow: {
    color: "#e8ecf5",
    fontSize: 14,
    fontWeight: "800",
  },
  previewTitle: {
    color: "#17d9ff",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.9,
    marginBottom: 4,
  },
  rankRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  rankText: {
    color: "#17d9ff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  sectionCard: {
    backgroundColor: "#0b0d13",
    borderColor: "#f0bf14",
    borderWidth: 2,
    padding: 14,
  },
  sectionMeta: {
    color: "#9aa3b5",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  sectionTitle: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  selectorChip: {
    backgroundColor: "#0b0d13",
    borderColor: "#2a3142",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  selectorChipActive: {
    borderColor: "#f0bf14",
  },
  selectorChipText: {
    color: "#9aa3b5",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  selectorChipTextActive: {
    color: "#f0bf14",
  },
  selectorRow: {
    flexDirection: "row",
    gap: 8,
  },
  signatureBody: {
    flex: 1,
    minWidth: 0,
  },
  signatureEyebrow: {
    color: "#17d9ff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  signatureMeta: {
    color: "#9aa3b5",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
  },
  signatureName: {
    color: "#e8ecf5",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 4,
  },
  signatureStrip: {
    alignItems: "center",
    backgroundColor: "#0b0d13",
    borderColor: "#17d9ff",
    borderWidth: 2,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    padding: 14,
  },
  slotCard: {
    backgroundColor: "#11141c",
    borderColor: "#2a3142",
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    padding: 12,
  },
  slotCardActive: {
    borderColor: "#f0bf14",
  },
  slotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
  },
  slotLabel: {
    color: "#6a7186",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  slotLabelActive: {
    color: "#f0bf14",
  },
  slotMeta: {
    color: "#9aa3b5",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  slotMoveName: {
    color: "#e8ecf5",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 6,
  },
  slotSubMeta: {
    color: "#6a7186",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginTop: 4,
  },
  spLabel: {
    color: "#9aa3b5",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  spRow: {
    alignItems: "center",
    backgroundColor: "#0b0d13",
    borderColor: "#2a3142",
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  spValue: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  upgradeBlock: {
    gap: 12,
    marginTop: 12,
  },
  upgradeButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    justifyContent: "center",
    paddingVertical: 13,
  },
  upgradeButtonDisabled: {
    backgroundColor: "#2a3142",
  },
  upgradeButtonText: {
    color: "#050606",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  upgradeButtonTextDisabled: {
    color: "#6a7186",
  },
  upgradeRankRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
});
