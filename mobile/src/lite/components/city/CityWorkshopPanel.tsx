import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cityActionMessage } from "@/lib/cityHub";
import { cityRequestId, craftCityItem, healCitySquad, type WorkshopCraftItem } from "@/lite/lib/cityHubClient";
import { theme } from "@/lite/theme";
import { createCityRequestJournal } from "@/lite/lib/cityRequestJournal";

type Action = "heal" | WorkshopCraftItem;
const requests = createCityRequestJournal(AsyncStorage, cityRequestId);
const recipes: { id: WorkshopCraftItem; name: string; ingredients: string; description: string }[] = [
  { id: "item.repair_kit", name: "REPAIR KIT", ingredients: "1 Emergency Patch + 3 Blueprint Fragments", description: "Restore 50% of a Holobot’s maximum health." },
  { id: "item.full_restore", name: "FULL RESTORE", ingredients: "1 Repair Kit + 5 Blueprint Fragments", description: "Restore a Holobot to full health." },
];

export function CityWorkshopPanel({ uid, preview = false, onBrowse }: { uid?: string; preview?: boolean; onBrowse: () => void }) {
  const [pending, setPending] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  async function run(action: Action) {
    if (busy.current) return;
    if (preview) { setMessage("Preview only · workshop actions are disconnected."); setFailed(false); return; }
    if (!uid) { setMessage("Sign in to visit the workshop."); return; }
    busy.current = true; setPending(action); setMessage(null);
    try {
      const requestId = await requests.acquire(uid, action);
      if (action === "heal") {
        const reply = await healCitySquad(uid, requestId);
        setMessage(`Travel squad restored · ${(reply.holobotIds as string[]).map((id) => id.toUpperCase()).join(", ")} · 0 Holos`);
      } else {
        await craftCityItem(uid, action, requestId);
        setMessage(`${action === "item.repair_kit" ? "Repair Kit" : "Full Restore"} crafted. Your inventory has updated.`);
      }
      await requests.complete(uid, action, requestId); setFailed(false);
    } catch (error) { setMessage(cityActionMessage(error)); setFailed(true); }
    finally { busy.current = false; setPending(null); }
  }
  return <View style={styles.content}>
    <Text style={styles.eyebrow}>WORKSHOP / SERVICE BAY</Text>
    <Text style={styles.title}>Back to full strength.</Text>
    <View style={styles.card}>
      <View style={styles.row}><Text style={styles.cardTitle}>SQUAD HEAL</Text><Text style={styles.free}>FREE</Text></View>
      <Text style={styles.body}>Fully restore your travel squad, including knocked-out Holobots. Finish any open battle before healing.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Heal travel squad for free" disabled={pending !== null} onPress={() => void run("heal")} style={[styles.primary, pending !== null && styles.disabled]}>
        {pending === "heal" ? <ActivityIndicator color={theme.colors.carbon} /> : <Text style={styles.primaryText}>RESTORE SQUAD</Text>}
      </Pressable>
    </View>
    <Text style={styles.eyebrow}>CRAFT REPAIR ITEMS</Text>
    {recipes.map((recipe) => <View style={styles.card} key={recipe.id}>
      <Text style={styles.cardTitle}>{recipe.name}</Text>
      <Text style={styles.body}>{recipe.description}</Text>
      <Text style={styles.ingredients}>{recipe.ingredients}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Craft ${recipe.name}`} disabled={pending !== null} onPress={() => void run(recipe.id)} style={[styles.secondary, pending !== null && styles.disabled]}>
        {pending === recipe.id ? <ActivityIndicator color={theme.colors.accent} /> : <Text style={styles.secondaryText}>CRAFT ONE</Text>}
      </Pressable>
    </View>)}
    {message ? <Text accessibilityRole="alert" style={[styles.message, failed && { color: theme.colors.warning }]}>{message}</Text> : null}
    <Pressable accessibilityRole="button" onPress={onBrowse} style={styles.browse}><Text style={styles.secondaryText}>BROWSE SUPPLIES →</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({
  content: { gap: 14, padding: 22 }, eyebrow: { ...theme.type.micro, color: theme.colors.accent, letterSpacing: 1.8 },
  title: { ...theme.type.header, color: theme.colors.text }, card: { backgroundColor: theme.plates.raised, borderWidth: 1, borderColor: theme.colors.border, padding: 16, gap: 12, borderRadius: theme.radius.md },
  row: { flexDirection: "row", justifyContent: "space-between" }, cardTitle: { ...theme.type.label, color: theme.colors.text }, free: { ...theme.type.label, color: theme.colors.success },
  body: { ...theme.type.body, color: theme.colors.muted }, ingredients: { ...theme.type.caption, color: theme.colors.warning },
  primary: { minHeight: 48, justifyContent: "center", alignItems: "center", backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm }, primaryText: { ...theme.type.label, color: theme.colors.carbon },
  secondary: { minHeight: 48, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: theme.colors.accent, borderRadius: theme.radius.sm }, secondaryText: { ...theme.type.label, color: theme.colors.accent },
  disabled: { opacity: 0.5 }, message: { ...theme.type.body, color: theme.colors.success }, browse: { minHeight: 48, justifyContent: "center", alignItems: "center" },
});
