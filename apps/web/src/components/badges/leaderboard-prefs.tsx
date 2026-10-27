import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Chip } from "@/components/chip";
import { IconChip, ListGroup, ListLinkRow, ListRow } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { client, orpc } from "@/utils/orpc";

type Mode = "username" | "anonim";

/** Consistency board opt-in, display mode and alias. Renders nothing while the feature is off for this person. */
export function LeaderboardPrefs() {
  const { t } = useTranslation("badges");
  const queryClient = useQueryClient();
  const prefs = useQuery(orpc.leaderboard.prefs.queryOptions());
  const [mode, setMode] = useState<Mode | null>(null);
  const [alias, setAlias] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: { optIn: boolean; displayMode: Mode; alias: string | null }) =>
      client.leaderboard.setPrefs(input),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: orpc.leaderboard.key() });
      toast.success(t("board.saved"));
    },
    onError: (e) => setError(e.message),
  });

  const data = prefs.data;
  if (!data?.enabled) return null;
  const shownMode = mode ?? data.displayMode;
  const shownAlias = alias ?? data.alias ?? "";
  const dirty = shownMode !== data.displayMode || shownAlias !== (data.alias ?? "");
  const submit = (optIn: boolean) =>
    save.mutate({ optIn, displayMode: shownMode, alias: shownAlias.trim() === "" ? null : shownAlias.trim() });

  return (
    <section className="mt-3 space-y-2" aria-label={t("board.title")}>
      <ListGroup>
        <ListRow
          icon={
            <IconChip tone="bakar">
              <Trophy />
            </IconChip>
          }
          title={t("board.optIn")}
          subtitle={data.eligible ? t("board.optInBody") : t("board.maternal")}
          trailing={
            <Switch
              label={t("board.optIn")}
              checked={data.optIn}
              disabled={!data.eligible || save.isPending}
              onCheckedChange={submit}
            />
          }
        />
        {data.optIn && (
          <ListLinkRow to="/papan" title={t("board.title")} />
        )}
      </ListGroup>
      {data.eligible && (
        <p className="px-3 text-xs leading-relaxed text-muted-foreground">{t("board.consent")}</p>
      )}

      {data.optIn && (
        <div className="rounded-3xl bg-card p-4">
          <p className="text-sm font-semibold">{t("board.displayMode")}</p>
          <div className="mt-2 flex gap-2">
            <Chip active={shownMode === "username"} onClick={() => setMode("username")}>
              {t("board.displayUsername")}
            </Chip>
            <Chip active={shownMode === "anonim"} onClick={() => setMode("anonim")}>
              {t("board.displayAnonymous")}
            </Chip>
          </div>
          {shownMode === "anonim" && (
            <>
          <label className="mt-4 block text-sm font-semibold" htmlFor="board-alias">
            {t("board.alias")}
          </label>
          <Input
            id="board-alias"
            className="mt-1.5"
            value={shownAlias}
            maxLength={data.aliasMax}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t("board.aliasPlaceholder")}
            aria-invalid={error !== null}
            aria-describedby="board-alias-hint"
            onChange={(e) => {
              setAlias(e.target.value.toLowerCase());
              setError(null);
            }}
          />
          <p
            id="board-alias-hint"
            className={error ? "mt-1.5 text-xs font-semibold text-destructive" : "mt-1.5 text-xs text-muted-foreground"}
            role={error ? "alert" : undefined}
          >
            {error ?? t("board.aliasHint", { min: data.aliasMin, max: data.aliasMax })}
          </p>
            </>
          )}
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => submit(true)}>
              {t("board.save")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("board.optOutNote")}</p>
          </div>
        </div>
      )}
    </section>
  );
}
