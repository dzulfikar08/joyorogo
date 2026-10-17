import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Share2, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Mascot } from "@/components/mascot";
import { Page } from "@/components/kit/surface";
import { trackConversion } from "@/lib/analytics";
import { shareInvite } from "@/lib/group-invite";
import { InfoAccordion } from "@/components/onboarding/info-accordion";
import { orpc } from "@/utils/orpc";

type CreatedGroup = { id: string; name: string; inviteCode: string };

/**
 * Optional step after the plan-ready screen: start a group and send its
 * invite, or share one the person is already in. Reuses group.create, the
 * group list and the same share helper as the group screen. Never gates
 * anything: "Skip" goes straight on.
 */
export function InviteFriendsStep({
  defaultName,
  onSkip,
  onOpenGroup,
}: {
  defaultName: string;
  /** Leaves the step; the caller continues to the app. */
  onSkip: () => void;
  onOpenGroup: (groupId: string) => void;
}) {
  const { t } = useTranslation("onboarding");
  const queryClient = useQueryClient();
  const [name, setName] = useState(defaultName);
  const [created, setCreated] = useState<CreatedGroup | null>(null);
  const groups = useQuery(orpc.group.list.queryOptions());

  const create = useMutation(
    orpc.group.create.mutationOptions({
      onSuccess: (group) => {
        if (!group) return;
        queryClient.invalidateQueries({ queryKey: orpc.group.key() });
        trackConversion("onboarding_group_created");
        setCreated({ id: group.id, name: group.name, inviteCode: group.inviteCode });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const share = (group: { name: string; inviteCode: string }) => {
    shareInvite(group.name, group.inviteCode).then(
      (result) => {
        if (result === "copied") toast.success(t("invite.toast.copied"));
      },
      () => toast.error(t("invite.toast.shareFailed")),
    );
  };

  const trimmed = name.trim();
  const existing = groups.data ?? [];

  return (
    <Page className="max-w-xl">
      <header className="px-1 pt-2 pb-4">
        <Mascot pose="cheer" size="sm" eager className="mx-0 mb-2" />
        <h1 className="text-[1.75rem] leading-tight font-extrabold tracking-tight">
          {created ? t("invite.createdTitle") : t("invite.title")}
        </h1>
        {created && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t("invite.createdCaption")}
          </p>
        )}
      </header>

      {created ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-3xl bg-card p-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Users className="size-5 text-primary" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate font-bold">{created.name}</p>
              <p className="text-sm text-muted-foreground">
                {t("invite.code", { code: created.inviteCode })}
              </p>
            </div>
          </div>
          <Button className="w-full" size="lg" onClick={() => share(created)}>
            <Share2 aria-hidden />
            {t("invite.shareInvite")}
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => onOpenGroup(created.id)}>
            {t("invite.openGroup")}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onSkip}>
            {t("invite.later")}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed.length > 0) create.mutate({ name: trimmed });
          }}
        >
          <label className="block space-y-1.5">
            <span className="px-1 text-sm font-semibold">{t("invite.nameLabel")}</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              aria-label={t("invite.nameLabel")}
            />
          </label>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={trimmed.length === 0 || create.isPending}
          >
            {create.isPending ? t("invite.creating") : t("invite.create")}
          </Button>

          {existing.length > 0 && (
            <section aria-label={t("invite.existingLabel")} className="pt-2">
              <p className="px-1 pb-2 text-sm font-semibold text-muted-foreground">
                {t("invite.existingTitle")}
              </p>
              <ul className="space-y-2">
                {existing.slice(0, 3).map((group) => (
                  <li
                    key={group.id}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-card p-3"
                  >
                    <span className="min-w-0 truncate font-semibold">{group.name}</span>
                    <Button type="button" size="sm" variant="secondary" onClick={() => share(group)}>
                      <Share2 aria-hidden />
                      {t("invite.share")}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <InfoAccordion title={t("invite.whyTitle")}>
            <p>{t("invite.why")}</p>
          </InfoAccordion>

          <Button type="button" variant="ghost" className="w-full" onClick={onSkip}>
            {t("invite.skip")}
          </Button>
        </form>
      )}
    </Page>
  );
}
