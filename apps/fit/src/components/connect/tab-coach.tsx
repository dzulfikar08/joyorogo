import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSession } from "@/lib/auth-client";

import { CoachAside, CoachChat } from "./coach-chat";
import { SectionBand } from "./shared";

/** Tab "Coach": the chat over the person's own data. */
export default function CoachTab() {
  const { t } = useTranslation("fitWebConnect");
  const session = useSession();
  return (
    <SectionBand id="coach" Icon={Bot} title={t("coach.title")} subtitle={t("coach.subtitle")}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {session.data ? <CoachChat userId={session.data.user.id} /> : null}
        <CoachAside />
      </div>
    </SectionBand>
  );
}
