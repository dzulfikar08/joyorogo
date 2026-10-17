// "use no memo" — the widget task renderer walks these components outside
// React (react-native-android-widget buildWidgetTree), so react-compiler's
// useMemoCache hook has no dispatcher and crashes. Keep this first.
"use no memo";

import type { ReactNode } from "react";

import { FlexWidget, SvgWidget, TextWidget } from "react-native-android-widget";
import type { ColorProp, WidgetInfo, WidgetRepresentation } from "react-native-android-widget";

import { eatTone } from "@joyorogo/api/lib/engine";
import { i18n } from "@joyorogo/i18n";

import { darkTheme, lightTheme } from "@/theme";
import { timeAgoId } from "@/src/lib/group";
import type { WidgetSnapshot } from "@/src/lib/widgets/snapshot";
import { fmtInt } from "@/utils/format";

/** Widget registry — names must match the config-plugin entries in app.json. */
export const WIDGET_NAMES = {
  ProgresHariIni: true,
  KotakMasukGrup: true,
  Ringkasan: true,
} as const;

export type WidgetName = keyof typeof WIDGET_NAMES;

// Basenames of the TTFs the config plugin copies into android assets
// (app.json -> react-native-android-widget fonts).
const FONT_MEDIUM = "PlusJakartaSans_500Medium";
const FONT_BOLD = "PlusJakartaSans_700Bold";
const FONT_HEAVY = "PlusJakartaSans_800ExtraBold";

const CARD_PADDING = 16;

/** Widget colors pinned from the app tokens (light/dark pair). */
export interface WidgetPalette {
  card: ColorProp;
  foreground: ColorProp;
  mutedForeground: ColorProp;
  track: ColorProp;
  ok: ColorProp;
  near: ColorProp;
  over: ColorProp;
  poke: ColorProp;
  note: ColorProp;
  pill: ColorProp;
  pillText: ColorProp;
}

function widgetPalette(dark: boolean): WidgetPalette {
  const t = dark ? darkTheme : lightTheme;
  return {
    card: t.colors.card,
    foreground: t.colors.foreground,
    mutedForeground: t.colors.mutedForeground,
    track: t.colors.muted,
    ok: t.colors.makan,
    near: t.colors.eatNear,
    over: t.colors.destructive,
    poke: t.colors.bakarText,
    note: t.colors.tidurText,
    pill: t.colors.makanSoft,
    pillText: t.colors.makanText,
  };
}

const CAPTION = { fontSize: 11, fontFamily: FONT_BOLD, letterSpacing: 0.8 } as const;

/**
 * MaterialCommunityIcons "food-drumstick" path (24x24), the same glyph as
 * MACRO_META.protein in utils/macro-icons. Widgets cannot render icon fonts,
 * so the path is drawn as an inline SVG in the makanText tone (the light/dark
 * pair already carried by the palette). The widget only shows protein.
 */
const DRUMSTICK_PATH =
  "M20.16 12.73C22.93 9.96 22.57 5.26 19.09 3C17.08 1.67 14.39 1.66 12.36 2.97C10.6 4.1 9.63 5.86 9.46 7.68C9.33 9 8.83 10.23 7.91 11.15L7.88 11.18C6.72 12.34 6.72 14.11 7.81 15.19L8.8 16.18C9.89 17.27 11.66 17.27 12.75 16.18C13.72 15.21 15 14.68 16.39 14.53C17.76 14.38 19.1 13.78 20.16 12.73M6.26 19.86C6.53 20.42 6.44 21.1 5.97 21.56C5.39 22.15 4.44 22.15 3.85 21.56C3.58 21.29 3.44 20.94 3.42 20.58C3.06 20.56 2.71 20.42 2.44 20.15C1.85 19.56 1.85 18.61 2.44 18.03C2.9 17.57 3.59 17.47 4.14 17.74L6.62 15.31C6.76 15.5 6.92 15.72 7.1 15.9L8.09 16.89C8.3 17.09 8.5 17.26 8.76 17.41L6.26 19.86Z";

function Caption({ text, c }: { text: string; c: WidgetPalette }) {
  return <TextWidget text={text} style={{ ...CAPTION, color: c.mutedForeground }} />;
}

function Bar({
  fraction,
  color,
  width,
  height,
  c,
}: {
  fraction: number;
  color: ColorProp;
  width: number;
  height: number;
  c: WidgetPalette;
}) {
  return (
    <FlexWidget
      style={{
        width: "match_parent",
        height,
        borderRadius: height / 2,
        backgroundColor: c.track,
        marginTop: 6,
      }}
    >
      {fraction > 0 ? (
        <FlexWidget
          style={{
            width: Math.max(height, Math.round(width * Math.min(1, fraction))),
            height,
            borderRadius: height / 2,
            backgroundColor: color,
          }}
        />
      ) : null}
    </FlexWidget>
  );
}

/**
 * One IF status line with absolute times only — widgets redraw every 30
 * minutes, so a countdown would sit stale between refreshes.
 */
function FastingLine({
  fasting,
  c,
}: {
  fasting: NonNullable<WidgetSnapshot["fasting"]>;
  c: WidgetPalette;
}) {
  const text =
    fasting.state === "jendela_makan"
      ? i18n.t("misc:widget.fasting.window", {
          close: fasting.windowClose,
          kcal: fmtInt(fasting.remainingKcal),
        })
      : i18n.t("misc:widget.fasting.next", {
          open: fasting.windowOpen,
          kcal: fmtInt(fasting.remainingKcal),
        });
  return (
    <FlexWidget style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}>
      <FlexWidget
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: fasting.state === "jendela_makan" ? c.ok : c.note,
        }}
      />
      <TextWidget
        text={text}
        maxLines={1}
        truncate="END"
        style={{
          fontSize: 12,
          fontFamily: FONT_MEDIUM,
          color: c.mutedForeground,
          marginLeft: 8,
        }}
      />
    </FlexWidget>
  );
}

/** "Progres hari ini" body: remaining kcal, eat bar, protein bar. */
function ProgressPanel({
  day,
  fasting,
  c,
  contentWidth,
}: {
  day: NonNullable<WidgetSnapshot["day"]>;
  fasting: WidgetSnapshot["fasting"];
  c: WidgetPalette;
  contentWidth: number;
}) {
  const maternal = day.maternal === true;
  // Hamil / Menyusui: neutral ring, the number is what was eaten (no left/over).
  const tone = maternal ? "ok" : eatTone(day.eatenKcal, day.eatKcal);
  const accent = tone === "over" ? c.over : tone === "near" ? c.near : c.ok;
  const over = !maternal && day.eatenKcal > day.eatKcal;
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
      <Caption text={i18n.t("misc:widget.progress")} c={c} />
      <FlexWidget style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 6 }}>
        <TextWidget
          text={
            maternal
              ? fmtInt(day.eatenKcal)
              : over
                ? `+${fmtInt(day.eatenKcal - day.eatKcal)}`
                : fmtInt(day.eatKcal - day.eatenKcal)
          }
          style={{ fontSize: 30, fontFamily: FONT_HEAVY, color: accent, lineHeight: 34 }}
        />
        <TextWidget
          text={
            maternal
              ? i18n.t("maternal:target.eaten")
              : over
                ? i18n.t("misc:widget.over")
                : i18n.t("misc:widget.left")
          }
          style={{ fontSize: 12, fontFamily: FONT_MEDIUM, color: c.mutedForeground, marginLeft: 6, marginBottom: 5 }}
        />
      </FlexWidget>
      <Bar
        fraction={day.eatKcal > 0 ? day.eatenKcal / day.eatKcal : 0}
        color={accent}
        width={contentWidth}
        height={6}
        c={c}
      />
      <TextWidget
        text={i18n.t("misc:widget.eaten", {
          eaten: fmtInt(day.eatenKcal),
          target: fmtInt(day.eatKcal),
        })}
        style={{ fontSize: 12, fontFamily: FONT_MEDIUM, color: c.mutedForeground, marginTop: 6 }}
      />
      {fasting ? <FastingLine fasting={fasting} c={c} /> : null}
      {day.proteinTargetG ? (
        <FlexWidget
          style={{
            flexDirection: "column",
            width: "match_parent",
            marginTop: 14,
          }}
        >
          <FlexWidget
            style={{
              flexDirection: "row",
              width: "match_parent",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <FlexWidget style={{ flexDirection: "row", alignItems: "center" }}>
              <SvgWidget
                svg={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${String(c.pillText)}" d="${DRUMSTICK_PATH}"/></svg>`}
                style={{ width: 14, height: 14, marginRight: 6 }}
              />
              <TextWidget text={i18n.t("misc:widget.protein")} style={{ ...CAPTION, color: c.mutedForeground }} />
            </FlexWidget>
            <TextWidget
              text={`${day.proteinEatenG ?? 0} / ${day.proteinTargetG} g`}
              style={{ fontSize: 12, fontFamily: FONT_BOLD, color: c.foreground }}
            />
          </FlexWidget>
          <Bar
            fraction={day.proteinTargetG > 0 ? (day.proteinEatenG ?? 0) / day.proteinTargetG : 0}
            color={c.ok}
            width={contentWidth}
            height={4}
            c={c}
          />
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

function InboxRow({
  item,
  c,
}: {
  item: NonNullable<WidgetSnapshot["inbox"]>["items"][number];
  c: WidgetPalette;
}) {
  const poke = item.kind === "poke";
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent", marginTop: 10 }}>
      <FlexWidget
        style={{
          flexDirection: "row",
          width: "match_parent",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <FlexWidget style={{ flexDirection: "row", alignItems: "center" }}>
          <FlexWidget
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: poke ? c.poke : c.note,
            }}
          />
          <TextWidget
            text={item.senderName}
            style={{ fontSize: 13, fontFamily: FONT_BOLD, color: c.foreground, marginLeft: 8 }}
          />
        </FlexWidget>
        <TextWidget
          text={timeAgoId(item.createdAt)}
          style={{ fontSize: 11, fontFamily: FONT_MEDIUM, color: c.mutedForeground }}
        />
      </FlexWidget>
      <TextWidget
        text={
          poke
            ? i18n.t("misc:inbox.item.pokeSubtitle")
            : (item.message ?? i18n.t("misc:inbox.item.noteSubtitle"))
        }
        maxLines={1}
        truncate="END"
        style={{
          fontSize: 12,
          fontFamily: FONT_MEDIUM,
          color: c.mutedForeground,
          marginLeft: 16,
          marginTop: 2,
        }}
      />
    </FlexWidget>
  );
}

/** "Kotak masuk grup" body: unread pill + latest nudges. */
function InboxPanel({
  inbox,
  c,
}: {
  inbox: NonNullable<WidgetSnapshot["inbox"]>;
  c: WidgetPalette;
}) {
  const unreadItems = inbox.items.filter((item) => item.readAt === null);
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
      <FlexWidget
        style={{
          flexDirection: "row",
          width: "match_parent",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Caption text={i18n.t("misc:widget.inbox")} c={c} />
        {inbox.unread > 0 ? (
          <FlexWidget
            style={{
              backgroundColor: c.pill,
              borderRadius: 999,
              paddingLeft: 8,
              paddingRight: 8,
              paddingTop: 2,
              paddingBottom: 2,
            }}
          >
            <TextWidget
              text={String(inbox.unread)}
              style={{ fontSize: 11, fontFamily: FONT_BOLD, color: c.pillText }}
            />
          </FlexWidget>
        ) : null}
      </FlexWidget>
      {unreadItems.length === 0 ? (
        <FlexWidget
          style={{
            flexDirection: "row",
            alignItems: "center",
            width: "match_parent",
            marginTop: 10,
          }}
        >
          <FlexWidget
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: c.pill,
              alignItems: "center",
              justifyContent: "center",
              marginRight: 10,
            }}
          >
            <SvgWidget
              svg={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${String(c.pillText)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`}
              style={{ width: 18, height: 18 }}
            />
          </FlexWidget>
          <TextWidget
            text={i18n.t("misc:widget.noNews")}
            style={{ fontSize: 12, fontFamily: FONT_MEDIUM, color: c.mutedForeground }}
          />
        </FlexWidget>
      ) : (
        unreadItems.map((item) => <InboxRow key={item.id} item={item} c={c} />)
      )}
    </FlexWidget>
  );
}

/** Signed-out state, used by every widget when there is no session cookie. */
function SignedOutBody({ c }: { c: WidgetPalette }) {
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
      <TextWidget
        text={i18n.t("misc:widget.signIn")}
        style={{ fontSize: 18, fontFamily: FONT_BOLD, color: c.foreground }}
      />
      <TextWidget
        text={i18n.t("misc:widget.signInBody")}
        style={{ fontSize: 12, fontFamily: FONT_MEDIUM, color: c.mutedForeground, marginTop: 6 }}
      />
    </FlexWidget>
  );
}

function WidgetCard({
  c,
  clickAction,
  clickActionData,
  children,
}: {
  c: WidgetPalette;
  clickAction?: string;
  clickActionData?: Record<string, unknown>;
  children: ReactNode;
}) {
  return (
    <FlexWidget
      clickAction={clickAction}
      clickActionData={clickActionData}
      style={{
        width: "match_parent",
        height: "match_parent",
        backgroundColor: c.card,
        borderRadius: lightTheme.radius.card,
        padding: CARD_PADDING,
        flexDirection: "column",
      }}
    >
      {children}
    </FlexWidget>
  );
}

function ProgressWidget({ snapshot, c, width }: { snapshot: WidgetSnapshot; c: WidgetPalette; width: number }) {
  return (
    <WidgetCard c={c} clickAction="OPEN_APP">
      {snapshot.signedIn && snapshot.day ? (
        <ProgressPanel day={snapshot.day} fasting={snapshot.fasting} c={c} contentWidth={width - CARD_PADDING * 2} />
      ) : snapshot.signedIn ? (
        <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
          <Caption text={i18n.t("misc:widget.progress")} c={c} />
          <TextWidget
            text={i18n.t("misc:widget.setTarget")}
            style={{ fontSize: 12, fontFamily: FONT_MEDIUM, color: c.mutedForeground, marginTop: 10 }}
          />
        </FlexWidget>
      ) : (
        <SignedOutBody c={c} />
      )}
    </WidgetCard>
  );
}

function InboxWidget({ snapshot, c }: { snapshot: WidgetSnapshot; c: WidgetPalette }) {
  return (
    <WidgetCard c={c} clickAction="OPEN_URI" clickActionData={{ uri: "joyorogo://inbox" }}>
      {snapshot.signedIn && snapshot.inbox ? (
        <InboxPanel inbox={snapshot.inbox} c={c} />
      ) : snapshot.signedIn ? (
        <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
          <Caption text={i18n.t("misc:widget.inbox")} c={c} />
          <TextWidget
            text={i18n.t("misc:widget.joinGroup")}
            style={{ fontSize: 12, fontFamily: FONT_MEDIUM, color: c.mutedForeground, marginTop: 10 }}
          />
        </FlexWidget>
      ) : (
        <SignedOutBody c={c} />
      )}
    </WidgetCard>
  );
}

/** Combined 4x2 widget: progress left, inbox right, each half taps its screen. */
function RingkasanWidget({ snapshot, c, width }: { snapshot: WidgetSnapshot; c: WidgetPalette; width: number }) {
  const halfWidth = Math.round((width - 1) / 2);
  const panelWidth = halfWidth - CARD_PADDING * 2;
  const light = (
    <FlexWidget
      style={{
        width: "match_parent",
        height: "match_parent",
        backgroundColor: c.card,
        borderRadius: lightTheme.radius.card,
        flexDirection: "row",
      }}
    >
      <FlexWidget
        clickAction="OPEN_APP"
        style={{
          width: halfWidth,
          height: "match_parent",
          padding: CARD_PADDING,
          flexDirection: "column",
        }}
      >
        {snapshot.signedIn && snapshot.day ? (
          <ProgressPanel day={snapshot.day} fasting={snapshot.fasting} c={c} contentWidth={panelWidth} />
        ) : (
          <SignedOutBody c={c} />
        )}
      </FlexWidget>
      <FlexWidget
        style={{ width: 1, height: "match_parent", backgroundColor: c.track, marginTop: 12, marginBottom: 12 }}
      />
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: "joyorogo://inbox" }}
        style={{
          width: halfWidth,
          height: "match_parent",
          padding: CARD_PADDING,
          flexDirection: "column",
        }}
      >
        {snapshot.signedIn && snapshot.inbox ? <InboxPanel inbox={snapshot.inbox} c={c} /> : <SignedOutBody c={c} />}
      </FlexWidget>
    </FlexWidget>
  );
  return light;
}

function buildElement(name: WidgetName, snapshot: WidgetSnapshot, dark: boolean, width: number) {
  const c = widgetPalette(dark);
  switch (name) {
    case "ProgresHariIni":
      return <ProgressWidget snapshot={snapshot} c={c} width={width} />;
    case "KotakMasukGrup":
      return <InboxWidget snapshot={snapshot} c={c} />;
    case "Ringkasan":
      return <RingkasanWidget snapshot={snapshot} c={c} width={width} />;
  }
}

/**
 * Light/dark widget element for one widget name, built from the shared
 * snapshot. The launcher picks the variant matching the system theme.
 * Unknown names (runtime strings from the task handler) return null.
 */
export function buildWidgetElement(
  name: WidgetName,
  snapshot: WidgetSnapshot,
  info: Pick<WidgetInfo, "width">,
): WidgetRepresentation;
export function buildWidgetElement(
  name: string,
  snapshot: WidgetSnapshot,
  info: Pick<WidgetInfo, "width">,
): WidgetRepresentation | null;
export function buildWidgetElement(
  name: string,
  snapshot: WidgetSnapshot,
  info: Pick<WidgetInfo, "width">,
): WidgetRepresentation | null {
  if (!(name in WIDGET_NAMES)) return null;
  const widget = name as WidgetName;
  const width = info.width > 0 ? info.width : 220;
  return {
    light: buildElement(widget, snapshot, false, width),
    dark: buildElement(widget, snapshot, true, width),
  };
}
