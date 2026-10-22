import { useId, useState } from "react";
import { Camera, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { errMsg, useInvalidate } from "@/lib/data";
import { MAX_PHOTOS, uploadProductPhotos } from "@/lib/photos";

export function Thumb({
  url,
  label,
  className,
}: {
  url?: string | undefined;
  label: string;
  className?: string | undefined;
}) {
  return url ? (
    <img
      src={url}
      alt=""
      loading="lazy"
      className={cn("size-10 shrink-0 rounded-lg border object-cover", className)}
    />
  ) : (
    <span
      className={cn(
        "grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted text-[9px] font-semibold text-muted-foreground code-tag",
        className,
      )}
      aria-hidden
    >
      {label.split("-")[0]}
    </span>
  );
}

export function PhotoButtons({
  productId,
  count,
  compact,
}: {
  productId: string;
  count: number;
  compact?: boolean;
}) {
  const id = useId();
  const inv = useInvalidate();
  const [busy, setBusy] = useState(false);
  if (count >= MAX_PHOTOS)
    return <span className="text-xs text-muted-foreground">{MAX_PHOTOS} photos (max)</span>;
  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const n = await uploadProductPhotos(productId, [...files], count);
      toast.success(`${n} photo${n === 1 ? "" : "s"} added`);
      await inv("photos");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const btn =
    "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[11px] font-bold uppercase tracking-wide hover:border-primary";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <label
        htmlFor={`${id}-f`}
        className={cn(
          btn,
          "bg-accent text-accent-foreground border-accent",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <ImagePlus className="size-4" />
        {busy ? "Uploading…" : count ? "Add more" : compact ? "Photos" : "Add photos"}
      </label>
      <input
        id={`${id}-f`}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <label htmlFor={`${id}-c`} className={cn(btn, busy && "pointer-events-none opacity-60")}>
        <Camera className="size-4" />
        {compact ? "" : "Take photo"}
      </label>
      <input
        id={`${id}-c`}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </span>
  );
}
