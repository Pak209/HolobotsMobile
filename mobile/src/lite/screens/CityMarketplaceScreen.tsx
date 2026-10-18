import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RootTabs } from "../../../LiteApp";
import { useAuth } from "@/contexts/AuthContext";
import { CITY_MARKET_COPY, cityMarketReducer, initialCityMarketState, presentCityMarket } from "@/lite/lib/cityMarket";
import { createCityMarketController, fixtureCityMarketHost, liveCityMarketHost, type CityMarketFixture } from "@/lite/lib/cityMarketClient";
import { cityRequestId } from "@/lite/lib/cityHubClient";
import { createCityRequestJournal } from "@/lite/lib/cityRequestJournal";
import { theme } from "@/lite/theme";

const journal = createCityRequestJournal(AsyncStorage, cityRequestId);
const copy = CITY_MARKET_COPY;

/**
 * HoloCity lite Marketplace ("Browse the stalls"), reached from the city hub's Vendor district and
 * tile. Renders the host's vendorCatalogHost reply only; BUY → CONFIRM sends the listing's own
 * purchase call, then re-reads the catalog. Presentation only (hard rule 1).
 */
export function CityMarketplaceScreen({ fixture }: { fixture?: CityMarketFixture } = {}) {
  const { user } = useAuth();
  // A new account gets a new page: no catalog, notice or pending purchase crosses sessions.
  return <CityMarketPage key={fixture ? "offline-fixture" : user?.uid ?? "signed-out"} uid={user?.uid} fixture={fixture} />;
}

function CityMarketPage({ uid, fixture }: { uid?: string; fixture?: CityMarketFixture }) {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const route = useRoute<RouteProp<RootTabs, "CityMarket">>();
  const insets = useSafeAreaInsets();
  const host = useMemo(() => fixture ? (fixture.signedIn ? fixtureCityMarketHost(fixture) : null) : uid ? liveCityMarketHost(uid, journal) : null, [fixture, uid]);
  const [state, dispatch] = useReducer(cityMarketReducer, host, initialCityMarketState);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const controller = useMemo(() => createCityMarketController(host, (event) => { if (mounted.current) dispatch(event); }), [host]);
  useFocusEffect(useCallback(() => { void controller.load(); }, [controller]));

  const opened = useRef(false);
  useEffect(() => {
    const target = fixture?.open?.buy ?? fixture?.open?.confirm;
    if (!target || opened.current || state.phase !== "ready") return;
    opened.current = true;
    const listing = state.catalog?.listings.find((row) => row.listingId === target);
    if (!listing) return;
    dispatch({ type: "select", listingId: listing.listingId });
    if (fixture?.open?.buy) void controller.confirm(listing);
  }, [fixture, controller, state.phase, state.catalog]);

  const view = presentCityMarket(state);
  const confirmListing = state.catalog?.listings.find((row) => row.listingId === state.confirming);
  // Back returns to whoever opened the market: Home's MARKET or the city's Vendor.
  const fromHome = route.params?.from === "Home";
  const back = () => navigation.navigate(fromHome ? "Home" : "CityHub");

  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: insets.bottom + (view.confirm ? 220 : 24) }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}><Text style={styles.kicker}>{copy.kicker}</Text><Text style={styles.title}>{copy.title}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={fromHome ? copy.backHomeLabel : copy.backLabel} onPress={back} style={styles.home}><Text style={styles.homeText}>‹</Text></Pressable>
      </View>
      <View style={styles.statusRow}>
        <View style={styles.signal}><View style={styles.signalDot} /><Text style={styles.statusText}>{copy.status}</Text></View>
        {/* PLACEHOLDER copy (Lex, DECISIONS #71). */}
        {view.holosText ? <Text accessibilityLabel={`Holos on your account: ${view.holosText}`} testID="city-market-holos" style={styles.holos}>{view.holosText}</Text> : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{copy.vendorName}</Text>
        <Text style={styles.body}>{copy.intro}</Text>
      </View>
      {view.notice ? <Text accessibilityRole="alert" testID="city-market-notice" style={[styles.notice, view.notice.tone === "ok" ? styles.noticeOk : view.notice.tone === "refused" ? styles.noticeRefused : styles.noticeInfo]}>{view.notice.text}</Text> : null}
      {view.loading ? <View style={styles.loading}><ActivityIndicator color={theme.colors.accent} /><Text style={styles.caption}>{copy.loading}</Text></View> : null}
      {view.plate ? <View style={styles.plate} testID="city-market-plate">
        <Text style={styles.plateTitle}>{view.plate.title}</Text>
        <Text style={styles.body}>{view.plate.body}</Text>
        {view.plate.refresh ? <Pressable accessibilityRole="button" disabled={!view.refreshEnabled} onPress={() => void controller.load()} style={[styles.primary, !view.refreshEnabled && styles.disabled]}>
          <Text style={styles.primaryText}>{view.refreshing ? copy.refreshing : copy.refresh}</Text>
        </Pressable> : null}
      </View> : null}
      {view.sections.map((section) => <View key={section.kind} style={styles.section}>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        {section.rows.map((row) => <View key={row.listingId} style={styles.row} testID={`city-market-row-${row.listingId}`}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{row.title}</Text>
            <Text style={styles.price}>{row.priceText}</Text>
            {row.metaText ? <Text style={styles.caption}>{row.metaText}</Text> : null}
            {row.detailText ? <Text style={styles.detail}>{row.detailText}</Text> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${row.action.label}: ${row.title}`} disabled={!row.action.enabled}
            onPress={() => dispatch({ type: "select", listingId: row.listingId })} style={[styles.buy, !row.action.enabled && styles.buyDisabled]}>
            <Text style={[styles.buyText, !row.action.enabled && styles.buyTextDisabled]}>{row.action.label}</Text>
          </Pressable>
        </View>)}
      </View>)}
      <View style={styles.footer}>
        <Text style={styles.caption}>{copy.footer}</Text>
        <View style={styles.footerRow}>
          {state.phase === "ready" ? <Pressable accessibilityRole="button" disabled={!view.refreshEnabled} onPress={() => void controller.load()} style={styles.refresh}>
            <Text style={[styles.caption, { color: theme.colors.accent }]}>{view.refreshing ? copy.refreshing : copy.refreshStalls}</Text>
          </Pressable> : <View />}
          {fixture ? <Text style={styles.caption}>OFFLINE PREVIEW</Text> : null}
        </View>
      </View>
    </ScrollView>
    {view.confirm && confirmListing ? <View style={[styles.confirmSheet, { paddingBottom: insets.bottom + 18 }]} testID="city-market-confirm">
      <Text style={styles.confirmText}>{view.confirm.text}</Text>
      <Text style={styles.body}>{view.confirm.body}</Text>
      <View style={styles.confirmRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Confirm: ${view.confirm.text}`} disabled={!view.confirm.enabled}
          onPress={() => void controller.confirm(confirmListing)} style={[styles.primary, styles.confirmButton, !view.confirm.enabled && styles.disabled]}>
          {state.buying ? <ActivityIndicator color={theme.colors.carbon} /> : <Text style={styles.primaryText}>{copy.confirm}</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" disabled={!!state.buying} onPress={() => dispatch({ type: "cancel" })} style={[styles.secondary, styles.confirmButton, !!state.buying && styles.disabled]}>
          <Text style={styles.secondaryText}>{copy.cancel}</Text>
        </Pressable>
      </View>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.carbon },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 22, gap: 8 },
  kicker: { ...theme.type.micro, color: theme.colors.accent, letterSpacing: 1.8, marginBottom: 6 }, title: { ...theme.type.header, color: theme.colors.text, fontSize: 24 },
  home: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radius.md }, homeText: { color: theme.colors.accent, fontSize: 30, lineHeight: 34 },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 22, marginTop: 22, marginBottom: 14 },
  signal: { flexDirection: "row", alignItems: "center", gap: 7 }, signalDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.colors.accent },
  statusText: { ...theme.type.micro, color: theme.colors.muted, letterSpacing: 1.1 }, holos: { ...theme.type.value, color: theme.colors.warning },
  card: { marginHorizontal: 20, padding: 18, borderColor: theme.colors.border, borderWidth: 1, backgroundColor: theme.plates.navy, borderRadius: theme.radius.md, gap: 8 },
  cardTitle: { ...theme.type.label, color: theme.colors.text }, body: { ...theme.type.body, color: theme.colors.muted }, caption: { ...theme.type.micro, color: theme.colors.muted, letterSpacing: 0.8 },
  notice: { ...theme.type.body, marginHorizontal: 20, marginTop: 16 }, noticeOk: { color: theme.colors.success }, noticeRefused: { color: theme.colors.warning }, noticeInfo: { color: theme.colors.accent },
  loading: { alignItems: "center", gap: 10, padding: 32 },
  plate: { marginHorizontal: 20, marginTop: 18, padding: 18, gap: 12, borderWidth: 1, borderColor: theme.colors.warning, borderRadius: theme.radius.md, backgroundColor: theme.plates.raised },
  plateTitle: { ...theme.type.header, color: theme.colors.warning },
  section: { marginHorizontal: 20, marginTop: 22, gap: 10 }, sectionTitle: { ...theme.type.micro, color: theme.colors.accent, letterSpacing: 1.8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.plates.navy },
  rowText: { flex: 1, gap: 3 }, rowTitle: { ...theme.type.label, color: theme.colors.text }, price: { ...theme.type.value, fontSize: 14, color: theme.colors.warning }, detail: { ...theme.type.caption, color: theme.colors.subtle },
  buy: { minWidth: 96, minHeight: 48, paddingHorizontal: 10, justifyContent: "center", alignItems: "center", backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm },
  buyDisabled: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.colors.disabled }, buyText: { ...theme.type.label, fontSize: 13, color: theme.colors.carbon, textAlign: "center" }, buyTextDisabled: { color: theme.colors.muted },
  footer: { marginHorizontal: 22, marginTop: 24, gap: 8 }, footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, refresh: { minHeight: 48, justifyContent: "center" },
  primary: { minHeight: 48, backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm, justifyContent: "center", alignItems: "center", padding: 10 }, primaryText: { ...theme.type.label, color: theme.colors.carbon, textAlign: "center", fontSize: 14 },
  secondary: { minHeight: 48, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: theme.colors.accent, borderRadius: theme.radius.sm, padding: 10 }, secondaryText: { ...theme.type.label, color: theme.colors.accent, fontSize: 14 },
  disabled: { opacity: 0.5 },
  confirmSheet: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 22, paddingTop: 18, gap: 10, backgroundColor: theme.plates.overlay, borderTopWidth: 1, borderTopColor: theme.colors.accent },
  confirmText: { ...theme.type.label, color: theme.colors.text }, confirmRow: { flexDirection: "row", gap: 12 }, confirmButton: { flex: 1 },
});
