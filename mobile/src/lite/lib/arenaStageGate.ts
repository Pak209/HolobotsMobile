import { useArenaBattleStore } from '@/lite/stores/arena-battle-store';

/**
 * lite-arena-fast-1: the CPU's FIRST action waits for the 3D stage. The store's real-time loop lets the CPU act once
 * `AI_ACTION_INTERVAL_MS` has passed since `lastAIActionTime`, so a stamp in the future is a hold and stamping "now" is a
 * release (the CPU then waits the same interval it waits at any fight start). No combat rule, damage, stamina or player
 * input changes: only when the CPU may start acting. The cap releases a stage that never reports in.
 */
export const CPU_STAGE_HOLD_CAP_MS = 10_000;

export function holdCpuForStage(now: number = Date.now()) {
    useArenaBattleStore.setState({ lastAIActionTime: now + CPU_STAGE_HOLD_CAP_MS });
}

/** Ends a hold early (stage loaded, failed, or has no 3D). Never pushes the CPU's clock forward otherwise. */
export function releaseCpuForStage(now: number = Date.now()) {
    if (useArenaBattleStore.getState().lastAIActionTime > now) useArenaBattleStore.setState({ lastAIActionTime: now });
}
