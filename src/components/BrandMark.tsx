import { LOGO_BLUE, LOGO_MARK } from "@/lib/domain";
import { cn } from "@/lib/utils";

/**
 * Small Sportagon logo laid over a photo's corner. It sits on top of the image on screen only —
 * the stored photo is never changed.
 */
export function BrandMark({
  size = "sm",
  className,
}: {
  /** xs: hexagon only (thumbnails) · sm: full logo, small · md: full logo for large views. */
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute bottom-2 right-2 z-[1] select-none rounded-md bg-white/85 shadow-sm ring-1 ring-black/5 backdrop-blur-[2px]",
        size === "xs" ? "p-1" : size === "sm" ? "px-1.5 py-1" : "px-2.5 py-1.5",
        className,
      )}
    >
      <img
        src={size === "xs" ? LOGO_MARK : LOGO_BLUE}
        alt=""
        draggable={false}
        className={cn(
          "block w-auto",
          size === "xs" ? "h-3.5" : size === "sm" ? "h-3 sm:h-3.5" : "h-4 sm:h-5",
        )}
      />
    </span>
  );
}
