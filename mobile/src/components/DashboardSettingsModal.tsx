import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/contexts/AuthContext";

type DashboardSettingsModalProps = {
  onClose: () => void;
  visible: boolean;
};

export function DashboardSettingsModal({ onClose, visible }: DashboardSettingsModalProps) {
  const { user, profile, deleteAccount, logout } = useAuth();
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const canConfirmDelete = deleteConfirmationText.trim().toUpperCase() === "DELETE";
  const pilotLabel = useMemo(
    () => profile?.username || user?.email || "Signed in pilot",
    [profile?.username, user?.email],
  );

  return (
    <>
      <Modal
        animationType="fade"
        presentationStyle="overFullScreen"
        transparent
        visible={visible}
        onRequestClose={onClose}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>DASHBOARD SETTINGS</Text>
            <Text style={styles.title}>Pilot Controls</Text>
            <Text style={styles.copy}>
              Manage your account and fitness connections from one place.
            </Text>

            <View style={styles.section}>
              <Text style={styles.label}>ACCOUNT</Text>
              <Text style={styles.copySmall}>{pilotLabel}</Text>
              {user?.email ? <Text style={styles.meta}>{user.email}</Text> : null}
              <Pressable
                style={styles.primaryAction}
                onPress={() => {
                  onClose();
                  void logout();
                }}
              >
                <Text style={styles.primaryActionText}>SIGN OUT</Text>
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>HEALTH & FITNESS</Text>
              <Text style={styles.copySmall}>HEALTHKIT CONNECT</Text>
              <Text style={styles.meta}>
                Fitness permissions are currently handled from Sync. This shortcut can host a one-tap HealthKit connect flow next.
              </Text>
              <Pressable
                style={styles.secondaryAction}
                onPress={() =>
                  Alert.alert(
                    "HealthKit Connect",
                    "HealthKit connection settings will live here once the direct iOS permission flow is added.",
                  )
                }
              >
                <Text style={styles.secondaryActionText}>OPEN HEALTH SETTINGS</Text>
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.dangerLabel}>DANGER ZONE</Text>
              <Text style={styles.meta}>
                Permanently remove this account and all saved pilot data from Holobots Mobile.
              </Text>
              <Pressable
                style={styles.deleteAccountButton}
                onPress={() => {
                  setDeleteConfirmationText("");
                  setDeleteError(null);
                  setIsDeleteModalOpen(true);
                }}
              >
                <Text style={styles.deleteAccountText}>DELETE ACCOUNT</Text>
              </Pressable>
            </View>

            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>CLOSE</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        presentationStyle="overFullScreen"
        transparent
        visible={isDeleteModalOpen}
        onRequestClose={() => setIsDeleteModalOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>ACCOUNT ACTION</Text>
            <Text style={styles.title}>Delete Account</Text>
            <Text style={styles.copy}>
              This permanently removes your Holobots account from the app. Type DELETE below to confirm.
            </Text>

            <View style={styles.section}>
              <Text style={styles.label}>TYPE DELETE TO CONFIRM</Text>
              <TextInput
                autoCapitalize="characters"
                autoCorrect={false}
                onChangeText={setDeleteConfirmationText}
                placeholder="DELETE"
                placeholderTextColor="#8f896d"
                style={styles.deleteInput}
                value={deleteConfirmationText}
              />
              <Text style={styles.meta}>
                Your pilot data, workouts, rewards, and saved progression will be removed.
              </Text>
            </View>

            {deleteError ? <Text style={styles.deleteErrorText}>{deleteError}</Text> : null}

            <Pressable
              disabled={!canConfirmDelete || isDeletingAccount}
              style={[
                styles.deleteAccountButton,
                (!canConfirmDelete || isDeletingAccount) ? styles.deleteAccountButtonDisabled : null,
              ]}
              onPress={async () => {
                setDeleteError(null);
                setIsDeletingAccount(true);

                try {
                  await deleteAccount();
                  setIsDeleteModalOpen(false);
                  onClose();
                } catch (error) {
                  setDeleteError(
                    error instanceof Error
                      ? error.message
                      : "Unable to delete your account right now.",
                  );
                } finally {
                  setIsDeletingAccount(false);
                }
              }}
            >
              {isDeletingAccount ? (
                <ActivityIndicator color="#fef1e0" />
              ) : (
                <Text style={styles.deleteAccountText}>PERMANENTLY DELETE</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.closeButton}
              onPress={() => {
                setDeleteConfirmationText("");
                setDeleteError(null);
                setIsDeleteModalOpen(false);
              }}
            >
              <Text style={styles.closeText}>CANCEL</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.84)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#111111",
    borderColor: "#f0bf14",
    borderWidth: 3,
    maxWidth: 420,
    padding: 20,
    width: "100%",
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#2a2a2a",
    borderWidth: 2,
    justifyContent: "center",
    marginTop: 16,
    minHeight: 48,
  },
  closeText: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
  copy: {
    color: "#d5cbb2",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  copySmall: {
    color: "#fef1e0",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },
  dangerLabel: {
    color: "#ff8c7c",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  deleteAccountButton: {
    alignItems: "center",
    backgroundColor: "#2c0d0d",
    borderColor: "#ef4444",
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 48,
  },
  deleteAccountButtonDisabled: {
    opacity: 0.45,
  },
  deleteAccountText: {
    color: "#fef1e0",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
  deleteErrorText: {
    color: "#ff8c7c",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 12,
  },
  deleteInput: {
    backgroundColor: "#171717",
    borderColor: "#66561f",
    borderWidth: 1,
    color: "#fef1e0",
    fontSize: 16,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  eyebrow: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  label: {
    color: "#ddd2b5",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  meta: {
    color: "#8f866f",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
    marginTop: 8,
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 48,
  },
  primaryActionText: {
    color: "#fef1e0",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
  secondaryAction: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#5b4b18",
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 44,
  },
  secondaryActionText: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  section: {
    backgroundColor: "#090909",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    marginTop: 14,
    padding: 14,
  },
  title: {
    color: "#fef1e0",
    fontSize: 26,
    fontWeight: "900",
    marginTop: 6,
  },
});
