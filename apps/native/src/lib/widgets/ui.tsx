// "use no memo" — the widget task renderer walks these components outside
// React (react-native-android-widget buildWidgetTree), so react-compiler's
// useMemoCache hook has no dispatcher and crashes. Keep this first.
"use no memo";

import type { ReactNode } from "react";

import { FlexWidget, SvgWidget, TextWidget } from "react-native-android-widget";
import type { ColorProp, WidgetInfo, WidgetRepresentation } from "react-native-android-widget";

import { eatTone } from "@joyorogo/api/lib/engine";
import { gainEatTone, gainRemaining } from "@joyorogo/api/lib/gain";
import { i18n } from "@joyorogo/i18n";

import { darkTheme, lightTheme } from "@/theme";
import { timeAgoId } from "@/src/lib/group";
import type { WidgetSnapshot } from "@/src/lib/widgets/snapshot";
import { fmtInt } from "@/utils/format";

import { CAMERA_WIDGET_URI, INBOX_WIDGET_URI, PROGRESS_WIDGET_URI, WIDGET_NAMES } from "@/src/lib/widgets/names";
import type { WidgetName } from "@/src/lib/widgets/names";
import { CARD_PADDING, DEFAULT_WIDGET_HEIGHT, cameraTileLayout, inboxRowCount, progressRows, staleAgo } from "@/src/lib/widgets/layout";

export { WIDGET_NAMES };
export type { WidgetName };

// Basenames of the TTFs the config plugin copies into android assets
// (app.json -> react-native-android-widget fonts).
const FONT_MEDIUM = "PlusJakartaSans_500Medium";
const FONT_BOLD = "PlusJakartaSans_700Bold";
const FONT_HEAVY = "PlusJakartaSans_800ExtraBold";

/** Widget colors pinned from the app tokens (light/dark pair). */
export interface WidgetPalette {
  card: ColorProp;
  foreground: ColorProp;
  mutedForeground: ColorProp;
  track: ColorProp;
  ok: ColorProp;
  near: ColorProp;
  over: ColorProp;
  /** Readable text shades of near/over (the bar colors fail contrast as text on the light card). */
  nearText: ColorProp;
  overText: ColorProp;
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
    over: t.colors.destructiveText,
    nearText: t.colors.kcalText,
    overText: t.colors.destructiveText,
    poke: t.colors.bakarText,
    note: t.colors.tidurText,
    pill: t.colors.makanSoft,
    pillText: t.colors.makanText,
  };
}

const CAPTION = { fontSize: 11, lineHeight: 13, fontFamily: FONT_BOLD, letterSpacing: 0.8 } as const;
/** One 12 sp muted line; the explicit lineHeight keeps row heights predictable (see layout.ts). */
const NOTE = { fontSize: 12, lineHeight: 15, fontFamily: FONT_MEDIUM } as const;

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

/** One muted status row: a leading dot (state color) or none, then a single truncated line. */
function NoteLine({ text, dot, c }: { text: string; dot?: ColorProp; c: WidgetPalette }) {
  return (
    <FlexWidget style={{ flexDirection: "row", alignItems: "center", width: "match_parent", marginTop: 4 }}>
      {dot ? (
        <FlexWidget style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot, marginRight: 8 }} />
      ) : null}
      <TextWidget text={text} maxLines={1} truncate="END" style={{ ...NOTE, color: c.mutedForeground }} />
    </FlexWidget>
  );
}

/**
 * One IF status line with absolute times only — widgets redraw every 30
 * minutes, so a countdown would sit stale between refreshes. The kcal still
 * to eat is the big number above, so it is not repeated here.
 */
function FastingLine({
  fasting,
  c,
}: {
  fasting: NonNullable<WidgetSnapshot["fasting"]>;
  c: WidgetPalette;
}) {
  const window = fasting.state === "jendela_makan";
  const text = window
    ? i18n.t("misc:widget.fasting.window", { close: fasting.windowClose })
    : i18n.t("misc:widget.fasting.next", { open: fasting.windowOpen });
  return <NoteLine text={text} dot={window ? c.ok : c.note} c={c} />;
}

/** "Progres hari ini" body: remaining kcal, eat bar, then the rows that still fit the height. */
function ProgressPanel({
  day,
  fasting,
  updatedAt,
  c,
  contentWidth,
  height,
}: {
  day: NonNullable<WidgetSnapshot["day"]>;
  fasting: WidgetSnapshot["fasting"];
  updatedAt: number;
  c: WidgetPalette;
  contentWidth: number;
  height: number;
}) {
  const maternal = day.maternal === true;
  // Naikin BB: the line says what is still to eat; the ring is never red.
  const gain = !maternal && day.gain === true;
  // Hamil / Menyusui: neutral ring, the number is what was eaten (no left/over).
  const tone = maternal
    ? "ok"
    : gain
      ? gainEatTone(day.eatenKcal, day.eatKcal)
      : eatTone(day.eatenKcal, day.eatKcal);
  const accent = tone === "over" ? c.over : tone === "near" ? c.near : c.ok;
  const accentText = tone === "over" ? c.overText : tone === "near" ? c.nearText : c.ok;
  const over = !maternal && !gain && day.eatenKcal > day.eatKcal;
  const remaining = gain ? gainRemaining(day.eatKcal, day.eatenKcal) : null;
  const ago = staleAgo(updatedAt);
  const rows = progressRows({
    height,
    contentWidth,
    hasFasting: fasting !== null,
    hasProtein: Boolean(day.proteinTargetG),
    isStale: ago !== null,
  });
  const number = maternal
    ? fmtInt(day.eatenKcal)
    : over
      ? `+${fmtInt(day.eatenKcal - day.eatKcal)}`
      : fmtInt(day.eatKcal - day.eatenKcal);
  const unit = maternal
    ? i18n.t("maternal:target.eaten")
    : over
      ? i18n.t("misc:widget.over")
      : i18n.t("misc:widget.left");
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
      <Caption text={i18n.t("misc:widget.progress")} c={c} />
      {remaining ? (
        <TextWidget
          text={i18n.t(`gain:today.${remaining.state}`, { kcal: fmtInt(remaining.kcal) })}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 20, fontFamily: FONT_HEAVY, color: accentText, lineHeight: 32, marginTop: 4 }}
        />
      ) : (
        <FlexWidget
          style={{
            flexDirection: rows.stacked ? "column" : "row",
            alignItems: rows.stacked ? "flex-start" : "flex-end",
            marginTop: 4,
          }}
        >
          <TextWidget
            text={number}
            style={{ fontSize: 28, fontFamily: FONT_HEAVY, color: accentText, lineHeight: 32 }}
          />
          <TextWidget
            text={unit}
            maxLines={1}
            style={{
              ...NOTE,
              color: c.mutedForeground,
              marginLeft: rows.stacked ? 0 : 6,
              marginBottom: rows.stacked ? 0 : 4,
            }}
          />
        </FlexWidget>
      )}
      <Bar
        fraction={day.eatKcal > 0 ? day.eatenKcal / day.eatKcal : 0}
        color={accent}
        width={contentWidth}
        height={6}
        c={c}
      />
      {rows.eaten ? (
        <TextWidget
          text={i18n.t("misc:widget.eaten", {
            eaten: fmtInt(day.eatenKcal),
            target: fmtInt(day.eatKcal),
          })}
          maxLines={1}
          truncate="END"
          style={{ ...NOTE, color: c.mutedForeground, marginTop: 4 }}
        />
      ) : null}
      {rows.stale && ago ? (
        <NoteLine text={i18n.t("misc:widget.updated", { ago })} c={c} />
      ) : null}
      {rows.fasting && fasting ? <FastingLine fasting={fasting} c={c} /> : null}
      {rows.protein && day.proteinTargetG ? (
        <FlexWidget style={{ flexDirection: "column", width: "match_parent", marginTop: 8 }}>
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
              style={{ ...NOTE, fontFamily: FONT_BOLD, color: c.foreground }}
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
  // Age first: the message is the part that may be cut off at the edge.
  const detail = poke
    ? i18n.t("misc:inbox.item.pokeSubtitle")
    : (item.message ?? i18n.t("misc:inbox.item.noteSubtitle"));
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent", marginTop: 8 }}>
      <FlexWidget style={{ flexDirection: "row", alignItems: "center", width: "match_parent" }}>
        <FlexWidget
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: poke ? c.poke : c.note,
            marginRight: 8,
          }}
        />
        <TextWidget
          text={item.senderName}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 13, lineHeight: 17, fontFamily: FONT_BOLD, color: c.foreground }}
        />
      </FlexWidget>
      <TextWidget
        text={`${timeAgoId(item.createdAt)} · ${detail}`}
        maxLines={1}
        truncate="END"
        style={{ ...NOTE, color: c.mutedForeground, marginLeft: 16 }}
      />
    </FlexWidget>
  );
}

/** "Kotak masuk grup" body: unread pill + as many latest nudges as fit the height. */
function InboxPanel({
  inbox,
  updatedAt,
  c,
  height,
}: {
  inbox: NonNullable<WidgetSnapshot["inbox"]>;
  updatedAt: number;
  c: WidgetPalette;
  height: number;
}) {
  const unreadItems = inbox.items.filter((item) => item.readAt === null);
  const ago = staleAgo(updatedAt);
  const shown = unreadItems.slice(0, inboxRowCount(height, inbox.unread, ago !== null));
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
              paddingTop: 1,
              paddingBottom: 1,
            }}
          >
            <TextWidget
              text={String(inbox.unread)}
              style={{ fontSize: 11, lineHeight: 14, fontFamily: FONT_BOLD, color: c.pillText }}
            />
          </FlexWidget>
        ) : null}
      </FlexWidget>
      {shown.length === 0 ? (
        <FlexWidget
          style={{
            flexDirection: "row",
            alignItems: "center",
            width: "match_parent",
            marginTop: 8,
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
            maxLines={2}
            truncate="END"
            style={{ ...NOTE, color: c.mutedForeground }}
          />
        </FlexWidget>
      ) : (
        shown.map((item) => <InboxRow key={item.id} item={item} c={c} />)
      )}
      {ago ? <NoteLine text={i18n.t("misc:widget.updated", { ago })} c={c} /> : null}
    </FlexWidget>
  );
}

/** A panel's caption with one muted line under it: the signed-in-but-empty states. */
function EmptyBody({ caption, text, c }: { caption: string; text: string; c: WidgetPalette }) {
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
      <Caption text={caption} c={c} />
      <TextWidget text={text} style={{ ...NOTE, color: c.mutedForeground, marginTop: 8 }} />
    </FlexWidget>
  );
}

/** Signed-out state, used by every widget when there is no session cookie. */
function SignedOutBody({ caption, c }: { caption?: string; c: WidgetPalette }) {
  return (
    <FlexWidget style={{ flexDirection: "column", width: "match_parent" }}>
      {caption ? <Caption text={caption} c={c} /> : null}
      <TextWidget
        text={i18n.t("misc:widget.signIn")}
        style={{ fontSize: 18, lineHeight: 24, fontFamily: FONT_BOLD, color: c.foreground, marginTop: caption ? 8 : 0 }}
      />
      <TextWidget
        text={i18n.t("misc:widget.signInBody")}
        style={{ ...NOTE, color: c.mutedForeground, marginTop: 4 }}
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

interface Size {
  width: number;
  height: number;
}

/** Progress panel for a snapshot, or the empty / signed-out body that explains what is missing. */
function ProgressSection({ snapshot, c, width, height }: { snapshot: WidgetSnapshot } & Size & { c: WidgetPalette }) {
  if (!snapshot.signedIn) return <SignedOutBody caption={i18n.t("misc:widget.progress")} c={c} />;
  if (!snapshot.day) {
    return <EmptyBody caption={i18n.t("misc:widget.progress")} text={i18n.t("misc:widget.setTarget")} c={c} />;
  }
  return (
    <ProgressPanel
      day={snapshot.day}
      fasting={snapshot.fasting}
      updatedAt={snapshot.updatedAt}
      c={c}
      contentWidth={width - CARD_PADDING * 2}
      height={height}
    />
  );
}

function InboxSection({ snapshot, c, height }: { snapshot: WidgetSnapshot; c: WidgetPalette; height: number }) {
  if (!snapshot.signedIn) return <SignedOutBody caption={i18n.t("misc:widget.inbox")} c={c} />;
  if (!snapshot.inbox) {
    return <EmptyBody caption={i18n.t("misc:widget.inbox")} text={i18n.t("misc:widget.joinGroup")} c={c} />;
  }
  return <InboxPanel inbox={snapshot.inbox} updatedAt={snapshot.updatedAt} c={c} height={height} />;
}

/** Signed in: tapping opens today's diary (kcal and protein eaten); otherwise the app opens to sign in or set a target. */
function ProgressWidget({ snapshot, c, width, height }: { snapshot: WidgetSnapshot; c: WidgetPalette } & Size) {
  const live = snapshot.signedIn && snapshot.day !== null;
  return (
    <WidgetCard
      c={c}
      clickAction={live ? "OPEN_URI" : "OPEN_APP"}
      clickActionData={live ? { uri: PROGRESS_WIDGET_URI } : undefined}
    >
      <ProgressSection snapshot={snapshot} c={c} width={width} height={height} />
    </WidgetCard>
  );
}

function InboxWidget({ snapshot, c, height }: { snapshot: WidgetSnapshot; c: WidgetPalette; height: number }) {
  const live = snapshot.signedIn && snapshot.inbox !== null;
  return (
    <WidgetCard
      c={c}
      clickAction={live ? "OPEN_URI" : "OPEN_APP"}
      clickActionData={live ? { uri: INBOX_WIDGET_URI } : undefined}
    >
      <InboxSection snapshot={snapshot} c={c} height={height} />
    </WidgetCard>
  );
}

/**
 * Combined 4x2 widget: progress left, inbox right, each half taps its screen.
 * Signed out there is nothing to split, so one body covers the card.
 */
function RingkasanWidget({ snapshot, c, width, height }: { snapshot: WidgetSnapshot; c: WidgetPalette } & Size) {
  if (!snapshot.signedIn) {
    return (
      <WidgetCard c={c} clickAction="OPEN_APP">
        <SignedOutBody c={c} />
      </WidgetCard>
    );
  }
  const halfWidth = Math.round((width - 1) / 2);
  const half = {
    width: halfWidth,
    height: "match_parent",
    padding: CARD_PADDING,
    flexDirection: "column",
  } as const;
  return (
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
        clickAction={snapshot.day ? "OPEN_URI" : "OPEN_APP"}
        clickActionData={snapshot.day ? { uri: PROGRESS_WIDGET_URI } : undefined}
        style={half}
      >
        <ProgressSection snapshot={snapshot} c={c} width={halfWidth} height={height} />
      </FlexWidget>
      <FlexWidget
        style={{ width: 1, height: "match_parent", backgroundColor: c.track, marginTop: 12, marginBottom: 12 }}
      />
      <FlexWidget
        clickAction={snapshot.inbox ? "OPEN_URI" : "OPEN_APP"}
        clickActionData={snapshot.inbox ? { uri: INBOX_WIDGET_URI } : undefined}
        style={half}
      >
        <InboxSection snapshot={snapshot} c={c} height={height} />
      </FlexWidget>
    </FlexWidget>
  );
}

/** Camera body (lucide "camera" outline, 24x24); fork and knife in the lens position say what it scans. */
const CAMERA_BODY_PATH = "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z";
const CUTLERY_PATH = "M9 9.8v2a1.5 1.5 0 0 0 3 0v-2M10.5 13.3v4.2M15 17.5v-7.7c1.4.5 2 1.8 2 3.4h-2";

/**
 * 1x1 shortcut: a brand-colored rounded tile with a camera-and-bowl glyph and a
 * short label. Static (no snapshot data); a tap opens the scan camera through
 * the deep link, which covers cold and warm start and sends signed-out users
 * through /login. Sizes follow the launcher cell (see cameraTileLayout).
 */
function CameraWidget({ dark, width, height }: { dark: boolean } & Size) {
  const t = dark ? darkTheme : lightTheme;
  const stroke = String(t.colors.primaryForeground);
  const label = i18n.t("misc:widget.photoCta");
  const layout = cameraTileLayout(label, Math.min(width, height));
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: CAMERA_WIDGET_URI }}
      accessibilityLabel={i18n.t("misc:widget.photoLabel")}
      style={{
        width: "match_parent",
        height: "match_parent",
        backgroundColor: t.colors.primary,
        borderRadius: layout.radius,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <SvgWidget
        svg={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${CAMERA_BODY_PATH}"/><path stroke-width="1.6" d="${CUTLERY_PATH}"/></svg>`}
        style={{ width: layout.icon, height: layout.icon }}
      />
      <TextWidget
        text={label}
        maxLines={layout.singleLine ? 1 : 2}
        style={{
          adjustsFontSizeToFit: true,
          width: "match_parent",
          textAlign: "center",
          fontFamily: FONT_HEAVY,
          fontSize: layout.fontSize,
          lineHeight: layout.lineHeight,
          color: t.colors.primaryForeground,
          marginTop: 2,
        }}
      />
    </FlexWidget>
  );
}

function buildElement(name: WidgetName, snapshot: WidgetSnapshot, dark: boolean, size: Size) {
  const c = widgetPalette(dark);
  switch (name) {
    case "ProgresHariIni":
      return <ProgressWidget snapshot={snapshot} c={c} {...size} />;
    case "KotakMasukGrup":
      return <InboxWidget snapshot={snapshot} c={c} height={size.height} />;
    case "Ringkasan":
      return <RingkasanWidget snapshot={snapshot} c={c} {...size} />;
    case "FotoMakanan":
      return <CameraWidget dark={dark} {...size} />;
  }
}

/**
 * Light/dark widget element for one widget name, built from the shared
 * snapshot. The launcher picks the variant matching the system theme.
 * Unknown names (runtime strings from the task handler) return null.
 * `info` is the launcher-reported size in dp; a missing one falls back to a
 * mid-size widget (see layout.ts).
 */
export function buildWidgetElement(
  name: WidgetName,
  snapshot: WidgetSnapshot,
  info: Pick<WidgetInfo, "width" | "height">,
): WidgetRepresentation;
export function buildWidgetElement(
  name: string,
  snapshot: WidgetSnapshot,
  info: Pick<WidgetInfo, "width" | "height">,
): WidgetRepresentation | null;
export function buildWidgetElement(
  name: string,
  snapshot: WidgetSnapshot,
  info: Pick<WidgetInfo, "width" | "height">,
): WidgetRepresentation | null {
  if (!(name in WIDGET_NAMES)) return null;
  const widget = name as WidgetName;
  const size = { width: info.width > 0 ? info.width : 220, height: info.height > 0 ? info.height : DEFAULT_WIDGET_HEIGHT };
  return {
    light: buildElement(widget, snapshot, false, size),
    dark: buildElement(widget, snapshot, true, size),
  };
}
