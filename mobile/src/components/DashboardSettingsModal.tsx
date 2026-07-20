import { useEffect, useMemo, useState } from "react";
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
import { GameDialogFrame, GameSurfaceFrame } from "@/components/ui/GameSurfaceFrame";
import { ArenaControlFrame } from "@/components/arena/ArenaTierFrames";
import { isIapEnabled, restorePurchases } from "@/lib/purchases";

type DashboardSettingsModalProps = {
  onClose: () => void;
  visible: boolean;
};

export function DashboardSettingsModal({ onClose, visible }: DashboardSettingsModalProps) {
  const { user, profile, deleteAccount, logout } = useAuth();
  const [isDeleteFlowOpen, setIsDeleteFlowOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [canRestorePurchases, setCanRestorePurchases] = useState(false);
  const [isRestoringPurchases, setIsRestoringPurchases] = useState(false);

  // Apple requires a Restore Purchases control once IAP ships; the row only
  // renders when the remote iapEnabled flag (plus key + platform) resolves
  // true, so it is invisible for the entire dormant beta period.
  useEffect(() => {
    if (!visible) {
      return;
    }

    let cancelled = false;
    void isIapEnabled().then((enabled) => {
      if (!cancelled) {
        setCanRestorePurchases(enabled);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [visible]);

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
            <GameDialogFrame accent={isDeleteFlowOpen ? "#ef4444" : "#f0bf14"} fill="#07080a" />
            {!isDeleteFlowOpen ? (
              <>
                <Text style={styles.eyebrow}>DASHBOARD SETTINGS</Text>
                <Text style={styles.title}>Pilot Controls</Text>
                <Text style={styles.copy}>
                  Manage your account and fitness connections from one place.
                </Text>

                <View style={styles.section}>
                  <GameSurfaceFrame accent="#f0bf14" />
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
                    <ArenaControlFrame accent="#f0bf14" />
                    <Text style={styles.primaryActionText}>SIGN OUT</Text>
                  </Pressable>
                  {canRestorePurchases ? (
                    <Pressable
                      disabled={isRestoringPurchases}
                      style={styles.secondaryAction}
                      onPress={async () => {
                        setIsRestoringPurchases(true);
                        try {
                          const customerInfo = await restorePurchases();
                          const restoredCount = customerInfo
                            ? Object.keys(customerInfo.entitlements.active).length
                            : 0;
                          Alert.alert(
                            "Restore Purchases",
                            restoredCount > 0
                              ? "Your purchases were restored. Rewards are applied by the server and may take a moment to appear."
                              : "No previous purchases were found for this App Store account.",
                          );
                        } catch (error) {
                          Alert.alert(
                            "Restore failed",
                            error instanceof Error ? error.message : "Please try again.",
                          );
                        } finally {
                          setIsRestoringPurchases(false);
                        }
                      }}
                    >
                      <ArenaControlFrame accent="#f0bf14" />
                      {isRestoringPurchases ? (
                        <ActivityIndicator color="#f0bf14" />
                      ) : (
                        <Text style={styles.secondaryActionText}>RESTORE PURCHASES</Text>
                      )}
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.section}>
                  <GameSurfaceFrame accent="#ef4444" />
                  <Text style={styles.dangerLabel}>DANGER ZONE</Text>
                  <Text style={styles.meta}>
                    Permanently remove this account and all saved pilot data from Holobots Mobile.
                  </Text>
                  <Pressable
                    style={styles.deleteAccountButton}
                    onPress={() => {
                      setDeleteConfirmationText("");
                      setDeleteError(null);
                      setIsDeleteFlowOpen(true);
                    }}
                  >
                    <ArenaControlFrame accent="#ef4444" />
                    <Text style={styles.deleteAccountText}>DELETE ACCOUNT</Text>
                  </Pressable>
                </View>

                <Pressable style={styles.closeButton} onPress={onClose}>
                  <ArenaControlFrame accent="#f0bf14" selected />
                  <Text style={styles.closeText}>CLOSE</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.eyebrow}>ACCOUNT ACTION</Text>
                <Text style={styles.title}>Delete Account</Text>
                <Text style={styles.copy}>
                  This permanently removes your Holobots account from the app. Type DELETE below to confirm.
                </Text>

                <View style={styles.section}>
                  <GameSurfaceFrame accent="#ef4444" />
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
                      setIsDeleteFlowOpen(false);
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
                  <ArenaControlFrame accent="#ef4444" selected={canConfirmDelete} />
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
                    setIsDeleteFlowOpen(false);
                  }}
                >
                  <ArenaControlFrame accent="#f0bf14" />
                  <Text style={styles.closeText}>CANCEL</Text>
                </Pressable>
              </>
            )}
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
    backgroundColor: "transparent",
    maxWidth: 420,
    overflow: "hidden",
    padding: 20,
    position: "relative",
    width: "100%",
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    justifyContent: "center",
    marginTop: 16,
    minHeight: 48,
    position: "relative",
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
    backgroundColor: "transparent",
    justifyContent: "center",
    marginTop: 12,
    minHeight: 48,
    position: "relative",
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
    backgroundColor: "transparent",
    justifyContent: "center",
    marginTop: 12,
    minHeight: 48,
    position: "relative",
  },
  primaryActionText: {
    color: "#fef1e0",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
  secondaryAction: {
    alignItems: "center",
    backgroundColor: "transparent",
    justifyContent: "center",
    marginTop: 12,
    minHeight: 44,
    position: "relative",
  },
  secondaryActionText: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  section: {
    backgroundColor: "transparent",
    marginTop: 14,
    padding: 14,
    position: "relative",
  },
  title: {
    color: "#fef1e0",
    fontSize: 26,
    fontWeight: "900",
    marginTop: 6,
  },
});
