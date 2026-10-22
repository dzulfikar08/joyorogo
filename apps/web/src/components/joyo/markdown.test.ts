import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { JoyoMarkdown } from "./markdown";

const html = (text: string, streaming = false) => renderToStaticMarkup(createElement(JoyoMarkdown, { text, streaming }));

describe("JoyoMarkdown", () => {
  test("text is text: markup in the answer is escaped, never HTML", () => {
    const out = html("<img src=x onerror=alert(1)> and <script>alert(1)</script>");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
  });

  test("only http(s) and mailto links become anchors, with a safe rel", () => {
    const out = html("[a](https://joyorogo.com) [b](javascript:alert(1)) [c](data:text/html,x) [d](mailto:a@b.test)");
    expect(out).toContain('href="https://joyorogo.com"');
    expect(out).toContain('href="mailto:a@b.test"');
    // The refused ones stay literal text, not anchors.
    expect(out).not.toContain('href="javascript');
    expect(out).not.toContain('href="data');
    expect(out.match(/<a /g)).toHaveLength(2);
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
  });

  test("lists, tables and code render as structure", () => {
    const out = html("- satu\n- dua\n\n| Makanan | Serat |\n| --- | ---: |\n| Pepaya | 1,7 |\n\n```\nx < y\n```");
    expect(out).toContain("satu");
    expect(out).toContain("<table");
    expect(out).toContain('scope="col"');
    expect(out).toContain("text-right");
    expect(out).toContain("<pre");
    expect(out).toContain("x &lt; y");
  });

  test("a half-written bold is shown as bold while streaming", () => {
    expect(html("Serat **tinggi", true)).toContain("<strong>tinggi</strong>");
    expect(html("Serat **tinggi", false)).not.toContain("<strong>");
  });
});
