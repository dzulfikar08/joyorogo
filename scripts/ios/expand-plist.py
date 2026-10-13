#!/usr/bin/env python3
"""Xcode's Info.plist preprocessing: expand $(VAR) / ${VAR} build settings.

Settings come from the environment (the build exports them like Xcode does).
Supports the :rfc1034identifier and :c99extidentifier modifiers Xcode
templates use. Writes a binary plist, as Xcode ships it.

    expand-plist.py <in.plist> <out.plist> [key=value ...]

Extra key=value pairs are merged into the top-level dict after expansion.
"""

import os
import plistlib
import re
import sys

VAR = re.compile(r"\$[({]([A-Za-z0-9_]+)(?::([A-Za-z0-9_]+))?[)}]")


def modify(value: str, mod: str | None) -> str:
    if mod == "rfc1034identifier":
        return re.sub(r"[^A-Za-z0-9.-]", "-", value)
    if mod == "c99extidentifier":
        return re.sub(r"[^A-Za-z0-9_]", "_", value)
    return value


def expand(node):
    if isinstance(node, str):
        return VAR.sub(lambda m: modify(os.environ.get(m.group(1), ""), m.group(2)), node)
    if isinstance(node, list):
        return [expand(item) for item in node]
    if isinstance(node, dict):
        return {key: expand(value) for key, value in node.items()}
    return node


def parse_value(raw: str):
    if raw in ("true", "false"):
        return raw == "true"
    return raw


def main() -> None:
    src, dst, *extra = sys.argv[1:]
    with open(src, "rb") as f:
        data = expand(plistlib.load(f))
    for pair in extra:
        key, _, value = pair.partition("=")
        data[key] = parse_value(value)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "wb") as f:
        plistlib.dump(data, f, fmt=plistlib.FMT_BINARY)


if __name__ == "__main__":
    main()
