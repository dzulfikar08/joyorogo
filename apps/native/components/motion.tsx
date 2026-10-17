import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable } from "react-native";
import type { PressableProps, StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  type EntryAnimationsValues,
  type LayoutAnimation,
  FadeIn,
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

// Shared motion vocabulary. Everything here runs on the UI thread except the
// kcal count-up, which is a handful of text frames. Movement is transform and
// opacity only; under reduced motion movement drops out and opacity stays.

/** Strong ease-out: instant start, soft landing. The default for anything entering. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

const PRESS_IN_MS = 100;
const PRESS_OUT_MS = 180;
const ENTER_MS = 220;
/** Stagger step between siblings; capped so long lists never feel slow. */
const STAGGER_MS = 45;
const STAGGER_MAX = 6;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Press feedback driven by one shared value: scale down on press-in, ease back
 * on release. `dimTo` also fades the element (rows, links). Spread `style` onto
 * an Animated.View / AnimatedPressable and wire the two handlers.
 */
export function usePressFeedback(scaleTo = 0.97, dimTo?: number) {
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);

  const style = useAnimatedStyle(() => {
    const out: { opacity?: number; transform?: [{ scale: number }] } = {};
    if (dimTo !== undefined) out.opacity = 1 - pressed.value * (1 - dimTo);
    if (!reduceMotion && scaleTo !== 1) {
      out.transform = [{ scale: 1 - pressed.value * (1 - scaleTo) }];
    }
    return out;
  }, [dimTo, scaleTo, reduceMotion]);

  const onPressIn = useCallback(() => {
    pressed.value = withTiming(1, { duration: PRESS_IN_MS, easing: EASE_OUT });
  }, [pressed]);
  const onPressOut = useCallback(() => {
    pressed.value = withTiming(0, { duration: PRESS_OUT_MS, easing: EASE_OUT });
  }, [pressed]);

  return { style, onPressIn, onPressOut };
}

type PressableScaleProps = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed. 1 disables scaling (full-width rows). */
  scaleTo?: number;
  /** Opacity while pressed. Leave undefined to keep opacity untouched. */
  dimTo?: number;
};

/** Pressable with UI-thread press feedback. Style is static (no pressed callback). */
export function PressableScale({
  scaleTo = 0.97,
  dimTo,
  style,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const press = usePressFeedback(scaleTo, dimTo);
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        press.onPressIn();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        press.onPressOut();
        onPressOut?.(e);
      }}
      style={[style, press.style]}
    />
  );
}

/**
 * Entering animation for the n-th sibling: fade plus an 8px rise, staggered.
 * Reduced motion keeps a plain fade. Pass to Animated.View `entering`.
 */
export function useEnter(index = 0) {
  const reduceMotion = useReducedMotion();
  return useMemo(() => {
    const delay = Math.min(index, STAGGER_MAX) * STAGGER_MS;
    if (reduceMotion) {
      return FadeIn.duration(150).delay(delay).reduceMotion(ReduceMotion.Never);
    }
    return FadeInDown.duration(ENTER_MS)
      .delay(delay)
      .easing(EASE_OUT)
      .withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] })
      .reduceMotion(ReduceMotion.Never);
  }, [index, reduceMotion]);
}

/** Spring pop from 0.7 (never 0) with a quick fade. A custom entering worklet because the preset zoom has no opacity. */
function popInAnimation(_values: EntryAnimationsValues): LayoutAnimation {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.7 }] },
    animations: {
      opacity: withTiming(1, { duration: 150 }),
      transform: [{ scale: withSpring(1, { damping: 16, stiffness: 260 }) }],
    },
  };
}

/** Entering animation for a success mark or a freshly added chip. Fade only under reduced motion. */
export function usePopIn() {
  const reduceMotion = useReducedMotion();
  return reduceMotion ? FadeIn.duration(150).reduceMotion(ReduceMotion.Never) : popInAnimation;
}

/**
 * Spring scale-up of an element whenever `trigger` flips true (tab icon becoming
 * active, a toggled-on state). Rests at scale 1.
 */
export function useActivePop(active: boolean) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (!active || reduceMotion) return;
    scale.value = 0.82;
    scale.value = withSpring(1, { damping: 11, stiffness: 320, mass: 0.7 });
  }, [active, reduceMotion, scale]);
  return useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
}

/**
 * Eases a displayed integer toward `value` over ~450ms (ease-out quart), starting
 * from whatever is on screen so a changed total counts the delta instead of
 * replaying from zero. Under reduced motion it snaps.
 */
export function useCountUp(value: number, duration = 450): number {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(reduceMotion ? value : 0);
  const current = useRef(shown);

  useEffect(() => {
    if (reduceMotion) {
      current.current = value;
      setShown(value);
      return;
    }
    const from = current.current;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      const next = Math.round(from + (value - from) * (1 - (1 - p) ** 4));
      current.current = next;
      setShown(next);
      if (p < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduceMotion]);

  return shown;
}

/** Wraps a block in the staggered entering animation (hooks can't sit after a screen's early returns). */
export function Reveal({
  index = 0,
  style,
  children,
}: {
  index?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const entering = useEnter(index);
  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}

/** Wraps a success mark (check icon) in the spring pop. */
export function PopIn({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const entering = usePopIn();
  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}
