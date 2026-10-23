import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { AuthProvider, useAuth } from "@/lib/auth";
import {
  attentionReasons,
  useFamilies,
  usePhotoMap,
  useProducts,
  useRefData,
  useInvalidate,
  useQuotes,
  useSubmissions,
  useVendors,
} from "@/lib/data";
import { useDraft } from "@/lib/draft";
import { syncZohoSales } from "@/lib/zoho-sync.functions";
import { vendorIssues } from "@/lib/gst";
import { Notice } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { LOGO_BLUE, OWNER_EMAIL } from "@/lib/domain";

export const Route = createFileRoute("/_app")({
  ssr: false,
  component: () => (
    <AuthProvider>
      <AppLayout />
    </AuthProvider>
  ),
});

function AppLayout() {
  const { session, loading, role, hasAccess, canApprove, userId, signOut } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!loading && !session) nav({ to: "/login" });
  }, [loading, session, nav]);

  const ref = useRefData();
  const products = useProducts();
  const families = useFamilies();
  const vendors = useVendors();
  const photos = usePhotoMap();
  const draft = useDraft();
  const subs = useSubmissions(hasAccess);
  const quotes = useQuotes();
  const inv = useInvalidate();
  const { canPublish } = useAuth();
  // Keep stock in step with Zoho sales: a quiet sync when the app opens (server skips if run <15 min ago).
  useEffect(() => {
    if (!canPublish) return;
    syncZohoSales({ data: {} })
      .then((r) => {
        if (r.ran && r.unitsApplied) inv("sales", "products", "adjustments", "zoho-status");
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPublish]);

  const badges = useMemo(() => {
    const r = ref.data;
    const prod = r
      ? (products.data ?? []).filter((p) =>
          attentionReasons(p, r, families.data ?? [], photos.get(p.id)?.length ?? 0).some(
            (x) => x === "name" || x === "cost" || x === "below cost",
          ),
        ).length
      : 0;
    const vend = (vendors.data ?? []).filter((v) => vendorIssues(v as never).length).length;
    const pending = (subs.data ?? []).filter((x) =>
      canApprove ? x.status === "pending" : x.submitted_by === userId && x.status === "rejected",
    ).length;
    return {
      "/receive": draft.lines.length + pending,
      "/products": prod,
      "/enquiries": (quotes.data ?? []).filter((x) => x.status === "new").length,
      "/vendors": vend,
    } as const;
  }, [
    ref.data,
    products.data,
    families.data,
    vendors.data,
    photos,
    draft.lines.length,
    subs.data,
    quotes.data,
    canApprove,
    userId,
  ]);

  if (loading || !session) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!hasAccess) {
    return (
      <main className="bg-hero flex min-h-dvh items-center justify-center px-4">
        <div className="panel grid max-w-sm gap-3 p-6 text-sm">
          <img src={LOGO_BLUE} alt="Sportagon" width={794} height={160} className="h-8 w-auto" />
          <h1 className="heading text-xl">No access yet</h1>
          <p className="text-muted-foreground">
            {session.user.email} isn't set up for the Stockroom. Ask {OWNER_EMAIL} to add you.
          </p>
          <Button className="rounded-full" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </main>
    );
  }
  return (
    <AppShell badges={badges}>
      {role === "viewer" && (
        <Notice tone="warn">
          You can view everything but not change it. Ask {OWNER_EMAIL} if you need to add bills.
        </Notice>
      )}
      {ref.error && (
        <Notice tone="bad">Couldn't load data: {String((ref.error as Error).message)}</Notice>
      )}
      <Outlet />
    </AppShell>
  );
}
