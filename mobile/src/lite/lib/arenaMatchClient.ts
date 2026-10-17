import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, functions, httpsCallable } from '@/config/firebase';
import { withTimeout, CALLABLE_TIMEOUT_MS } from '../../lib/async';
import { ArenaMatchFlow, type ArenaIssue } from './arenaMatchFlow';
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
    }, { get: async () => { const s = await AsyncStorage.getItem(key); return s ? JSON.parse(s) as ArenaIssue : null; }, set: async (value) => { if (value)
            await AsyncStorage.setItem(key, JSON.stringify(value));
        else
            await AsyncStorage.removeItem(key); } }, () => auth.currentUser?.uid === uid);
}
