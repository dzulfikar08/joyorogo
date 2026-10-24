// Registers JoyoRogo as a public OAuth client at COROS's MCP authorization server (RFC 7591 dynamic client registration,
// self-service: https://support.coros.com/hc/en-us/articles/53181619102996-Build-on-COROS-MCP) and prints the client_id.
//
//   bun scripts/coros-register-client.ts                       # JoyoRogo Cloud: https://api.joyorogo.com/api/coros/callback
//   bun scripts/coros-register-client.ts https://api.example.com/api/coros/callback [more redirect URIs...]
//
// The id goes into `COROS_CLIENT_ID` (apps/server/wrangler.jsonc vars, or the self-host setup). A public client has no
// secret. COROS accepts https redirect URIs only, and the redirect must be `<BETTER_AUTH_URL>/api/coros/callback` exactly
// (apps/server/src/coros.ts bounces it to the web page or the app). One client per environment: register again for staging.

const REGISTRATION_ENDPOINT = "https://mcpus.coros.com/connect/register";
const DEFAULT_REDIRECT = "https://api.joyorogo.com/api/coros/callback";

const redirectUris = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [DEFAULT_REDIRECT];

const response = await fetch(REGISTRATION_ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({
    client_name: "JoyoRogo",
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: "openid mcp.tools offline_access",
  }),
});

const body: unknown = await response.json().catch(() => null);
if (!response.ok || typeof body !== "object" || body === null || !("client_id" in body)) {
  console.error(`Registration failed (HTTP ${response.status}):`, JSON.stringify(body));
  process.exit(1);
}

console.log(`COROS_CLIENT_ID=${String(body.client_id)}`);
console.log(`redirect URIs: ${redirectUris.join(", ")}`);
