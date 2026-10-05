import { useEffect } from "react";
import { View, StyleSheet, Image, Dimensions, StatusBar } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import Logos from "../assets/images/backlogo-transparent.png";

const { width } = Dimensions.get("window");

function GlowOrb({ color, size, top, left, right, bottom, delay }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.ease), delay }),
        withTiming(0, { duration: 2600, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
  }, [delay, pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.12 + pulse.value * 0.16,
    transform: [{ scale: 1 + pulse.value * 0.2 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.orb,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color, top, left, right, bottom },
        style,
      ]}
    />
  );
}

function SpinRing() {
  const spin = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(withTiming(1, { duration: 4500, easing: Easing.linear }), -1, false);
  }, [spin]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <Animated.View style={[styles.spinRing, style]} pointerEvents="none">
      <View style={[styles.spinArc, styles.spinArcGold]} />
      <View style={[styles.spinArc, styles.spinArcBlue]} />
    </Animated.View>
  );
}

export default function AppSplash() {
  const enter = useSharedValue(0);
  const breathe = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    enter.value = withSequence(
      withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) })
    );
    breathe.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    glow.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [enter, breathe, glow]);

  const stageStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: interpolate(enter.value, [0, 1], [0.8, 1]) }],
  }));

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breathe.value * 0.05 }],
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + glow.value * 0.45,
    transform: [{ scale: 1 + glow.value * 0.08 }],
  }));

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" />

      <LinearGradient
        colors={["#050505", "#120f08", "#0a0a0a", "#050505"]}
        locations={[0, 0.35, 0.7, 1]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <GlowOrb color="#e8b84a" size={320} top={-100} left={-80} delay={0} />
      <GlowOrb color="#3b82f6" size={240} top={80} right={-90} delay={600} />
      <GlowOrb color="#8b5cf6" size={200} bottom={-60} left={width * 0.2} delay={1200} />
      <GlowOrb color="#e8b84a" size={160} bottom={100} right={-50} delay={1800} />

      <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
        <Animated.View entering={FadeIn.duration(600)} style={styles.stage}>
          <Animated.View style={[styles.logoBlock, stageStyle]}>
            <Animated.View style={[styles.halo, haloStyle]} />
            <SpinRing />
            <Animated.View style={[styles.logoWrap, logoStyle]}>
              <Image source={Logos} style={styles.logo} resizeMode="contain" />
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050505" },
  safe: { flex: 1 },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },

  orb: { position: "absolute" },

  logoBlock: {
    width: 260,
    height: 260,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(232,184,74,0.12)",
  },
  spinRing: {
    position: "absolute",
    width: 220,
    height: 220,
    alignItems: "center",
    justifyContent: "center",
  },
  spinArc: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
  },
  spinArcGold: {
    borderColor: "transparent",
    borderTopColor: "rgba(232,184,74,0.85)",
    borderRightColor: "rgba(232,184,74,0.35)",
  },
  spinArcBlue: {
    width: 188,
    height: 188,
    borderRadius: 94,
    borderColor: "transparent",
    borderBottomColor: "rgba(59,130,246,0.5)",
    borderLeftColor: "rgba(139,92,246,0.35)",
    transform: [{ rotate: "45deg" }],
  },
  logoWrap: {
    width: 150,
    height: 150,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  logo: { width: 140, height: 140 },
});
