import { Download, FileText, ShieldCheck, Smartphone, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { IconChip, ListAnchorRow, ListButtonRow, ListGroup, ListLinkRow, SectionTitle } from "@/components/kit/surface";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/store-urls";
import { openIosInstall } from "@/lib/ios-install";
import { legalPath } from "@/lib/legal-path";
import { usePlatform } from "@/lib/platform";

/** Install-app rows (iPhone / Android) and the legal pages. */
export function AboutScreen() {
  const { t, i18n } = useTranslation("settings");
  const platform = usePlatform();
  return (
    <>
      {platform.os === "ios" ? (
        !platform.standalone && (
          <>
            <SectionTitle>{t("section.appIphone")}</SectionTitle>
            <ListGroup>
              <ListButtonRow
                icon={
            <IconChip tone="makan">
              <Smartphone />
            </IconChip>
          }
                title={t("app.install.title")}
                subtitle={t("app.install.subtitle")}
                onClick={() => openIosInstall("profil")}
              />
            </ListGroup>
          </>
        )
      ) : (
        <>
          <SectionTitle>{t("section.appAndroid")}</SectionTitle>
          <ListGroup>
            <ListAnchorRow
              href={PLAY_STORE_URL}
              icon={
            <IconChip tone="makan">
              <Download />
            </IconChip>
          }
              title={t("app.googlePlay.title")}
              subtitle={t("app.googlePlay.subtitle")}
            />
            <ListAnchorRow
              href={APP_STORE_URL}
              icon={
            <IconChip tone="makan">
              <Smartphone />
            </IconChip>
          }
              title={t("app.appStore.title")}
              subtitle={t("app.appStore.subtitle")}
            />
          </ListGroup>
        </>
      )}

      <SectionTitle className="mt-7">{t("hubWeb.about.legal")}</SectionTitle>
      <ListGroup>
        <ListLinkRow
          to={legalPath("privacy", i18n.language)}
          icon={
            <IconChip tone="makan">
              <ShieldCheck />
            </IconChip>
          }
          title={t("privacy.policy")}
        />
        <ListLinkRow
          to={legalPath("terms", i18n.language)}
          icon={
            <IconChip tone="makan">
              <FileText />
            </IconChip>
          }
          title={t("hubWeb.about.terms")}
        />
        <ListLinkRow
          to="/pengembalian-dana"
          icon={
            <IconChip tone="makan">
              <Undo2 />
            </IconChip>
          }
          title={t("hubWeb.about.refund")}
        />
      </ListGroup>

      <SectionTitle className="mt-7">{t("dataSources.title")}</SectionTitle>
      <div className="space-y-2 px-1 text-sm leading-relaxed text-muted-foreground">
        <p>{t("dataSources.intro")}</p>
        <p>{t("dataSources.tkpi")}</p>
        <p>{t("dataSources.sgfoodid")}</p>
        <p lang="en" className="text-xs">
          {t("dataSources.notice")}
        </p>
      </div>
    </>
  );
}
