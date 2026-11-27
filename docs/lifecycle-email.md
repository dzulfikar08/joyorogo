# Lifecycle email

Automatic activation and win-back mail, sent by the server cron (`apps/server/src/lifecycle-email.ts`).

| Mail | email_log kind | Who | How often |
|---|---|---|---|
| Activation 1 ("Foto makanan berikutnya, Joyo yang hitung") | `lifecycle_activate_1` | Verified account 1–13 days old that has never been active | Once per user |
| Activation 2 ("Satu foto saja dulu") | `lifecycle_activate_2` | Still never active, account 4+ days old, activation 1 sent 2+ days ago | Once per user |
| Win-back ("Joyo kangen catatan makanmu") | `lifecycle_winback` | Last active 14–44 days ago | Once per lapse (ref `<userId>:<lastActiveMs>`), at most one per 30 days |
| Paid check-in 1 ("Cara paling ringan memakai Pro-mu") | `lifecycle_paid_1` | First real payment 3–13 days ago, Pro still on, idle 3+ days (counted from the later of the payment and the last activity) | Once per user |
| Paid check-in 2 ("Ada yang bisa saya bantu?") | `lifecycle_paid_2` | First payment 7–13 days ago, Pro still on, idle 3+ days, nothing logged since check-in 1, sent 3+ days after it | Once per user |

- **Active** means a photo scan (`ai_usage.scan_type = 'user'`) or any `food_log` row except Huawei imports.
- 14 days matches `ENGAGED_DAYS` in `packages/api/src/lib/reminders.ts`: that is when meal push reminders stop, so the win-back picks up where push leaves off.
- **Paid check-ins** exist because of the November 2026 renewal check: of 16 web (QRIS / transfer) buyers from October whose month had ended, 14 did not renew, and 12 of those had stopped logging in their first one to two weeks, long before the "Founder ending" reminder. A "real payment" is a paid `payment` row that is not a test purchase, not a Rp0 trial and grants time (`months > 0`). While someone is in the paid window they get no activation mail; after it, the normal win-back applies.
- Never-active accounts older than 14 days get nothing from this. Reach them with a one-off broadcast from the admin console if wanted.
- Copy is in id, en and ms (the user's profile locale), written in `COPY` in the module.

## Sending rules

- From the broadcast sender (`Dzulfikar <dzulfikar@joyorogo.com>`) with the one-click `List-Unsubscribe` header and footer. Broadcast opt-outs (`email-optout/` in R2) apply. Our own accounts (`INTERNAL_EMAILS`) and `ADMIN_EMAILS` are skipped.
- 09:00–19:59 WIB only, up to 20 mails per five-minute tick. The first failed send releases its claim and ends the tick, so a broken email setup costs one attempt per tick.
- Each mail is claimed in `email_log` before sending (UNIQUE(kind, ref)), like every other mail.

## Switch

Off unless the server var `LIFECYCLE_EMAIL` is `on`. Set it in `apps/server/wrangler.jsonc` `vars` and deploy the server; set it to anything else to stop.
