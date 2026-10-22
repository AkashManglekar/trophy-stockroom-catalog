import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import {
  attentionReasons,
  useFamilies,
  usePhotoMap,
  useProducts,
  useRefData,
  useVendors,
} from "@/lib/data";
import { useDraft } from "@/lib/draft";
import { vendorIssues } from "@/lib/gst";
import { Notice } from "@/components/kit";

export const Route = createFileRoute("/_app")({
  ssr: false,
  component: AppLayout,
});

function AppLayout() {
  const { session, loading, role } = useAuth();
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
    return { "/receive": draft.lines.length, "/products": prod, "/vendors": vend } as const;
  }, [ref.data, products.data, families.data, vendors.data, photos, draft.lines.length]);

  if (loading || !session) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  return (
    <AppShell badges={badges}>
      {role === "viewer" && (
        <Notice tone="warn">
          You can view everything but not change it. Ask the owner to make you a contributor or
          editor in Settings → Team.
        </Notice>
      )}
      {ref.error && (
        <Notice tone="bad">Couldn't load data: {String((ref.error as Error).message)}</Notice>
      )}
      <Outlet />
    </AppShell>
  );
}
