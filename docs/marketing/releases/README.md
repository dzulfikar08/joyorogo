# Release entries: the marketing queue

Every user-visible feature gets one file here, written by whoever ships it (human or agent). Marketing plans posts from
this folder, so a feature with no entry never gets a post.

JoyoFit keeps the same folder in its own repo (`watch-fit/docs/marketing/releases/`). The weekly sweep in
[`../social-playbook.md`](../social-playbook.md) reads both.

## When to write one

Write an entry when a user can see or use something new or visibly different: a screen, feature, setting, supported
device, plan or price change, or a fix people asked for in public (Threads, email, store review).

Skip refactors, tests, CI, internal tooling, docs-only changes and invisible fixes.

One file per feature, named `YYYY-MM-DD-<slug>.md` (ship date, short kebab slug). No shared list: parallel agents never
touch the same file. When a feature changes state later (code to test build to store, or it gets posted), edit its
existing file; do not add a second one.

## Template

```markdown
---
app: joyorogo            # joyorogo | joyofit | both
feature: Koreksi scan pakai suara   # the name users see in the UI
shipped: 2026-10-17      # date it landed on main/master
available: test-build    # code | web | test-build | store  (what a user can get today, see below)
tier: free               # free | pro | mixed
post: todo               # todo | planned YYYY-MM-DD | posted <url> | skip (<reason>)
atur: JRG-123            # atur issue key; empty if atur was unreachable
---

**Apa:** one or two sentences in plain Indonesian, from the user's side.

**Kenapa orang peduli:** the problem it removes.

**Angle post:** one Threads-style hook line.

**Bukti visual:** screenshot path, or how to capture one (screen, account state, demo data).

**Jangan klaim:** limits that must stay out of the post (estimates, untested devices, Pro-only, not in stores yet).
```

`available` values:

| Value | Meaning |
| --- | --- |
| `code` | Merged, not in any build users have. Do not post as released. |
| `web` | Live on joyorogo.com / fit.joyorogo.com (deployed). |
| `test-build` | In the Play closed test (Android), or in a build not yet in the App Store, or shipped by OTA to them. |
| `store` | In a public store release. iPhone is on the App Store (1.1.0 live 2026-10-28); Android is still a closed test, so an entry marked `store` is true for iPhone only until Play production opens. |

## After writing the file

Create an atur issue in workspace `joyodigitama`: title `[Konten] JoyoRogo: <feature>` in project Joyorogo (`JRG`), or
`[Konten] JoyoFit: <feature>` in project JoyoFit (`FIT`, `a10d50f0-4920-47d1-9a61-c0c0ff504f0c`). State Todo, sub-issue
of JRG-235 for both apps (`parent_id` `62fc3334-ca8a-4427-b236-ce1c50b2bc52`), description = the angle plus the entry's
path. Put the key in `atur:`.

## Claims

Follow [`../marketing-plan.md`](../marketing-plan.md) section 1.1 and the "Claims to avoid" list in
[`../social-playbook.md`](../social-playbook.md). Never write "tersedia di Play Store / App Store" before `available:
store`.
