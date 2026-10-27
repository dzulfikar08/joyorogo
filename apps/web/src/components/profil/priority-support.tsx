import { PRIORITY_SUPPORT } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/**
 * Pro's priority support: a Threads DM, answered within `PRIORITY_SUPPORT.replyWorkdays` working days. Anyone can DM that
 * account, so the person names the email of their JoyoRogo account, which the owner looks up in the admin; the copy
 * button puts that email on the clipboard. Shown to Pro accounts only: the promise is not made to anyone else.
 */
export function PrioritySupportCard({ email }: { email: string | null }) {
  const { t } = useTranslation("billing");
  return (
    <section aria-labelledby="priority-support-title" className="mb-3 rounded-3xl bg-card p-5">
      <p id="priority-support-title" className="text-[0.9375rem] font-bold">
        {t("pro.support.title")}
      </p>
      <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
        {t("pro.support.how", { count: PRIORITY_SUPPORT.replyWorkdays })}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          render={<a href={PRIORITY_SUPPORT.threadsUrl} target="_blank" rel="noopener noreferrer" />}
        >
          {t("pro.support.open")}
        </Button>
        {email && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(email);
              toast.success(t("pro.support.copied"));
            }}
          >
            {t("pro.support.copyEmail")}
          </Button>
        )}
      </div>
    </section>
  );
}
