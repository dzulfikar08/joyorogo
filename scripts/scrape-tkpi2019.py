#!/usr/bin/env python3
"""Scrape the public TKPI 2019 listing (andrafarm republishes the Kemenkes table) into JSON."""
import json
import re
import subprocess
import time

BASE = (
    "https://www.andrafarm.com/_andra.php?_i=daftar-tkpi&jobs=&perhal=500"
    "&urut=1&asc=0100000000&sby=&no1={start}&no2={end}&kk={kk}"
)
OUT = "packages/api/src/data/tkpi2019.json"

rows: dict[str, list] = {}
empty_streak = 0

for kk in range(1, 31):
    start = (kk - 1) * 500 + 1
    url = BASE.format(start=start, end=start + 499, kk=kk)
    html = subprocess.run(
        ["obscura", "fetch", url, "--dump", "original", "--wait", "4", "--timeout", "40"],
        capture_output=True, text=True, timeout=90,
    ).stdout
    trs = re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.S)
    page_new = 0
    for tr in trs:
        tds = [
            re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", td)).strip()
            for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, flags=re.S)
        ]
        if len(tds) < 9:
            continue
        code = tds[1]
        if not re.fullmatch(r"[A-Z]{2}\d{3}", code):
            continue

        def num(v: str) -> float | None:
            v = v.replace(",", ".").replace("-", "")
            try:
                return float(v)
            except ValueError:
                return None

        name = re.sub(r"\s+", " ", tds[2]).strip()
        if code in rows:
            continue
        rows[code] = [
            code,
            name,
            num(tds[3]),
            num(tds[4]),
            num(tds[5]),
            num(tds[6]),
            num(tds[7]),
            num(tds[8]),
        ]
        page_new += 1
    print(f"kk {kk}: +{page_new} (total {len(rows)})", flush=True)
    if page_new == 0:
        empty_streak += 1
        if empty_streak >= 2:
            break
    else:
        empty_streak = 0
    time.sleep(1.5)

data = {"source": "TKPI 2019 (Tabel Komposisi Pangan Indonesia, Kemenkes) — via andrafarm.com public listing", "columns": ["code", "name", "air_pct", "kcal", "protein_g", "fat_g", "carb_g", "fiber_g"], "items": sorted(rows.values(), key=lambda r: r[0])}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=0)
print(f"DONE: {len(rows)} items -> {OUT}")
