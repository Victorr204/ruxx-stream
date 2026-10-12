import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { GOLD, useTheme } from "../../context/ThemeContext";
import {
  PREMIUM_BASE_PRICE,
  PREMIUM_TOTAL_PRICE,
  PREMIUM_VAT_PRICE,
  PREMIUM_VAT_RATE,
  PROMO_BASE_PRICE,
  PROMO_TOTAL_PRICE,
  PROMO_VAT_PRICE,
  naira,
} from "../lib/pricing";

type CheckoutMode = "subscription" | "transfer";

type Props = {
  visible: boolean;
  firstTime: boolean;
  upgrading: string;
  onCheckout: (mode: CheckoutMode) => void;
  onClose: () => void;
};

export default function PremiumSheet({ visible, firstTime, upgrading, onCheckout, onClose }: Props) {
  const { theme } = useTheme();

  const cardMeta = firstTime
    ? `${naira(PROMO_TOTAL_PRICE)} • first 30 days`
    : `${naira(PREMIUM_TOTAL_PRICE)}/month • renews automatically`;
  const transferMeta = firstTime
    ? `${naira(PROMO_TOTAL_PRICE)} • first 30 days`
    : `${naira(PREMIUM_TOTAL_PRICE)} one-time • 30 days`;

  const basePrice = firstTime ? PROMO_BASE_PRICE : PREMIUM_BASE_PRICE;
  const vatPrice = firstTime ? PROMO_VAT_PRICE : PREMIUM_VAT_PRICE;
  const totalPrice = firstTime ? PROMO_TOTAL_PRICE : PREMIUM_TOTAL_PRICE;
  const baseLabel = firstTime ? "First month subscription" : "Monthly subscription";
  const totalLabel = firstTime ? "Total for first month" : "Total per month";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(180)} style={styles.backdrop}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          activeOpacity={1}
          accessibilityLabel="Close"
        />
        <Animated.View
          entering={FadeInDown.duration(240)}
          style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
        >
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.headerTick} />
              <Text style={[styles.title, { color: theme.text }]}>Ruxx Premium</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={18} color={theme.subtitle} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.tagline, { color: theme.subtitle }]}>
            Ad-free streaming and offline downloads on every device.
          </Text>

          {firstTime && (
            <View style={[styles.promo, { borderColor: "rgba(232,184,74,0.45)" }]}>
              <Ionicons name="gift-outline" size={18} color={GOLD} />
              <View style={styles.promoText}>
                <Text style={[styles.promoTitle, { color: theme.text }]}>
                  First month promo — {naira(PROMO_TOTAL_PRICE)}
                </Text>
                <Text style={[styles.promoMeta, { color: theme.subtitle }]}>
                  New members pay {naira(PROMO_TOTAL_PRICE)} (VAT included) for their first 30
                  days. After that the regular {naira(PREMIUM_TOTAL_PRICE)}/month applies.
                </Text>
              </View>
            </View>
          )}

          <View style={[styles.breakdown, { backgroundColor: theme.inputBackground, borderColor: theme.inputBorder }]}>
            <View style={styles.priceRow}>
              <Text style={[styles.priceLabel, { color: theme.subtitle }]}>{baseLabel}</Text>
              <Text style={[styles.priceValue, { color: theme.text }]}>{naira(basePrice)}</Text>
            </View>
            <View style={styles.priceRow}>
              <Text style={[styles.priceLabel, { color: theme.subtitle }]}>
                VAT ({PREMIUM_VAT_RATE}%)
              </Text>
              <Text style={[styles.priceValue, { color: theme.text }]}>{naira(vatPrice)}</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />
            <View style={styles.priceRow}>
              <Text style={[styles.totalLabel, { color: theme.text }]}>{totalLabel}</Text>
              <Text style={[styles.totalValue, { color: GOLD }]}>{naira(totalPrice)}</Text>
            </View>
            {firstTime && (
              <Text style={[styles.afterPromo, { color: theme.placeholder }]}>
                From month 2: {naira(PREMIUM_BASE_PRICE)} + {naira(PREMIUM_VAT_PRICE)} VAT ={" "}
                {naira(PREMIUM_TOTAL_PRICE)}/month.
              </Text>
            )}
          </View>

          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.payBtn, styles.payPrimary, upgrading ? styles.payBusy : null]}
              onPress={() => onCheckout("subscription")}
              disabled={!!upgrading}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Pay with Card"
            >
              <Ionicons name="card-outline" size={19} color="#111111" />
              <View style={styles.payText}>
                <Text style={styles.payTitle}>Pay with Card</Text>
                <Text style={styles.payMeta}>{cardMeta}</Text>
              </View>
              {upgrading === "subscription" ? (
                <ActivityIndicator size="small" color="#111111" />
              ) : (
                <Ionicons name="chevron-forward" size={17} color="#111111" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.payBtn,
                styles.payOutline,
                { borderColor: "rgba(232,184,74,0.55)" },
                upgrading ? styles.payBusy : null,
              ]}
              onPress={() => onCheckout("transfer")}
              disabled={!!upgrading}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Pay with Bank Transfer"
            >
              <Ionicons name="swap-horizontal-outline" size={19} color={GOLD} />
              <View style={styles.payText}>
                <Text style={[styles.payTitle, { color: theme.text }]}>Pay with Bank Transfer</Text>
                <Text style={[styles.payMeta, { color: theme.subtitle }]}>{transferMeta}</Text>
              </View>
              {upgrading === "transfer" ? (
                <ActivityIndicator size="small" color={GOLD} />
              ) : (
                <Ionicons name="chevron-forward" size={17} color={GOLD} />
              )}
            </TouchableOpacity>
          </View>

          <Text style={[styles.footnote, { color: theme.placeholder }]}>
            Secure checkout powered by Paystack.
          </Text>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 26,
    gap: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 9 },
  headerTick: { width: 3, height: 13, borderRadius: 2, backgroundColor: GOLD },
  title: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  tagline: { fontSize: 12.5, lineHeight: 17, marginTop: -2 },
  promo: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(232,184,74,0.07)",
  },
  promoText: { flex: 1, gap: 3 },
  promoTitle: { fontSize: 13.5, fontWeight: "800" },
  promoMeta: { fontSize: 11.5, lineHeight: 16, fontWeight: "600" },
  breakdown: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 9,
  },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  priceLabel: { fontSize: 12.5, fontWeight: "600" },
  priceValue: { fontSize: 13, fontWeight: "700" },
  divider: { height: 1, opacity: 0.8 },
  totalLabel: { fontSize: 13.5, fontWeight: "800" },
  totalValue: { fontSize: 15.5, fontWeight: "900" },
  afterPromo: { fontSize: 11, lineHeight: 15, fontWeight: "600", marginTop: 2 },
  buttons: { gap: 9 },
  payBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1.5,
  },
  payPrimary: { backgroundColor: GOLD, borderColor: GOLD },
  payOutline: { backgroundColor: "transparent" },
  payBusy: { opacity: 0.75 },
  payText: { flex: 1, gap: 2 },
  payTitle: { fontSize: 14, fontWeight: "800", color: "#111111" },
  payMeta: { fontSize: 11.5, fontWeight: "600", color: "rgba(17,17,17,0.72)" },
  footnote: { fontSize: 11, textAlign: "center" },
});
