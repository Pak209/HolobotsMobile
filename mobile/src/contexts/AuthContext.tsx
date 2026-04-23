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
  createUserWithEmailAndPassword,
  db,
  doc,
  functions,
  getDoc,
  httpsCallable,
  onAuthStateChanged,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "@/config/firebase";
import { createGenesisStarterHolobot, getHolobotRank } from "@/config/holobots";
import { getGenesisStarterDeckGrants } from "@/lib/battleCards/catalog";
import { computeLeaderboardScore, subscribeToUserProfile, updateUserProfile } from "@/lib/profile";
import type { UserProfile } from "@/types/profile";

export type GenesisStarterChoice = "ACE" | "KUMA" | "SHADOW";

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  bootLoading: boolean;
  loading: boolean;
  rememberedEmail: string;
  rememberMeEnabled: boolean;
  faceIdEnabled: boolean;
  faceIdAvailable: boolean;
  sessionLocked: boolean;
  profileLoading: boolean;
  profileError: string | null;
  login: (email: string, password: string, options?: { rememberMe?: boolean; faceId?: boolean }) => Promise<void>;
  signup: (
    params: {
      email: string;
      password: string;
      rememberMe?: boolean;
      faceId?: boolean;
      starterHolobot: GenesisStarterChoice;
      username: string;
    },
  ) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
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

const deleteAccountCallable = httpsCallable<void, { success?: boolean }>(functions, "deleteUserAccount");

function normalizeUsername(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
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
        setBootLoading(false);
        setLoading(false);
        return;
      }

      if (manualLoginRef.current) {
        manualLoginRef.current = false;
        setUser(nextUser);
        setSessionLocked(false);
        setBootLoading(false);
        setLoading(false);
        return;
      }

      if (!authPreferences.rememberMe) {
        void signOut(auth).finally(() => {
          setUser(null);
          setSessionLocked(false);
          setBootLoading(false);
          setLoading(false);
        });
        return;
      }

      setUser(nextUser);
      setSessionLocked(authPreferences.faceId && faceIdAvailable);
      setBootLoading(false);
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

    if (profile.leaderboardScore === undefined) {
      void updateUserProfile(user.uid, {
        holobots: profile.holobots || [],
        syncPoints: profile.syncPoints || 0,
      }).catch((error) => {
        console.error("[Auth] Failed to backfill leaderboard score", error);
      });
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
      bootLoading,
      loading,
      rememberedEmail: authPreferences.rememberedEmail,
      rememberMeEnabled: authPreferences.rememberMe,
      faceIdEnabled: authPreferences.faceId,
      faceIdAvailable,
      sessionLocked,
      profileLoading,
      profileError,
      login: async (email, password, options) => {
        const normalizedEmail = email.trim();
        const nextRememberMe = options?.rememberMe ?? authPreferences.rememberMe;
        const nextPreferences: AuthPreferences = {
          faceId: nextRememberMe && faceIdAvailable ? Boolean(options?.faceId ?? authPreferences.faceId) : false,
          rememberMe: nextRememberMe,
          rememberedEmail: nextRememberMe ? normalizedEmail : "",
        };

        setLoading(true);
        await persistAuthPreferences(nextPreferences);
        manualLoginRef.current = true;
        await signInWithEmailAndPassword(auth, normalizedEmail, password);
      },
      signup: async ({ email, password, rememberMe, faceId, starterHolobot, username }) => {
        const normalizedEmail = email.trim();
        const normalizedUsername = normalizeUsername(username);
        const nextRememberMe = rememberMe ?? authPreferences.rememberMe;
        const nextPreferences: AuthPreferences = {
          faceId: nextRememberMe && faceIdAvailable ? Boolean(faceId) : false,
          rememberMe: nextRememberMe,
          rememberedEmail: nextRememberMe ? normalizedEmail : "",
        };

        const starterDeck = getGenesisStarterDeckGrants();
        const starterHolobotProfile = createGenesisStarterHolobot(starterHolobot);
        const userRefData = {
          arena_deck_template_ids: Object.keys(starterDeck),
          asyncBattleTickets: 3,
          battle_cards: starterDeck,
          dailyEnergy: 100,
          energyRefills: 0,
          expBoosters: 0,
          fitnessSource: "mobile",
          gachaTickets: 0,
          holobots: [starterHolobotProfile],
          holosTokens: 0,
          inventory: {},
          isDevAccount: false,
          lastAsyncTicketRefresh: serverTimestamp(),
          lastEnergyRefresh: serverTimestamp(),
          onboardingPath: "genesis",
          starter_deck_claimed: true,
          syncDistanceUnit: "km",
          syncPoints: 0,
          leaderboardScore: computeLeaderboardScore({
            holobots: [starterHolobotProfile],
            prestigeCount: 0,
            syncPoints: 0,
            wins: 0,
          }),
          todaySteps: 0,
          username: normalizedUsername,
          wins: 0,
          losses: 0,
        };

        const localProfile: UserProfile = {
          arena_deck_template_ids: Object.keys(starterDeck),
          async_battle_tickets: 3,
          battle_cards: starterDeck,
          dailyEnergy: 100,
          energy_refills: 0,
          exp_boosters: 0,
          fitnessSource: "mobile",
          gachaTickets: 0,
          holobots: [starterHolobotProfile],
          holosTokens: 0,
          id: "",
          inventory: {},
          isDevAccount: false,
          lastEnergyRefresh: new Date().toISOString(),
          last_async_ticket_refresh: new Date().toISOString(),
          onboardingPath: "genesis",
          pack_history: [],
          parts: [],
          equippedParts: {},
          rental_holobots: [],
          rewardSystem: {},
          starter_deck_claimed: true,
          stats: {
            losses: 0,
            wins: 0,
          },
          syncDistanceUnit: "km",
          syncPoints: 0,
          todaySteps: 0,
          username: normalizedUsername,
          maxDailyEnergy: 100,
        };

        setLoading(true);
        await persistAuthPreferences(nextPreferences);
        manualLoginRef.current = true;

        let createdUser: User | null = null;

        try {
          const userCredential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
          createdUser = userCredential.user;

          setUser(createdUser);
          setSessionLocked(false);
          setProfile({
            ...localProfile,
            id: createdUser.uid,
          });
          setLoading(false);
          setProfileLoading(false);
          setProfileError(null);

          await setDoc(doc(db, "users", createdUser.uid), userRefData, { merge: true }).catch((error) => {
            console.error("[Auth] Failed to persist new user profile", error);
          });
        } catch (error) {
          const errorCode =
            typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code) : "";

          if (errorCode === "auth/email-already-in-use") {
            try {
              const existingCredential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
              const existingUser = existingCredential.user;
              const existingProfileRef = doc(db, "users", existingUser.uid);
              const existingProfileSnap = await getDoc(existingProfileRef);

              if (!existingProfileSnap.exists()) {
                await setDoc(existingProfileRef, userRefData, { merge: true });
                setUser(existingUser);
                setSessionLocked(false);
                setProfile({
                  ...localProfile,
                  id: existingUser.uid,
                });
                setLoading(false);
                setProfileLoading(false);
                setProfileError(null);
                return;
              }

              await signOut(auth).catch(() => undefined);
              setLoading(false);
              throw new Error("That email already has a Holobots account. Please sign in instead.");
            } catch (recoveryError) {
              const recoveryCode =
                typeof recoveryError === "object" && recoveryError && "code" in recoveryError
                  ? String((recoveryError as { code?: string }).code)
                  : "";

              setLoading(false);

              if (recoveryCode === "auth/invalid-credential" || recoveryCode === "auth/wrong-password") {
                throw new Error("That email is already registered. Sign in instead, or use the original password to recover setup.");
              }

              throw recoveryError;
            }
          }

          if (createdUser) {
            await signOut(auth).catch(() => undefined);
          }

          setLoading(false);
          throw error;
        }
      },
      logout: async () => {
        setSessionLocked(false);
        setLoading(true);
        await signOut(auth);
      },
      deleteAccount: async () => {
        if (!user) {
          throw new Error("You must be signed in to delete your account.");
        }

        setSessionLocked(false);
        setLoading(true);

        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error("Your session expired. Please sign in again before deleting your account.");
        }

        await currentUser.getIdToken(true);
        await deleteAccountCallable();
        await signOut(auth).catch(() => undefined);
        await AsyncStorage.removeItem(AUTH_PREFS_KEY).catch(() => undefined);
        setAuthPreferences(DEFAULT_AUTH_PREFERENCES);
        setProfile(null);
        setUser(null);
      },
      unlockWithFaceId: async () => {
        if (!faceIdAvailable) {
          return false;
        }

        const result = await LocalAuthentication.authenticateAsync({
          cancelLabel: "Use Login Instead",
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
          faceId: nextRememberMe && faceIdAvailable ? (updates.faceId ?? authPreferences.faceId) : false,
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
    [
      authPreferences.faceId,
      authPreferences.rememberMe,
      authPreferences.rememberedEmail,
      bootLoading,
      faceIdAvailable,
      loading,
      profile,
      profileError,
      profileLoading,
      sessionLocked,
      user,
    ],
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
