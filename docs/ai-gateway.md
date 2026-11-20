# AI Gateway: a trace for every model call

Every Workers AI call made while serving a request goes through Cloudflare AI Gateway, so the dashboard
(Cloudflare → AI → AI Gateway → `default`) shows each call's model, latency, tokens, cache and errors, and for text calls
the full prompt and answer.

## How it is wired

- `packages/api/src/lib/ai-gateway.ts` `withGateway(ai, id, metadata)` wraps the `AI` binding: each `run(model, input)`
  gets `{ gateway: { id, collectLog, metadata } }`. Call sites do not change.
- `apps/server/src/context.ts` wraps `env.AI` once per request with `metadata = { app: "joyorogo", route, user }`
  (`route` = the RPC path, e.g. `/rpc/ai/analyzeFoodStream`). Filter the gateway logs by these.
- `AI_GATEWAY_ID` (`apps/server/wrangler.jsonc` vars) picks the gateway. `default` is created by Cloudflare on the first
  call. Remove the var to go straight to Workers AI again.
- Calls made outside a request context (the bench endpoints and the anonymous scan in `apps/server/src/index.ts`,
  `anon.ts`) use the raw binding and are not in the gateway.

## Photos and voice are not logged

A call whose input holds a base64 photo or audio clip (any string of 20k+ characters, a `data:image/` or `data:audio/`
URL, or bytes) is sent with `collectLog: false`. The gateway still counts it in its analytics (requests, latency,
errors, tokens) but keeps no request or response. Scan photos are meant to expire from R2 in about 2 days; a gateway
log would keep them longer. So the vision scan, scale readout, egg count, card measure, scan corrections that send the
stored photo, and Whisper transcriptions show up as analytics only; the coach, Joyo AI, weekly reflection, and
corrections without a photo are logged in full.

## Where scan accuracy lives

The gateway is the raw trace. Scan accuracy is still measured from the scan session in `ai_usage.usage_json`
(`lib/scan-outcome.ts`: the model's answer next to what the user saved, the edit kind, retries, the shadow test), with
`scripts/review-scans-ab.ts` and `scripts/eval-scans.ts` for prompt A/B runs. Mid-scan words are logged too:
`hint` on the scan row ("Tulis keterangan" before the photo) and `queued: true` on a correction row (typed or spoken
while the photo was analyzed).
