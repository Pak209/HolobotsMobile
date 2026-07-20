import type { ImageSourcePropType } from "react-native";

import type { CardType } from "@/types/arena";

export const MOVE_CLASS_ICONS: Record<CardType, ImageSourcePropType> = {
  combo: require("../../../assets/game/arena-moves/combo.png"),
  defense: require("../../../assets/game/arena-moves/defend.png"),
  finisher: require("../../../assets/game/arena-moves/finisher.png"),
  strike: require("../../../assets/game/arena-moves/strike.png"),
};

const MOVE_TEMPLATE_ICONS: Record<string, ImageSourcePropType> = {
  "combo.chainBurst": require("../../../assets/game/move-icons/combo/chain-burst.png"),
  "combo.crossCircuit": require("../../../assets/game/move-icons/combo/cross-circuit.png"),
  "combo.doubleTap": require("../../../assets/game/move-icons/combo/double-tap.png"),
  "combo.flowState": require("../../../assets/game/move-icons/combo/flow-state.png"),
  "combo.pressureLink": require("../../../assets/game/move-icons/combo/pressure-link.png"),
  "defense.coolantFlush": require("../../../assets/game/move-icons/defense/coolant-flush.png"),
  "defense.firewall": require("../../../assets/game/move-icons/defense/firewall.png"),
  "defense.guardUp": require("../../../assets/game/move-icons/defense/guard-up.png"),
  "defense.parryWindow": require("../../../assets/game/move-icons/defense/parry-window.png"),
  "defense.reinforcePlating": require("../../../assets/game/move-icons/defense/reinforce-plating.png"),
  "defense.safetyProtocol": require("../../../assets/game/move-icons/defense/safety-protocol.png"),

  // The production Strike catalog predates the reference-sheet move names.
  // These aliases preserve gameplay data while spreading the approved silhouettes
  // by attack intent: piercing, speed, electricity, heavy impact, and ranged pulse.
  "strike.armorPierce": require("../../../assets/game/move-icons/strike/power-uppercut.png"),
  "strike.backhand": require("../../../assets/game/move-icons/strike/haymaker.png"),
  "strike.cornerPressure": require("../../../assets/game/move-icons/strike/shock-punch.png"),
  "strike.criticalLine": require("../../../assets/game/move-icons/strike/rapid-jab.png"),
  "strike.aerialSlash": require("../../../assets/game/move-icons/strike/rapid-jab.png"),
  "strike.heavySlam": require("../../../assets/game/move-icons/strike/haymaker.png"),
  "strike.powerDrive": require("../../../assets/game/move-icons/strike/shock-punch.png"),
  "strike.quickJab": require("../../../assets/game/move-icons/strike/rapid-jab.png"),
  "strike.snapShot": require("../../../assets/game/move-icons/strike/sonic-fist.png"),
  "strike.syncPulse": require("../../../assets/game/move-icons/strike/shock-punch.png"),
  "strike.tempoThrust": require("../../../assets/game/move-icons/strike/power-uppercut.png"),
  "strike.vortexKick": require("../../../assets/game/move-icons/strike/haymaker.png"),
};

export function getMoveIcon(
  templateId: string | undefined,
  type: CardType,
): ImageSourcePropType {
  return (templateId && MOVE_TEMPLATE_ICONS[templateId]) || MOVE_CLASS_ICONS[type];
}
