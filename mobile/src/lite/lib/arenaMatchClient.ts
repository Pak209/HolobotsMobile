import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, functions, httpsCallable } from '@/config/firebase';
import { withTimeout, CALLABLE_TIMEOUT_MS } from '../../lib/async';
import { ArenaMatchFlow, type ArenaCheckpoint, type ArenaIssue, type ArenaPendingSettle } from './arenaMatchFlow';

const accountStorage = <T>(key: string) => ({
    get: async () => { const s = await AsyncStorage.getItem(key); return s ? JSON.parse(s) as T : null; },
    set: async (value: T | null) => { if (value)
        await AsyncStorage.setItem(key, JSON.stringify(value));
    else
        await AsyncStorage.removeItem(key); },
});
/** Creating the controller performs no call or charge. Storage is isolated by account. */
export function createArenaMatchClient(uid: string) {
    const key = `arena-match-pending-1:${uid}`;
    return new ArenaMatchFlow(async (request) => {
        if (!uid || auth.currentUser?.uid !== uid)
            throw Error('arena_session_changed');
        const response = await withTimeout(httpsCallable<Record<string, unknown>, unknown>(functions, 'arenaMatchHost')(request), CALLABLE_TIMEOUT_MS, 'Arena confirmation delayed. Resume or retry the same admission.');
        if (auth.currentUser?.uid !== uid)
            throw Error('arena_session_changed');
        return response.data;
    }, accountStorage<ArenaIssue>(key), () => auth.currentUser?.uid === uid,
    // No arena-match-3v3-1 swap-intent store on main: lite #139's dormant 3v3 transport is not ported (lite-main-port-2).
    undefined, {
        // A settle the host has not confirmed yet (too_fast floor, lost reply): resent unchanged after a kill or relaunch.
        settles: accountStorage<ArenaPendingSettle>(`arena-match-settle-pending-1:${uid}`),
        // F4: the last terminal receipt the player dismissed on this device.
        acks: accountStorage<string>(`arena-match-ack-1:${uid}`),
        // F3: the local practice fight's last HP/performance for the open match, so an interrupted fight continues.
        checkpoints: accountStorage<ArenaCheckpoint>(`arena-match-checkpoint-1:${uid}`),
    });
}
