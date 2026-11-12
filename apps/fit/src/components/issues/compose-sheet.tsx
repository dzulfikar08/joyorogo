import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Textarea } from "@joyorogo/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bug, CircleHelp, Lightbulb, Paperclip, Send, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Segmented } from "@/components/kit";
import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  type ReportKind,
  issuesKeys,
  submitItem,
  uploadAttachment,
} from "@/lib/issues";

interface Attached {
  key: string;
  name: string;
  preview: string | null;
  /** Atur's id once uploaded; null while uploading. */
  id: string | null;
}

const KIND_ICON = { bug: Bug, question: CircleHelp, idea: Lightbulb } as const;
const KINDS: readonly ReportKind[] = ["bug", "question", "idea"];

/**
 * The page's own form: a problem, a question or an idea, with screenshots. Sent as the signed-in account, so a problem
 * or question lands in Laporanku as a ticket and an idea on the board. `onSent` gets where to look.
 */
export function ComposeSheet({
  kind: initialKind,
  onClose,
  onSent,
}: {
  kind: ReportKind | undefined;
  onClose: () => void;
  onSent: (result: { kind: ReportKind; id: string; sequence_id: number }) => void;
}) {
  const { t } = useTranslation("fitWebIssues");
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ReportKind>(initialKind ?? "bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const detailsId = useId();

  // A new open starts clean on the kind the button asked for.
  useEffect(() => {
    if (!initialKind) return;
    setKind(initialKind);
    setTitle("");
    setDescription("");
    setFiles([]);
    setFileError(null);
  }, [initialKind]);
  // Previews are object URLs: let them go when the form closes.
  const previews = useRef<string[]>([]);
  useEffect(() => {
    previews.current = files.flatMap((f) => (f.preview ? [f.preview] : []));
  }, [files]);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const send = useMutation({
    mutationFn: () =>
      submitItem({
        kind,
        title: title.trim(),
        description: description.trim() || undefined,
        attachment_ids: files.flatMap((f) => (f.id ? [f.id] : [])),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: issuesKeys.all });
      onSent({ kind, id: result.id, sequence_id: result.sequence_id });
    },
  });

  const addFiles = (list: FileList | null) => {
    setFileError(null);
    for (const file of Array.from(list ?? [])) {
      if (files.length >= MAX_ATTACHMENTS) {
        setFileError(t("compose.tooMany", { count: MAX_ATTACHMENTS }));
        break;
      }
      if (!ATTACHMENT_TYPES.includes(file.type) || file.size > MAX_ATTACHMENT_BYTES) {
        setFileError(t("compose.badFile", { name: file.name }));
        continue;
      }
      const key = `${file.name}-${file.size}-${Math.random()}`;
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      setFiles((prev) => [...prev, { key, name: file.name, preview, id: null }]);
      uploadAttachment(file).then(
        ({ id }) => setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, id } : f))),
        () => {
          setFiles((prev) => prev.filter((f) => f.key !== key));
          setFileError(t("compose.uploadFailed", { name: file.name }));
        },
      );
    }
  };

  const uploading = files.some((f) => f.id === null);
  const valid = title.trim().length >= 3;

  return (
    <Sheet
      open={!!initialKind}
      onOpenChange={(open) => !open && onClose()}
      title={t(`compose.title.${kind}`)}
      description={t(`compose.hint.${kind}`)}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !uploading && !send.isPending) send.mutate();
        }}
      >
        <Segmented<ReportKind>
          label={t("compose.kind")}
          value={kind}
          onChange={setKind}
          className="self-start overflow-x-auto"
          options={KINDS.map((id) => {
            const Icon = KIND_ICON[id];
            return {
              value: id,
              label: (
                <>
                  <Icon className="size-4" aria-hidden />
                  {t(`compose.kinds.${id}`)}
                </>
              ),
            };
          })}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={titleId} className="text-sm font-semibold">
            {t("compose.summary")}
          </label>
          <Input
            id={titleId}
            value={title}
            maxLength={120}
            placeholder={t(`compose.summaryPlaceholder.${kind}`)}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={detailsId} className="text-sm font-semibold">
            {t("compose.details")}
          </label>
          <Textarea
            id={detailsId}
            value={description}
            maxLength={4000}
            placeholder={t(`compose.detailsPlaceholder.${kind}`)}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <input
            ref={picker}
            type="file"
            multiple
            accept={ATTACHMENT_TYPES.join(",")}
            hidden
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {files.map((f) => (
                <li
                  key={f.key}
                  className="flex items-center gap-2 rounded-xl bg-muted py-1 pr-1 pl-1 text-xs"
                >
                  {f.preview ? (
                    <img src={f.preview} alt="" className="size-10 rounded-lg object-cover" />
                  ) : (
                    <Paperclip className="ml-1 size-4" aria-hidden />
                  )}
                  <span className="max-w-32 truncate">
                    {f.id ? f.name : t("compose.uploading", { name: f.name })}
                  </span>
                  <button
                    type="button"
                    aria-label={t("compose.remove", { name: f.name })}
                    onClick={() => setFiles((prev) => prev.filter((x) => x.key !== f.key))}
                    className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={files.length >= MAX_ATTACHMENTS}
            onClick={() => picker.current?.click()}
          >
            <Paperclip aria-hidden />
            {t("compose.attach")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("compose.attachHint")}</p>
          {fileError && (
            <p role="alert" className="text-sm text-destructive">
              {fileError}
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{t("compose.privacy")}</p>
        {send.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t("error.send")}
          </p>
        )}
        <Button type="submit" disabled={!valid || uploading || send.isPending}>
          <Send aria-hidden />
          {send.isPending ? t("sending") : uploading ? t("compose.waitUpload") : t("send")}
        </Button>
      </form>
    </Sheet>
  );
}
