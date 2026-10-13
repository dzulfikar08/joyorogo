// "use no memo" — the widget task renderer walks these components outside
// React (react-native-android-widget buildWidgetTree), so react-compiler's
// useMemoCache hook has no dispatcher and crashes. Keep this first.
"use no memo";

import type { ReactNode } from "react";

import { FlexWidget, TextWidget } from "react-native-android-widget";
import type { ColorProp, WidgetInfo, WidgetRepresentation } from "react-native-android-widget";

import { eatTone } from "@joyorogo/api/lib/engine";

import { darkTheme, lightTheme } from "@/theme";
import { timeAgoId } from "@/src/lib/group";
import type { WidgetSnapshot } from "@/src/lib/widgets/snapshot";
import { fmtKcal } from "@/utils/format";

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
      ? `Jendela makan sampai ${fasting.windowClose} · sisa ${fmtKcal(fasting.remainingKcal)} kkal`
      : `Makan lagi ${fasting.windowOpen} · sisa ${fmtKcal(fasting.remainingKcal)} kkal`;
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
  const tone = eatTone(day.eatenKcal, day.eatKcal);
  const accent = tone === "over" ? c.over : tone === "near" ? c.near : c.ok;
  const over = day.eatenKcal > day.eatKcal;
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
      <Caption text="PROGRES HARI INI" c={c} />
      <FlexWidget style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 6 }}>
        <TextWidget
          text={over ? `+${fmtKcal(day.eatenKcal - day.eatKcal)}` : fmtKcal(day.eatKcal - day.eatenKcal)}
          style={{ fontSize: 30, fontFamily: FONT_HEAVY, color: accent, lineHeight: 34 }}
        />
        <TextWidget
          text={over ? " kkal lebih" : " kkal tersisa"}
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
        text={`${fmtKcal(day.eatenKcal)} / ${fmtKcal(day.eatKcal)} kkal`}
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
            <TextWidget text="PROTEIN" style={{ ...CAPTION, color: c.mutedForeground }} />
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
        text={poke ? "mencolek kamu" : (item.message ?? "mengirim catatan")}
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
        <Caption text="KOTAK MASUK" c={c} />
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
      {inbox.items.length === 0 ? (
        <TextWidget
          text="Belum ada kabar dari grupmu."
          style={{ fontSize: 12, fontFamily: FONT_MEDIUM, color: c.mutedForeground, marginTop: 10 }}
        />
      ) : (
        inbox.items.map((item) => <InboxRow key={item.id} item={item} c={c} />)
      )}
    </FlexWidget>
  );
}

/** Signed-out state, used by every widget when there is no session cookie. */
function SignedOutBody({ c }: { c: WidgetPalette }) {
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
      <TextWidget
        text="Masuk dulu"
        style={{ fontSize: 18, fontFamily: FONT_BOLD, color: c.foreground }}
      />
      <TextWidget
        text="Buka JoyoRogo untuk melihat progresmu di sini."
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
          <Caption text="PROGRES HARI INI" c={c} />
          <TextWidget
            text="Atur targetmu dulu di aplikasi."
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
          <Caption text="KOTAK MASUK" c={c} />
          <TextWidget
            text="Gabung grup dulu di aplikasi."
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
