import type {
  ReactNode,
  SelectHTMLAttributes,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("grid min-w-0 gap-1.5", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

const ctl =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base sm:text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(ctl, "pr-8", className)} {...p}>
      {children}
    </select>
  );
}
export function TextInput({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(ctl, className)} {...p} />;
}
export function TextArea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(ctl, "h-auto min-h-24 py-2 font-mono text-sm", className)} {...p} />
  );
}

type Tone = "ok" | "warn" | "bad" | "info" | "mute" | "brand";
const tones: Record<Tone, string> = {
  ok: "bg-success/15 text-success",
  warn: "bg-warning/25 text-warning-foreground dark:text-warning",
  bad: "bg-destructive/15 text-destructive",
  info: "bg-accent/20 text-accent-foreground dark:text-accent",
  mute: "bg-muted text-muted-foreground",
  brand: "bg-primary text-primary-foreground",
};
export function Pill({
  tone = "mute",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("panel grid min-w-0 gap-4 p-4 sm:p-5", className)}>{children}</section>
  );
}
export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
        {children}
      </h2>
      {right}
    </div>
  );
}
export function PageHead({
  title,
  lede,
  right,
}: {
  title: string;
  lede?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="heading text-2xl sm:text-3xl">{title}</h1>
        {lede ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{lede}</p> : null}
      </div>
      {right}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "bad";
  children: ReactNode;
}) {
  const c =
    tone === "warn"
      ? "bg-warning/20 text-warning-foreground dark:text-warning"
      : tone === "bad"
        ? "bg-destructive/12 text-destructive"
        : "bg-accent/15 text-accent-foreground dark:text-accent";
  return <div className={cn("rounded-xl px-4 py-3 text-sm", c)}>{children}</div>;
}
export function Code({ children, big }: { children: ReactNode; big?: boolean }) {
  return (
    <span className={cn("code-tag", big ? "text-2xl text-primary" : "text-[13px]")}>
      {children}
    </span>
  );
}
