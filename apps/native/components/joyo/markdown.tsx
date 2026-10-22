// Ported from JoyoFit (watch-fit) src/features/ai/ui/Markdown.tsx, adapted for JoyoRogo.
import { memo, useMemo, type ReactNode } from "react";
import { Linking, Platform, ScrollView, Text as RNText, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  parseMarkdown,
  type Align,
  type Block,
  type Inline,
  type ListItem,
} from "@joyorogo/api/lib/joyo-ai/markdown/parse";

import { Text } from "@/components/ui";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
const COLUMN_MIN = 72;
const COLUMN_MAX = 200;
/** Rough width of one small character, to size table columns without measuring. */
const CHAR_WIDTH = 7;

interface Ctx {
  muted: boolean;
  bold: string;
  link: string;
  codeBackground: string;
  hairline: string;
}

async function openLink(href: string): Promise<void> {
  try {
    await Linking.openURL(href);
  } catch {
    // An unopenable link does nothing, as in a browser with no handler.
  }
}

function plainLength(nodes: Inline[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.t === "text" || node.t === "code") total += node.s.length;
    else if (node.t === "br") total += 1;
    else total += plainLength(node.c);
  }
  return total;
}

function renderInline(nodes: Inline[], ctx: Ctx): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.t) {
      case "text":
        return node.s;
      case "br":
        return "\n";
      case "bold":
        return (
          <RNText key={i} style={{ fontFamily: ctx.bold }}>
            {renderInline(node.c, ctx)}
          </RNText>
        );
      case "italic":
        return (
          <RNText key={i} style={styles.italic}>
            {renderInline(node.c, ctx)}
          </RNText>
        );
      case "code":
        return (
          <RNText key={i} style={[styles.inlineCode, { backgroundColor: ctx.codeBackground }]}>
            {node.s}
          </RNText>
        );
      case "link":
        return (
          <RNText
            key={i}
            accessibilityRole="link"
            onPress={() => void openLink(node.href)}
            style={[styles.link, { color: ctx.link }]}
          >
            {renderInline(node.c, ctx)}
          </RNText>
        );
    }
  });
}

function Items({ items, ctx }: { items: ListItem[]; ctx: Ctx }) {
  const widest = Math.max(
    1,
    ...items.map((item) => (item.n === null ? 1 : String(item.n).length + 1)),
  );
  const markerWidth = widest >= 3 ? 28 : 20;
  return (
    <View style={styles.list}>
      {items.map((item, i) => (
        <View key={i} style={[styles.item, { paddingLeft: item.depth * 16 }]}>
          <Text
            style={[
              styles.body,
              styles.marker,
              { minWidth: markerWidth },
              ctx.muted && styles.muted,
            ]}
          >
            {item.n === null ? (item.depth === 0 ? "\u2022" : "\u25E6") : `${item.n}.`}
          </Text>
          <Text selectable style={[styles.body, styles.itemText, ctx.muted && styles.muted]}>
            {renderInline(item.c, ctx)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Table({
  head,
  rows,
  align,
  ctx,
}: {
  head: Inline[][];
  rows: Inline[][][];
  align: Align[];
  ctx: Ctx;
}) {
  const widths = head.map((cell, c) => {
    let longest = plainLength(cell);
    for (const row of rows) longest = Math.max(longest, plainLength(row[c] ?? []));
    return Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, longest * CHAR_WIDTH + 24));
  });
  const renderRow = (cells: Inline[][], header: boolean, key: number) => (
    <View
      key={key}
      style={[
        styles.row,
        !header && { borderTopColor: ctx.hairline, borderTopWidth: StyleSheet.hairlineWidth },
      ]}
    >
      {widths.map((width, c) => (
        <Text
          key={c}
          selectable
          style={[
            styles.cell,
            header && { fontFamily: ctx.bold },
            { width, textAlign: align[c] ?? "left" },
          ]}
        >
          {renderInline(cells[c] ?? [], ctx)}
        </Text>
      ))}
    </View>
  );
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      style={styles.scrollBox}
    >
      <View style={[styles.table, { backgroundColor: ctx.codeBackground }]}>
        {renderRow(head, true, -1)}
        {rows.map((row, r) => renderRow(row, false, r))}
      </View>
    </ScrollView>
  );
}

function CodeBlock({ text, ctx }: { text: string; ctx: Ctx }) {
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      style={[styles.scrollBox, styles.code, { backgroundColor: ctx.codeBackground }]}
      contentContainerStyle={styles.codeContent}
    >
      <Text selectable style={styles.codeText}>
        {text}
      </Text>
    </ScrollView>
  );
}

function Blocks({ blocks, ctx }: { blocks: Block[]; ctx: Ctx }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.t) {
          case "p":
            return (
              <Text key={i} selectable style={[styles.body, ctx.muted && styles.muted]}>
                {renderInline(block.c, ctx)}
              </Text>
            );
          case "h":
            return (
              <Text
                key={i}
                selectable
                accessibilityRole="header"
                style={[block.level === 3 ? styles.h3 : styles.h, i > 0 && styles.headingGap]}
              >
                {renderInline(block.c, ctx)}
              </Text>
            );
          case "ul":
          case "ol":
            return <Items key={i} items={block.items} ctx={ctx} />;
          case "code":
            return <CodeBlock key={i} text={block.text} ctx={ctx} />;
          case "quote":
            return (
              <View key={i} style={styles.quote}>
                <Blocks blocks={block.c} ctx={{ ...ctx, muted: true }} />
              </View>
            );
          case "table":
            return (
              <Table key={i} head={block.head} rows={block.rows} align={block.align} ctx={ctx} />
            );
          case "hr":
            return <View key={i} style={[styles.rule, { backgroundColor: ctx.hairline }]} />;
        }
      })}
    </>
  );
}

interface MarkdownProps {
  text: string;
  /** The answer is still arriving: an unclosed `**`, backtick or code fence renders as what it is so far. */
  streaming?: boolean;
}

/** An answer as native text: headings, lists, bold, code, compact tables, and links only to http(s) and mailto (the parser drops the rest). */
export const Markdown = memo(function Markdown({ text, streaming }: MarkdownProps) {
  const { theme } = useUnistyles();
  const blocks = useMemo(() => parseMarkdown(text, { streaming }), [text, streaming]);
  const ctx = useMemo<Ctx>(
    () => ({
      muted: false,
      bold: theme.fonts.bold,
      link: theme.colors.primary,
      codeBackground: theme.colors.muted,
      hairline: theme.colors.hairline,
    }),
    [theme],
  );
  return (
    <View style={styles.root}>
      <Blocks blocks={blocks} ctx={ctx} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.spacing.sm },
  body: { fontSize: theme.fontSize.base, lineHeight: 23, color: theme.colors.foreground },
  muted: { color: theme.colors.mutedForeground },
  h: {
    fontSize: theme.fontSize.lg,
    lineHeight: 25,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  h3: {
    fontSize: theme.fontSize.md,
    lineHeight: 23,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  headingGap: { marginTop: theme.spacing.xs },
  italic: { fontStyle: "italic" },
  inlineCode: { fontFamily: MONO, fontSize: theme.fontSize.sm },
  link: { textDecorationLine: "underline" },
  list: { gap: theme.spacing.xs },
  item: { flexDirection: "row", alignItems: "flex-start" },
  marker: { textAlign: "right", paddingRight: theme.spacing.sm, fontVariant: ["tabular-nums"] },
  itemText: { flex: 1 },
  quote: { gap: theme.spacing.sm, paddingLeft: theme.spacing.lg },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: theme.spacing.xs },
  scrollBox: { flexGrow: 0 },
  code: { borderRadius: theme.radius.input },
  codeContent: { padding: 10 },
  codeText: {
    fontFamily: MONO,
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.foreground,
  },
  table: { overflow: "hidden", borderRadius: theme.radius.input },
  row: { flexDirection: "row" },
  cell: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.foreground,
  },
}));
