import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { session, user } from "./auth";

// Tables of the Better Auth OAuth 2.1 provider (@better-auth/mcp, which is @better-auth/oauth-provider) and of its
// jwt plugin. They back the MCP connector (docs/mcp-connector.md): Claude, ChatGPT and any other MCP client
// register themselves (dynamic client registration), the user consents, and the client holds an access token for
// https://api.joyorogo.com/mcp plus a refresh token.
//
// Property names are the field names Better Auth uses, so the Drizzle adapter finds them; the schema key of each
// table is the model name. The SQLite adapter stores string[] and json fields as JSON text and dates as epoch ms.
const createdAtMs = () =>
  integer("created_at", { mode: "timestamp_ms" }).default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`);

/** An OAuth client: a connector that registered itself, or one an operator created. */
export const oauthClient = sqliteTable(
  "oauth_client",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: integer("disabled", { mode: "boolean" }).default(false),
    skipConsent: integer("skip_consent", { mode: "boolean" }),
    enableEndSession: integer("enable_end_session", { mode: "boolean" }),
    subjectType: text("subject_type"),
    scopes: text("scopes"),
    clientCredentialsScopes: text("client_credentials_scopes"),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAtMs(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts"),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris"),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: integer("backchannel_logout_session_required", { mode: "boolean" }),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types"),
    responseTypes: text("response_types"),
    requirePKCE: integer("require_pkce", { mode: "boolean" }),
    dpopBoundAccessTokens: integer("dpop_bound_access_tokens", { mode: "boolean" }).default(false),
    referenceId: text("reference_id"),
    metadata: text("metadata"),
  },
  (table) => [index("oauth_client_user_idx").on(table.userId), index("oauth_client_created_idx").on(table.createdAt)],
);

/** Protected resources tokens are issued for (the MCP endpoint). */
export const oauthResource = sqliteTable("oauth_resource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes"),
  customClaims: text("custom_claims"),
  dpopBoundAccessTokensRequired: integer("dpop_bound_access_tokens_required", { mode: "boolean" }).default(false),
  disabled: integer("disabled", { mode: "boolean" }).default(false),
  createdAt: createdAtMs(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  policyVersion: integer("policy_version").default(1),
  metadata: text("metadata"),
});

/** Which clients may request which resources. */
export const oauthClientResource = sqliteTable(
  "oauth_client_resource",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: text("metadata"),
    createdAt: createdAtMs(),
  },
  (table) => [
    uniqueIndex("oauth_client_resource_pair_uidx").on(table.clientId, table.resourceId),
    index("oauth_client_resource_resource_idx").on(table.resourceId),
  ],
);

/** A refresh token (scope offline_access); stored hashed. One live row per connected client and user. */
export const oauthRefreshToken = sqliteTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requested_user_info_claims"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    revoked: integer("revoked", { mode: "timestamp_ms" }),
    rotatedAt: integer("rotated_at", { mode: "timestamp_ms" }),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: integer("rotation_replay_expires_at", { mode: "timestamp_ms" }),
    authTime: integer("auth_time", { mode: "timestamp_ms" }),
    confirmation: text("confirmation"),
    scopes: text("scopes").notNull(),
  },
  (table) => [
    index("oauth_refresh_token_client_idx").on(table.clientId),
    index("oauth_refresh_token_user_idx").on(table.userId),
    index("oauth_refresh_token_session_idx").on(table.sessionId),
    index("oauth_refresh_token_code_idx").on(table.authorizationCodeId),
  ],
);

/** An opaque access token; tokens of the MCP resource are JWTs and are not stored. */
export const oauthAccessToken = sqliteTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token").unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requested_user_info_claims"),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    revoked: integer("revoked", { mode: "timestamp_ms" }),
    confirmation: text("confirmation"),
    scopes: text("scopes").notNull(),
  },
  (table) => [
    index("oauth_access_token_client_idx").on(table.clientId),
    index("oauth_access_token_user_idx").on(table.userId),
    index("oauth_access_token_session_idx").on(table.sessionId),
    index("oauth_access_token_code_idx").on(table.authorizationCodeId),
    index("oauth_access_token_refresh_idx").on(table.refreshId),
  ],
);

/** What a user agreed to give a client: the connected AI apps of Settings > Koneksi AI. */
export const oauthConsent = sqliteTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requested_user_info_claims"),
    scopes: text("scopes").notNull(),
    createdAt: createdAtMs(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("oauth_consent_client_idx").on(table.clientId),
    index("oauth_consent_user_idx").on(table.userId),
  ],
);

/** Single-use ids of private_key_jwt client assertions (unused here, the plugin requires the model). */
export const oauthClientAssertion = sqliteTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

/** Signing keys of the jwt plugin: the private key is stored encrypted with BETTER_AUTH_SECRET. */
export const jwks = sqliteTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  alg: text("alg"),
  crv: text("crv"),
});

/**
 * Audit log of the MCP connector: one row per tool call (and per refused call). It records who asked, through
 * which client, which tool and the arguments (dates and ids, never health data), and how it ended. The Koneksi AI
 * page shows the latest rows to their owner; rows are deleted after 90 days and with the account.
 */
export const mcpAudit = sqliteTable(
  "mcp_audit",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    tool: text("tool").notNull(),
    // JSON of the arguments, cut to 500 characters.
    args: text("args"),
    // 'ok' | 'error' | 'not_pro' | 'rate_limited' | 'scope'
    outcome: text("outcome").notNull(),
    ms: integer("ms").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("mcp_audit_user_created_idx").on(table.userId, table.createdAt),
    index("mcp_audit_created_idx").on(table.createdAt),
  ],
);
