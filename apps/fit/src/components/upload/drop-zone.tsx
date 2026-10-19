import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";
import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import type { DragEvent } from "react";

import { IconChip } from "@/components/kit";

/** A target for files: drag them in, or press the button for the picker. It only hands the files over. */
export function DropZone({
  accept,
  multiple = true,
  onFiles,
  title,
  activeTitle,
  or,
  button,
  hint,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  activeTitle: string;
  or: string;
  button: string;
  hint: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    onFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <IconChip className="size-11 bg-primary/10 text-primary">
        <FileUp className="size-5" aria-hidden />
      </IconChip>
      <p className="text-sm font-bold">{dragging ? activeTitle : title}</p>
      <p className="text-xs text-muted-foreground">{or}</p>
      <Button size="sm" onClick={() => input.current?.click()}>
        {button}
      </Button>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      <input
        ref={input}
        type="file"
        multiple={multiple}
        accept={accept}
        className="sr-only"
        aria-label={button}
        tabIndex={-1}
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </div>
  );
}
