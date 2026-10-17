/** Strip Unity/export prefixes, accepting both manifest and game clip names. */
export function shortClipName(name: string): string {
  return name.replace(/^HB_[A-Z]+_Mixar_/, '').replace(/^[A-Z]+_/, '');
}
/** Unity BotMoveWireTool's default take and FleetMixarImportTool's Special take. */
export const BOT_ATTACK_TAKES = {
  wolf: ['StepCross', 'SupermanPunch'], kuma: ['PawSwipe', 'DoubleHammer'],
  ken: ['PalmBreaker', 'CrownDrop'], tsuin: ['TwinCut', 'LeapCleave'],
  hare: ['SnapKick', 'DoubleHeel'], shadow: ['DrawCut', 'JumpSlash'],
  wake: ['ForearmCounter', 'AnchorSlam'], tora: ['TigerPalm', 'PounceCrush'],
  gama: ['PalmFlick', 'DiveKick'], kurai: ['CrossSlash', 'RisingEdge'],
  era: ['WingShear', 'DivingEdge'], ace: ['JabCross', 'Skybreaker'],
} as const;
/** Portrait command order from BotMoveWireTool.Clips and ACEMoveWireTool's three named signatures.
 * FleetMixarImportTool replaces WOLF RushElbow with SupermanPunch and GAMA LowSweep with DiveKick.
 * Keep these distinct from the legacy AttackBasic/AttackSignature animator aliases above.
 */
export const BOT_COMMAND_TAKES = {
  wolf: ['StepCross', 'LowRoundhouse', 'SupermanPunch'],
  kuma: ['PawSwipe', 'DoubleHammer', 'ShoulderCheck'],
  ken: ['PalmBreaker', 'CrossElbow', 'CrownDrop'],
  tsuin: ['TwinCut', 'TurningEdge', 'LeapCleave'],
  hare: ['SnapKick', 'HopKnee', 'DoubleHeel'],
  shadow: ['DrawCut', 'DiagonalCut', 'PassingThrust'],
  wake: ['ForearmCounter', 'DrivePunch', 'AnchorSlam'],
  tora: ['TigerPalm', 'RakeCombo', 'PounceCrush'],
  gama: ['PalmFlick', 'WhipKick', 'DiveKick'],
  kurai: ['CrossSlash', 'LowPass', 'RisingEdge'],
  era: ['WingShear', 'TalonKick', 'DivingEdge'],
  ace: ['Skybreaker', 'CometCross', 'MeteorHammer'],
} as const satisfies Record<keyof typeof BOT_ATTACK_TAKES, readonly [string, string, string]>;
export function resolveClipName(request: string, clips: readonly string[], idle: string, botId?: string): string | null {
  const normalized = shortClipName(request).toLowerCase();
  const direct = clips.find(name => shortClipName(name).toLowerCase() === normalized);
  if (direct) return direct;
  if (normalized === 'idle' || normalized === 'hoveridle' || normalized === 'fablehover') return clips.find(name => shortClipName(name) === idle) ?? null;
  // The GLBs contain source takes, not Unity's derived AttackBasic/AttackSignature.
  const bot = botId?.toLowerCase() as keyof typeof BOT_ATTACK_TAKES;
  const takes = BOT_ATTACK_TAKES[bot];
  const commands = BOT_COMMAND_TAKES[bot];
  const alias = normalized === 'strike' ? commands?.[0]
    : normalized === 'heavy' || normalized === 'attackheavy' ? commands?.[1]
    : normalized === 'finisher' ? commands?.[2]
    : normalized === 'attackbasic' || normalized === 'attack' ? takes?.[0]
    : normalized === 'attacksignature' ? takes?.[1] : undefined;
  if (alias) return clips.find(name => shortClipName(name) === alias) ?? null;
  return null;
}
