import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { getHolobotImageSource } from "@/config/holobots";
import { useAuth, type GenesisStarterChoice } from "@/contexts/AuthContext";

const STARTER_CHOICES: Array<{
  description: string;
  key: GenesisStarterChoice;
  role: string;
}> = [
  {
    description: "Balanced assault fighter with fast striking pressure and solid all-around growth.",
    key: "ACE",
    role: "Assault",
  },
  {
    description: "Heavy tank built for durability, control, and close-range punishment.",
    key: "KUMA",
    role: "Tank",
  },
  {
    description: "Technical infiltrator with sharp timing windows and stealth-focused tempo.",
    key: "SHADOW",
    role: "Infiltrator",
  },
];

export function LoginScreen() {
  const {
    faceIdAvailable,
    faceIdEnabled,
    loading,
    login,
    rememberedEmail,
    rememberMeEnabled,
    sessionLocked,
    signup,
    unlockWithFaceId,
  } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [useFaceId, setUseFaceId] = useState(false);
  const [starterHolobot, setStarterHolobot] = useState<GenesisStarterChoice>("ACE");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEmail(rememberedEmail);
  }, [rememberedEmail]);

  useEffect(() => {
    setRememberMe(rememberMeEnabled);
  }, [rememberMeEnabled]);

  useEffect(() => {
    setUseFaceId(faceIdEnabled);
  }, [faceIdEnabled]);

  const selectedStarter = useMemo(
    () => STARTER_CHOICES.find((choice) => choice.key === starterHolobot) ?? STARTER_CHOICES[0],
    [starterHolobot],
  );

  const handleSubmit = async () => {
    setError(null);

    try {
      if (mode === "signup") {
        const trimmedUsername = username.trim();
        if (trimmedUsername.length < 3) {
          setError("Choose a username with at least 3 characters.");
          return;
        }

        if (password.length < 6) {
          setError("Use a password with at least 6 characters.");
          return;
        }

        await signup({
          email: email.trim(),
          faceId: useFaceId,
          password,
          rememberMe,
          starterHolobot,
          username: trimmedUsername,
        });
        return;
      }

      await login(email.trim(), password, {
        faceId: useFaceId,
        rememberMe,
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to continue right now.");
    }
  };

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.panel}>
          <Text style={styles.eyebrow}>HOLOBOTS MOBILE</Text>
          <Text style={styles.title}>{mode === "signup" ? "Create Account" : sessionLocked ? "Welcome Back" : "Sign In"}</Text>
          <Text style={styles.copy}>
            {mode === "signup"
              ? "Create your pilot, choose a Genesis Holobot, and start with your battle deck."
              : sessionLocked
                ? "Unlock with Face ID or sign in with your email and password."
                : "Use the same account you already use on holobots.fun."}
          </Text>

          {mode === "login" && sessionLocked && faceIdAvailable && faceIdEnabled ? (
            <Pressable
              accessibilityLabel="Unlock with Face ID"
              accessibilityRole="button"
              disabled={loading}
              onPress={async () => {
                setError(null);
                const unlocked = await unlockWithFaceId();
                if (!unlocked) {
                  setError("Face ID was cancelled or unavailable.");
                }
              }}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed ? styles.buttonPressed : null,
                loading ? styles.buttonDisabled : null,
              ]}
            >
              {loading ? <ActivityIndicator color="#f0bf14" /> : <Text style={styles.secondaryButtonText}>UNLOCK WITH FACE ID</Text>}
            </Pressable>
          ) : null}

          {mode === "signup" ? (
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Username</Text>
                <TextInput
                  autoCapitalize="none"
                  onChangeText={setUsername}
                  placeholder="Choose your pilot name"
                  placeholderTextColor="#8f896d"
                  style={styles.input}
                  value={username}
                />
              </View>

              <Text style={styles.starterLabel}>CHOOSE YOUR GENESIS HOLOBOT</Text>
              <View style={styles.starterGrid}>
                {STARTER_CHOICES.map((choice) => {
                  const isSelected = starterHolobot === choice.key;

                  return (
                    <Pressable
                      key={choice.key}
                      onPress={() => setStarterHolobot(choice.key)}
                      style={[styles.starterCard, isSelected ? styles.starterCardActive : null]}
                    >
                      <Image source={getHolobotImageSource(choice.key)} resizeMode="contain" style={styles.starterImage} />
                      <Text style={styles.starterName}>{choice.key}</Text>
                      <Text style={styles.starterRole}>{choice.role}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.starterDetail}>
                <Text style={styles.starterDetailTitle}>{selectedStarter.key}</Text>
                <Text style={styles.starterDetailCopy}>{selectedStarter.description}</Text>
                <Text style={styles.starterDetailMeta}>Includes your Genesis starter deck of battle cards.</Text>
              </View>
            </>
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="pilot@holobots.fun"
              placeholderTextColor="#8f896d"
              style={styles.input}
              value={email}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              autoCapitalize="none"
              onChangeText={setPassword}
              placeholder={mode === "signup" ? "Create a password" : "Enter your password"}
              placeholderTextColor="#8f896d"
              secureTextEntry
              style={styles.input}
              value={password}
            />
          </View>

          <View style={styles.optionRow}>
            <Pressable
              accessibilityLabel="Toggle remember me"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: rememberMe }}
              onPress={() => {
                const nextValue = !rememberMe;
                setRememberMe(nextValue);
                if (!nextValue) {
                  setUseFaceId(false);
                }
              }}
              style={styles.optionButton}
            >
              <View style={[styles.checkbox, rememberMe ? styles.checkboxActive : null]} />
              <Text style={styles.optionText}>Remember Me</Text>
            </Pressable>

            <Pressable
              accessibilityLabel="Toggle Face ID"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: useFaceId, disabled: !faceIdAvailable || !rememberMe }}
              disabled={!faceIdAvailable || !rememberMe}
              onPress={() => setUseFaceId((current) => !current)}
              style={[styles.optionButton, !faceIdAvailable || !rememberMe ? styles.optionButtonDisabled : null]}
            >
              <View style={[styles.checkbox, useFaceId ? styles.checkboxActive : null]} />
              <Text style={styles.optionText}>Face ID</Text>
            </Pressable>
          </View>

          {!faceIdAvailable ? <Text style={styles.meta}>Face ID isn&apos;t available on this device yet.</Text> : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            accessibilityLabel={mode === "signup" ? "Create account" : "Sign in"}
            accessibilityRole="button"
            disabled={
              loading ||
              email.trim().length === 0 ||
              password.length === 0 ||
              (mode === "signup" && username.trim().length === 0)
            }
            onPress={() => void handleSubmit()}
            style={({ pressed }) => [
              styles.button,
              pressed ? styles.buttonPressed : null,
              loading ||
              email.trim().length === 0 ||
              password.length === 0 ||
              (mode === "signup" && username.trim().length === 0)
                ? styles.buttonDisabled
                : null,
            ]}
          >
            {loading ? (
              <ActivityIndicator color="#050606" />
            ) : (
              <Text style={styles.buttonText}>{mode === "signup" ? "CREATE PILOT" : "ENTER DASHBOARD"}</Text>
            )}
          </Pressable>

          {mode === "login" ? (
            <Pressable
              accessibilityLabel="Create a new account"
              accessibilityRole="button"
              onPress={() => {
                setMode("signup");
                setError(null);
              }}
              style={({ pressed }) => [
                styles.secondaryActionButton,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.secondaryActionText}>CREATE A NEW ACCOUNT</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityLabel="Back to sign in"
              accessibilityRole="button"
              onPress={() => {
                setMode("login");
                setError(null);
              }}
              style={({ pressed }) => [
                styles.secondaryActionButton,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.secondaryActionText}>I ALREADY HAVE AN ACCOUNT</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#f5c40d",
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 96,
    paddingBottom: 40,
  },
  panel: {
    backgroundColor: "#060606",
    borderColor: "#e7b916",
    borderWidth: 3,
    paddingHorizontal: 22,
    paddingVertical: 28,
  },
  eyebrow: {
    color: "#f5c40d",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  title: {
    color: "#fef1e0",
    fontSize: 34,
    fontWeight: "900",
    marginTop: 8,
  },
  copy: {
    color: "#d7d0bd",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
    marginTop: 10,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#111111",
    borderColor: "#f0bf14",
    borderWidth: 1,
    marginBottom: 18,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: "#f0bf14",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
  secondaryActionButton: {
    alignItems: "center",
    borderColor: "#5b4b18",
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 50,
  },
  secondaryActionText: {
    color: "#fef1e0",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    color: "#fef1e0",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#171717",
    borderColor: "#66561f",
    borderWidth: 1,
    color: "#fef1e0",
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  starterLabel: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginBottom: 12,
  },
  starterGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  starterCard: {
    alignItems: "center",
    backgroundColor: "#0b0d10",
    borderColor: "#2b2b2b",
    borderWidth: 1,
    flex: 1,
    minHeight: 162,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  starterCardActive: {
    borderColor: "#f0bf14",
    borderWidth: 2,
  },
  starterImage: {
    height: 82,
    marginBottom: 8,
    width: "100%",
  },
  starterName: {
    color: "#fef1e0",
    fontSize: 16,
    fontWeight: "900",
  },
  starterRole: {
    color: "#f0bf14",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginTop: 4,
  },
  starterDetail: {
    backgroundColor: "#090909",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    marginBottom: 16,
    padding: 14,
  },
  starterDetailTitle: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
  },
  starterDetailCopy: {
    color: "#d7d0bd",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  starterDetailMeta: {
    color: "#f0bf14",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginTop: 8,
  },
  checkbox: {
    borderColor: "#66561f",
    borderWidth: 1,
    height: 16,
    marginRight: 10,
    width: 16,
  },
  checkboxActive: {
    backgroundColor: "#f5c40d",
    borderColor: "#f5c40d",
  },
  error: {
    color: "#ff6a57",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  meta: {
    color: "#8f896d",
    fontSize: 12,
    marginBottom: 14,
    marginTop: 4,
  },
  optionButton: {
    alignItems: "center",
    flexDirection: "row",
  },
  optionButtonDisabled: {
    opacity: 0.45,
  },
  optionRow: {
    flexDirection: "row",
    gap: 18,
    marginBottom: 16,
  },
  optionText: {
    color: "#fef1e0",
    fontSize: 13,
    fontWeight: "700",
  },
  button: {
    alignItems: "center",
    backgroundColor: "#f5c40d",
    marginTop: 8,
    paddingVertical: 16,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    opacity: 0.88,
  },
  buttonText: {
    color: "#050606",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
