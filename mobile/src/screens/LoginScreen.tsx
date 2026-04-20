import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/contexts/AuthContext";

export function LoginScreen() {
  const {
    faceIdAvailable,
    faceIdEnabled,
    loading,
    login,
    rememberedEmail,
    rememberMeEnabled,
    sessionLocked,
    unlockWithFaceId,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [useFaceId, setUseFaceId] = useState(false);
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

  const handleLogin = async () => {
    setError(null);

    try {
      await login(email.trim(), password, {
        faceId: useFaceId,
        rememberMe,
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to sign in right now.");
    }
  };

  if (sessionLocked) {
    return (
      <View style={styles.page}>
        <View style={styles.panel}>
          <Text style={styles.eyebrow}>HOLOBOTS MOBILE</Text>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.copy}>
            Unlock with Face ID to jump back into your remembered session.
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

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
              styles.button,
              pressed ? styles.buttonPressed : null,
              loading ? styles.buttonDisabled : null,
            ]}
          >
            {loading ? <ActivityIndicator color="#050606" /> : <Text style={styles.buttonText}>UNLOCK WITH FACE ID</Text>}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.panel}>
        <Text style={styles.eyebrow}>HOLOBOTS MOBILE</Text>
        <Text style={styles.title}>Sign In</Text>
        <Text style={styles.copy}>
          Use the same account you already use on holobots.fun.
        </Text>

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
            placeholder="Enter your password"
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
          accessibilityLabel="Sign in"
          accessibilityRole="button"
          disabled={loading || email.trim().length === 0 || password.length === 0}
          onPress={handleLogin}
          style={({ pressed }) => [
            styles.button,
            pressed ? styles.buttonPressed : null,
            loading || email.trim().length === 0 || password.length === 0 ? styles.buttonDisabled : null,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#050606" />
          ) : (
            <Text style={styles.buttonText}>ENTER DASHBOARD</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#f5c40d",
    flex: 1,
    justifyContent: "flex-start",
    paddingHorizontal: 24,
    paddingTop: 132,
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
