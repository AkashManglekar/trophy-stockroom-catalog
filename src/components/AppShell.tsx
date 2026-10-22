import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  BookOpen,
  LayoutGrid,
  LogOut,
  PackagePlus,
  Settings,
  Store,
  UploadCloud,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export type NavKey = "/receive" | "/products" | "/vendors" | "/export" | "/settings" | "/guide";
const NAV: { to: NavKey; label: string; short: string; icon: typeof Store }[] = [
  { to: "/receive", label: "Receive stock", short: "Receive", icon: PackagePlus },
  { to: "/products", label: "Products", short: "Products", icon: LayoutGrid },
  { to: "/vendors", label: "Vendors", short: "Vendors", icon: Store },
  { to: "/export", label: "Zoho export", short: "Zoho", icon: UploadCloud },
  { to: "/settings", label: "Settings", short: "Settings", icon: Settings },
  { to: "/guide", label: "How to use", short: "Guide", icon: BookOpen },
];

export function AppShell({
  children,
  badges,
}: {
  children: ReactNode;
  badges: Partial<Record<NavKey, number>>;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { email, role, signOut } = useAuth();
  return (
    <div className="min-h-dvh">
      <header
        className="sticky top-0 z-30 bg-primary text-primary-foreground shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2.5">
          <Link to="/receive" className="flex items-baseline gap-2">
            <span className="text-[15px] font-black uppercase tracking-[0.12em]">Sportagon</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-75">
              Stockroom
            </span>
          </Link>
          <nav className="ml-auto hidden gap-1 md:flex" aria-label="Sections">
            {NAV.map((n) => {
              const on = path.startsWith(n.to);
              const b = badges[n.to];
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "relative rounded-full px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide transition-colors",
                    on
                      ? "bg-accent text-accent-foreground"
                      : "opacity-80 hover:bg-white/10 hover:opacity-100",
                  )}
                >
                  {n.label}
                  {b ? (
                    <span className="ml-1.5 rounded-full bg-warning px-1.5 text-[10px] text-warning-foreground">
                      {b}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-2">
            <span
              className="hidden max-w-40 truncate text-[11px] opacity-80 lg:inline"
              title={email ?? ""}
            >
              {email} · {role}
            </span>
            <button
              onClick={signOut}
              className="rounded-full p-2 opacity-80 hover:bg-white/10 hover:opacity-100"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-5 pb-safe md:pb-12">{children}</main>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 bg-primary px-1 pt-1.5 text-primary-foreground shadow-[0_-4px_18px_rgba(0,0,0,.18)] md:hidden"
        style={{ paddingBottom: "calc(6px + env(safe-area-inset-bottom))" }}
        aria-label="Sections"
      >
        {NAV.map((n) => {
          const on = path.startsWith(n.to);
          const b = badges[n.to];
          const I = n.icon;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "grid min-w-0 justify-items-center gap-0.5 rounded-xl px-0.5 py-1.5 text-[9.5px] font-bold uppercase tracking-wide",
                on ? "bg-white/15" : "opacity-75",
              )}
            >
              <span className="relative">
                <I className={cn("size-[22px]", on && "text-accent")} />
                {b ? (
                  <span className="absolute -right-3 -top-1.5 min-w-4 rounded-full bg-warning px-1 text-center text-[9px] leading-4 text-warning-foreground">
                    {b}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full truncate">{n.short}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
