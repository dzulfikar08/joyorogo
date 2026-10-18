import { verifyJwsAccessToken } from "better-auth/oauth2";

import type { JoyoAuth } from "./index";
import { mcpResourceUrl } from "./index";
import { isMcpDataScope } from "./mcp-scopes";
import type { McpDataScope } from "./mcp-scopes";

/** Who a valid MCP access token speaks for. */
export interface McpPrincipal {
  userId: string;
  /** OAuth client id of the AI app. */
  clientId: string;
  /** Data scopes the token carries (offline_access and identity scopes are not data). */
  scopes: McpDataScope[];
}

/** A request the MCP endpoint must answer with a 401 challenge. */
export class McpAuthError extends Error {
  constructor(
    readonly code: "missing_token" | "invalid_token",
    message: string,
  ) {
    super(message);
  }
}

interface Jwks {
  keys: Record<string, unknown>[];
}

// Keys the JWKS cache of verifyJwsAccessToken by this object: the keys are read in process (never fetched back from
// our own public URL) and trusted for five minutes, long enough to skip a D1 read per call, short enough that a
// rotated key is picked up quickly.
const jwksCacheKey = {};

/**
 * Verifies the bearer token of an MCP request: signature against our own signing keys, issuer, the MCP endpoint as
 * audience and expiry. DPoP-bound tokens are refused (the endpoint is a plain bearer resource). Whether the person
 * still has the connection is the caller's check (apps/server/src/mcp.ts), because a JWT cannot be revoked.
 */
export async function verifyMcpAccessToken(auth: JoyoAuth, request: Request, authUrl: string): Promise<McpPrincipal> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match?.[1]) throw new McpAuthError("missing_token", "Missing bearer token.");
  const { baseURL } = await auth.$context;
  const api = auth.api as unknown as { getJwks: () => Promise<Jwks> };
  let claims: Record<string, unknown>;
  try {
    claims = await verifyJwsAccessToken(match[1], {
      jwksFetch: () => api.getJwks(),
      jwksCacheKey,
      verifyOptions: { issuer: baseURL, audience: mcpResourceUrl(authUrl) },
    });
  } catch {
    throw new McpAuthError("invalid_token", "The access token is invalid or expired.");
  }
  if (claims.cnf) throw new McpAuthError("invalid_token", "Sender-constrained (DPoP) tokens are not supported.");
  const userId = typeof claims.sub === "string" ? claims.sub : null;
  const clientId = typeof claims.azp === "string" ? claims.azp : null;
  if (!userId || !clientId) throw new McpAuthError("invalid_token", "The access token names no user or client.");
  const scope = typeof claims.scope === "string" ? claims.scope.split(" ") : [];
  return { userId, clientId, scopes: scope.filter(isMcpDataScope) };
}
