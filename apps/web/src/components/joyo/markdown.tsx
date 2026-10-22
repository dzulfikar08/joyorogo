import { cn } from "@joyorogo/ui/lib/utils";
import { Fragment, memo, useMemo, type ReactNode } from "react";

import {
  parseMarkdown,
  type Align,
  type Block,
  type Inline,
  type ListItem,
} from "@joyorogo/api/lib/joyo-ai/markdown/parse";

import { safeHref } from "@/lib/joyo-chat";

const ALIGN: Record<NonNullable<Align>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

function renderInline(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.t) {
      case "text":
        return <Fragment key={i}>{node.s}</Fragment>;
      case "br":
        return <br key={i} />;
      case "bold":
        return <strong key={i}>{renderInline(node.c)}</strong>;
      case "italic":
        return <em key={i}>{renderInline(node.c)}</em>;
      case "code":
        return (
          <code key={i} className="rounded-md bg-muted px-1 py-0.5 font-mono text-[0.8125rem]">
            {node.s}
          </code>
        );
      case "link": {
        const href = safeHref(node.href);
        // The parser only emits http(s) and mailto links; anything else (a future change) is shown as plain text.
        if (href === null) return <Fragment key={i}>{renderInline(node.c)}</Fragment>;
        return (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="rounded-sm text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            {renderInline(node.c)}
          </a>
        );
      }
    }
  });
}

function Items({ items }: { items: readonly ListItem[] }) {
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2" style={{ paddingLeft: `${item.depth * 1.25}rem` }}>
          {item.n === null ? (
            <span aria-hidden className="w-4 shrink-0 text-center text-muted-foreground">
              {item.depth === 0 ? "\u2022" : "\u25E6"}
            </span>
          ) : (
            <span className="min-w-5 shrink-0 text-right text-muted-foreground tabular-nums">
              {item.n}.
            </span>
          )}
          <span className="min-w-0 flex-1">{renderInline(item.c)}</span>
        </li>
      ))}
    </ul>
  );
}

function Blocks({ blocks }: { blocks: readonly Block[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.t) {
          case "p":
            return <p key={i}>{renderInline(block.c)}</p>;
          case "h":
            return (
              <p
                key={i}
                role="heading"
                aria-level={block.level + 2}
                className={cn("font-bold tracking-tight", block.level < 3 && "text-base", i > 0 && "pt-1")}
              >
                {renderInline(block.c)}
              </p>
            );
          case "ul":
            return <Items key={i} items={block.items} />;
          case "ol":
            return <Items key={i} items={block.items} />;
          case "code":
            return (
              <pre
                key={i}
                tabIndex={0}
                className="overflow-x-auto rounded-xl bg-muted p-3 font-mono text-[0.8125rem] leading-relaxed focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <code>{block.text}</code>
              </pre>
            );
          case "quote":
            return (
              <div key={i} className="space-y-2 pl-4 text-muted-foreground">
                <Blocks blocks={block.c} />
              </div>
            );
          case "table":
            return (
              <div
                key={i}
                tabIndex={0}
                className="overflow-x-auto rounded-xl bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <table className="w-full border-collapse text-[0.8125rem] tabular-nums">
                  <thead>
                    <tr>
                      {block.head.map((cell, c) => (
                        <th
                          key={c}
                          scope="col"
                          className={cn(
                            "px-3 py-2 font-bold whitespace-nowrap",
                            ALIGN[block.align[c] ?? "left"],
                          )}
                        >
                          {renderInline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-t border-border/70">
                        {block.head.map((_, c) => (
                          <td key={c} className={cn("px-3 py-2", ALIGN[block.align[c] ?? "left"])}>
                            {renderInline(row[c] ?? [])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={i} className="border-border" />;
        }
      })}
    </>
  );
}

/**
 * A chat answer's markdown as React elements. The parser (shared with the phone app) returns plain data and only http(s)/mailto
 * links, so there is no HTML injection path here: text is rendered as text. `streaming` shows an unclosed `**` or code fence as
 * what it is so far.
 */
export const JoyoMarkdown = memo(function JoyoMarkdown({
  text,
  streaming,
  className,
}: {
  text: string;
  streaming?: boolean;
  className?: string;
}) {
  const blocks = useMemo(() => parseMarkdown(text, { streaming }), [text, streaming]);
  return (
    <div className={cn("space-y-2 text-[0.9375rem] leading-relaxed break-words", className)}>
      <Blocks blocks={blocks} />
    </div>
  );
});
