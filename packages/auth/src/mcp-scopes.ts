// OAuth scopes of the MCP connector (docs/mcp-connector.md). Pure data, shared by the auth server, the MCP route, the
// API and the web consent page; the words the user reads live in the i18n catalogs (`koneksi.scope.<scope>`).

/** One read-only scope per kind of data a tool shows. Nothing here can change anything in the account. */
export const MCP_DATA_SCOPES = [
  "profile:read",
  "food:read",
  "weight:read",
  "workouts:read",
  "recovery:read",
] as const;

export type McpDataScope = (typeof MCP_DATA_SCOPES)[number];

/** Lets the client refresh its access token without sending the user through consent again (30 days). */
export const MCP_OFFLINE_SCOPE = "offline_access";

export const MCP_SCOPES: readonly string[] = [...MCP_DATA_SCOPES, MCP_OFFLINE_SCOPE];

export function isMcpDataScope(scope: string): scope is McpDataScope {
  return (MCP_DATA_SCOPES as readonly string[]).includes(scope);
}

/** The path of the MCP endpoint below the API origin. */
export const MCP_PATH = "/mcp";
