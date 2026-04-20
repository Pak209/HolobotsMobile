import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";

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
  rememberedEmail: string;
  rememberMeEnabled: boolean;
  faceIdEnabled: boolean;
  faceIdAvailable: boolean;
  sessionLocked: boolean;
  profileLoading: boolean;
  profileError: string | null;
  login: (email: string, password: string, options?: { rememberMe?: boolean; faceId?: boolean }) => Promise<void>;
  logout: () => Promise<void>;
  unlockWithFaceId: () => Promise<boolean>;
  updateAuthPreferences: (updates: { rememberMe?: boolean; faceId?: boolean; rememberedEmail?: string }) => Promise<void>;
  updateProfile: (updates: Parameters<typeof updateUserProfile>[1]) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_PREFS_KEY = "holobots.auth.preferences";

type AuthPreferences = {
  faceId: boolean;
  rememberMe: boolean;
  rememberedEmail: string;
};

const DEFAULT_AUTH_PREFERENCES: AuthPreferences = {
  faceId: false,
  rememberMe: true,
  rememberedEmail: "",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [authPreferences, setAuthPreferences] = useState<AuthPreferences>(DEFAULT_AUTH_PREFERENCES);
  const [faceIdAvailable, setFaceIdAvailable] = useState(false);
  const [sessionLocked, setSessionLocked] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const manualLoginRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void AsyncStorage.getItem(AUTH_PREFS_KEY)
      .then((storedValue) => {
        if (cancelled) return;

        if (!storedValue) {
          setAuthPreferences(DEFAULT_AUTH_PREFERENCES);
          return;
        }

        const parsed = JSON.parse(storedValue) as Partial<AuthPreferences>;
        setAuthPreferences({
          faceId: Boolean(parsed.faceId),
          rememberMe: parsed.rememberMe ?? DEFAULT_AUTH_PREFERENCES.rememberMe,
          rememberedEmail: parsed.rememberedEmail ?? "",
        });
      })
      .catch(() => {
        if (cancelled) return;
        setAuthPreferences(DEFAULT_AUTH_PREFERENCES);
      })
      .finally(() => {
        if (cancelled) return;
        setPreferencesLoaded(true);
      });

    void Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ])
      .then(([hasHardware, isEnrolled, supportedTypes]) => {
        if (cancelled) return;
        setFaceIdAvailable(
          hasHardware &&
            isEnrolled &&
            supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setFaceIdAvailable(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const persistAuthPreferences = async (nextPreferences: AuthPreferences) => {
    setAuthPreferences(nextPreferences);
    await AsyncStorage.setItem(AUTH_PREFS_KEY, JSON.stringify(nextPreferences));
  };

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (!nextUser) {
        setUser(null);
        setSessionLocked(false);
        setLoading(false);
        return;
      }

      if (manualLoginRef.current) {
        manualLoginRef.current = false;
        setUser(nextUser);
        setSessionLocked(false);
        setLoading(false);
        return;
      }

      if (!authPreferences.rememberMe) {
        void signOut(auth).finally(() => {
          setUser(null);
          setSessionLocked(false);
          setLoading(false);
        });
        return;
      }

      setUser(nextUser);
      setSessionLocked(authPreferences.faceId && faceIdAvailable);
      setLoading(false);
    });

    return unsubscribe;
  }, [authPreferences.faceId, authPreferences.rememberMe, faceIdAvailable, preferencesLoaded]);

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
      rememberedEmail: authPreferences.rememberedEmail,
      rememberMeEnabled: authPreferences.rememberMe,
      faceIdEnabled: authPreferences.faceId,
      faceIdAvailable,
      sessionLocked,
      profileLoading,
      profileError,
      login: async (email, password, options) => {
        const nextPreferences: AuthPreferences = {
          faceId: Boolean(options?.rememberMe ?? authPreferences.rememberMe) && Boolean(options?.faceId ?? authPreferences.faceId),
          rememberMe: options?.rememberMe ?? authPreferences.rememberMe,
          rememberedEmail: (options?.rememberMe ?? authPreferences.rememberMe) ? email : "",
        };

        await persistAuthPreferences(nextPreferences);
        manualLoginRef.current = true;
        await signInWithEmailAndPassword(auth, email, password);
      },
      logout: async () => {
        setSessionLocked(false);
        await signOut(auth);
      },
      unlockWithFaceId: async () => {
        if (!faceIdAvailable) {
          return false;
        }

        const result = await LocalAuthentication.authenticateAsync({
          cancelLabel: "Cancel",
          promptMessage: "Unlock Holobots",
        });

        if (result.success) {
          setSessionLocked(false);
          return true;
        }

        return false;
      },
      updateAuthPreferences: async (updates) => {
        const nextRememberMe = updates.rememberMe ?? authPreferences.rememberMe;
        const nextPreferences: AuthPreferences = {
          faceId: nextRememberMe ? (updates.faceId ?? authPreferences.faceId) : false,
          rememberMe: nextRememberMe,
          rememberedEmail: updates.rememberedEmail ?? (nextRememberMe ? authPreferences.rememberedEmail : ""),
        };

        await persistAuthPreferences(nextPreferences);
      },
      updateProfile: async (updates) => {
        if (!user) {
          throw new Error("You must be signed in to update your profile.");
        }

        await updateUserProfile(user.uid, updates);
      },
    }),
    [authPreferences.faceId, authPreferences.rememberMe, authPreferences.rememberedEmail, faceIdAvailable, loading, profile, profileError, profileLoading, sessionLocked, user],
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
