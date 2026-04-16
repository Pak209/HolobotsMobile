import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  auth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "@/config/firebase";
import { getGenesisStarterDeckGrants } from "@/lib/battleCards/catalog";
import { subscribeToUserProfile, updateUserProfile } from "@/lib/profile";
import type { UserProfile } from "@/types/profile";

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  profileLoading: boolean;
  profileError: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (updates: Parameters<typeof updateUserProfile>[1]) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      setProfileError(null);
      return;
    }

    setProfileLoading(true);
    setProfileError(null);

    const unsubscribe = subscribeToUserProfile(
      user.uid,
      (nextProfile) => {
        setProfile(nextProfile);
        setProfileLoading(false);
      },
      (error) => {
        setProfile(null);
        setProfileLoading(false);
        setProfileError(error.message);
      },
    );

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user || !profile) {
      return;
    }

    const alreadyHasCards = Object.keys(profile.battle_cards || {}).length > 0;
    if (profile.starter_deck_claimed || alreadyHasCards) {
      return;
    }

    void updateUserProfile(user.uid, {
      arena_deck_template_ids: Object.keys(getGenesisStarterDeckGrants()),
      battle_cards: getGenesisStarterDeckGrants(),
      starter_deck_claimed: true,
    }).catch((error) => {
      console.error("[Auth] Failed to seed starter deck", error);
    });
  }, [profile, user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      profileLoading,
      profileError,
      login: async (email, password) => {
        await signInWithEmailAndPassword(auth, email, password);
      },
      logout: async () => {
        await signOut(auth);
      },
      updateProfile: async (updates) => {
        if (!user) {
          throw new Error("You must be signed in to update your profile.");
        }

        await updateUserProfile(user.uid, updates);
      },
    }),
    [user, profile, loading, profileLoading, profileError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
