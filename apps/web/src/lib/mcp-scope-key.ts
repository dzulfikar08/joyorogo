import { mcpScopeKey } from "@joyorogo/api/lib/mcp-scopes";
import type { McpDataScope } from "@joyorogo/api/lib/mcp-scopes";

type ScopeKey = "profile_read" | "food_read" | "weight_read" | "workouts_read" | "recovery_read";

/** `mcpScopeKey` narrowed to the literal keys of `koneksi:scope.*`, so typed `t()` accepts it. */
export const scopeKey = (scope: McpDataScope) => mcpScopeKey(scope) as ScopeKey;
