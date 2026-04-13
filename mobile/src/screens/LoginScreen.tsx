import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/contexts/AuthContext";

export function LoginScreen() {
  const { loading, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setError(null);

    try {
      await login(email.trim(), password);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to sign in right now.");
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.page}
    >
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#f5c40d",
    justifyContent: "center",
    paddingHorizontal: 24,
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
    marginTop: 10,
    marginBottom: 24,
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
  error: {
    color: "#ff6a57",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
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
