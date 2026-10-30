// "use no memo" — the widget task renderer walks these components outside
// React (react-native-android-widget buildWidgetTree), so react-compiler's
// useMemoCache hook has no dispatcher and crashes. Keep this first.
"use no memo";

import { FlexWidget, ImageWidget, SvgWidget, TextWidget } from "react-native-android-widget";

import { dayIn, i18n, isDayZone } from "@joyorogo/i18n";

import { darkTheme, lightTheme } from "@/theme";
import { FONT_BOLD, FONT_HEAVY } from "@/src/lib/widgets/fonts";
import {
  STREAK_CAPTION_LINE,
  STREAK_CAPTION_SIZE,
  STREAK_PADDING,
  STREAK_TITLE_LINE,
  streakTileLayout,
} from "@/src/lib/widgets/layout";
import { CAMERA_WIDGET_URI } from "@/src/lib/widgets/names";
import type { WidgetSnapshot } from "@/src/lib/widgets/snapshot";
import { MASCOT_ART, streakWidgetModel } from "@/src/lib/widgets/streak-model";
import type { StreakPose } from "@/src/lib/widgets/streak-model";

/**
 * Joyo cut-outs for the streak tile: the app's mascot poses trimmed to their art and cut to 192 px
 * (assets/widget/mascot). Sizes live in MASCOT_ART, which the tile layout needs and a test checks against the files.
 */
const POSE_IMAGE: Record<StreakPose, number> = {
  cheer: require("@/assets/widget/mascot/cheer.webp"),
  milestone: require("@/assets/widget/mascot/milestone.webp"),
  welcome: require("@/assets/widget/mascot/welcome.webp"),
  morning: require("@/assets/widget/mascot/morning.webp"),
  sideeye: require("@/assets/widget/mascot/sideeye.webp"),
  panic: require("@/assets/widget/mascot/panic.webp"),
  lastchance: require("@/assets/widget/mascot/lastchance.webp"),
  teary: require("@/assets/widget/mascot/teary.webp"),
  mopey: require("@/assets/widget/mascot/mopey.webp"),
  frozen: require("@/assets/widget/mascot/frozen.webp"),
  dusty: require("@/assets/widget/mascot/dusty.webp"),
  ghost: require("@/assets/widget/mascot/ghost.webp"),
  ready: require("@/assets/widget/mascot/ready.webp"),
  relax: require("@/assets/widget/mascot/relax.webp"),
};

/** Flame outline and its inner tongue (24x24). Two paths so the cold flame can drop the tongue's colour. */
const FLAME_OUTER =
  "M12 2.2C12.4 5.6 14.1 7.3 15.9 9.4C17.7 11.5 19 13.4 19 15.8A7 7 0 0 1 5 15.8C5 13 6.3 11.3 7.6 9.9C8.6 11.2 9.4 11.8 10.4 11.8C10.4 8.2 10.7 5 12 2.2Z";
const FLAME_INNER =
  "M12 21.5A3.9 3.9 0 0 1 8.1 17.6C8.1 15.5 9.5 14.4 10.6 12.8C11.1 14.1 11.8 14.5 12.7 15.4C13.7 16.4 15.9 16.6 15.9 17.6A3.9 3.9 0 0 1 12 21.5Z";

function flameSvg(lit: boolean, dark: boolean): string {
  const t = dark ? darkTheme : lightTheme;
  const outer = lit ? String(t.colors.bakar) : String(t.colors.mutedForeground);
  const inner = lit ? String(t.colors.eatNear) : String(t.colors.muted);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${outer}" d="${FLAME_OUTER}"/><path fill="${inner}" d="${FLAME_INNER}"/></svg>`;
}

/**
 * Square streak tile: a flame with the number of days in a row (or, once the streak broke, a cold flame with the days
 * since the last log), and under it Joyo reacting to the state with one nudge line beside him. Every tap opens the scan
 * camera (the same deep link as the 1x1 camera tile), except signed out / no plan, which open the app.
 *
 * `today` is the phone's own day in the person's zone and `hour` the phone's local hour, so a stored snapshot ages by
 * itself (see streak-model): the day turns it from lit to at risk to broken, the hour moves Joyo's mood.
 */
export function StreakWidget({
  snapshot,
  dark,
  width,
  height,
}: {
  snapshot: WidgetSnapshot;
  dark: boolean;
  width: number;
  height: number;
}) {
  const t = dark ? darkTheme : lightTheme;
  const zone = snapshot.day?.zone;
  const model = streakWidgetModel(snapshot, dayIn(isDayZone(zone) ? zone : undefined), new Date().getHours());
  const art = MASCOT_ART[model.pose];
  const count = model.count;
  const label = model.labelKey ? i18n.t(model.labelKey) : "";
  const line = i18n.t(model.lineKey);
  const title = model.titleKey ? i18n.t(model.titleKey) : "";
  // "hari beruntun" is the flame and number's own meaning; only the broken count needs its unit spelled out.
  const showLabel = model.kind === "broken";
  const layout = streakTileLayout({
    width,
    height,
    digits: count === null ? 0 : String(count).length,
    hasLabel: showLabel,
    mascotAspect: art.width / art.height,
  });

  const surface =
    model.kind === "done" || model.kind === "at_risk"
      ? t.colors.bakarSoft
      : model.kind === "broken"
        ? t.colors.muted
        : t.colors.card;
  const live = model.kind !== "signedOut" && model.kind !== "noTarget";
  const spoken = [count === null ? title : String(count), label, line].filter(Boolean).join(". ");

  return (
    <FlexWidget
      clickAction={live ? "OPEN_URI" : "OPEN_APP"}
      clickActionData={live ? { uri: CAMERA_WIDGET_URI } : undefined}
      accessibilityLabel={spoken}
      style={{
        width: "match_parent",
        height: "match_parent",
        backgroundColor: surface,
        borderRadius: lightTheme.radius.card,
        padding: STREAK_PADDING,
        flexDirection: "column",
      }}
    >
      <FlexWidget
        style={{
          width: "match_parent",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 6,
        }}
      >
        {count === null ? (
          <TextWidget
            text={title}
            maxLines={2}
            style={{
              adjustsFontSizeToFit: true,
              width: "match_parent",
              textAlign: "center",
              fontFamily: FONT_HEAVY,
              fontSize: 20,
              lineHeight: STREAK_TITLE_LINE,
              color: t.colors.foreground,
            }}
          />
        ) : (
          // An array, not a fragment: the widget tree builder only walks widget elements.
          [
            <SvgWidget key="flame" svg={flameSvg(model.lit, dark)} style={{ width: layout.flame, height: layout.flame }} />,
            <TextWidget
              key="count"
              text={String(count)}
              allowFontScaling={false}
              style={{
                fontFamily: FONT_HEAVY,
                fontSize: layout.numberSize,
                lineHeight: layout.numberLine,
                color: model.lit ? t.colors.bakarText : t.colors.foreground,
                marginLeft: 3,
              }}
            />,
          ]
        )}
      </FlexWidget>
      <FlexWidget style={{ width: "match_parent", flex: 1, flexDirection: "row", alignItems: "center" }}>
        {layout.mascotHeight > 0 ? (
          <ImageWidget
            image={POSE_IMAGE[model.pose]}
            imageWidth={layout.mascotWidth}
            imageHeight={layout.mascotHeight}
            style={{ width: layout.mascotWidth, height: layout.mascotHeight }}
          />
        ) : null}
        <FlexWidget
          style={{
            flex: 1,
            flexDirection: "column",
            justifyContent: "center",
            marginLeft: layout.mascotHeight > 0 ? 6 : 0,
          }}
        >
          {showLabel ? (
            <TextWidget
              text={label}
              maxLines={2}
              style={{
                width: "match_parent",
                fontFamily: FONT_BOLD,
                fontSize: STREAK_CAPTION_SIZE,
                lineHeight: STREAK_CAPTION_LINE,
                color: t.colors.mutedForeground,
                marginBottom: 2,
              }}
            />
          ) : null}
          <TextWidget
            text={line}
            maxLines={layout.captionLines}
            style={{
              adjustsFontSizeToFit: true,
              width: "match_parent",
              textAlign: layout.mascotHeight > 0 ? "left" : "center",
              fontFamily: FONT_BOLD,
              fontSize: STREAK_CAPTION_SIZE,
              lineHeight: STREAK_CAPTION_LINE,
              color: t.colors.foreground,
            }}
          />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}
