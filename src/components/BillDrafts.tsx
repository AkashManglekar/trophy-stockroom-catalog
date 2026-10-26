import { useState } from "react";
import { toast } from "sonner";
import { FolderOpen, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { inr, type Vendor } from "@/lib/domain";
import { errMsg, useBillDrafts, useInvalidate } from "@/lib/data";
import { newDraft, setDraft, type Draft } from "@/lib/draft";
import type { Json } from "@/integrations/supabase/types";
import { Card, CardTitle, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";

/** True when there's something on the Receive page worth keeping. */
export const hasWork = (d: Draft) => d.lines.length > 0 || !!d.billNo.trim() || !!d.vendorId;

/**
 * Saves the bill being worked on as a draft (updating its saved copy if it came from one) and
 * clears the page for the next bill. Returns the draft's id.
 */
export async function parkDraft(
  d: Draft,
  meta: { vendorName: string | null; value: number; email: string | null; note?: string },
): Promise<string> {
  const { savedId, ...data } = d;
  const row = {
    vendor_name: meta.vendorName,
    bill_no: d.billNo.trim() || null,
    bill_date: d.billDate || null,
    line_count: d.lines.length,
    value: meta.value || null,
    data: data as unknown as Json,
    updated_at: new Date().toISOString(),
    updated_by_email: meta.email,
    ...(meta.note !== undefined ? { note: meta.note.trim() || null } : {}),
  };
  if (savedId) {
    const { data: hit, error } = await supabase
      .from("bill_drafts")
      .update(row)
      .eq("id", savedId)
      .select("id");
    if (error) throw new Error(error.message);
    if (hit?.length) return savedId;
  }
  const { data: ins, error } = await supabase
    .from("bill_drafts")
    .insert({ ...row, created_by_email: meta.email })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return ins.id;
}

/** Once a bill is received or submitted, its saved draft goes. */
export async function dropSavedDraft(id: string | undefined) {
  if (!id) return;
  await supabase.from("bill_drafts").delete().eq("id", id);
}

export function vendorNameOf(d: Draft, vendors: Vendor[]): string | null {
  if (d.vendorId === "NEW") return d.newVendor["display_name"]?.trim() || "New vendor";
  return vendors.find((v) => v.id === d.vendorId)?.display_name ?? null;
}

export function SavedDrafts({
  current,
  currentValue,
  vendors,
}: {
  current: Draft;
  currentValue: number;
  vendors: Vendor[];
}) {
  const { canContribute, canEdit, userId, email } = useAuth();
  const drafts = useBillDrafts(canContribute);
  const inv = useInvalidate();
  const [busy, setBusy] = useState("");
  const list = drafts.data ?? [];
  if (!canContribute || !list.length) return null;

  async function open(id: string) {
    setBusy(id);
    try {
      if (hasWork(current) && current.savedId !== id) {
        await parkDraft(current, {
          vendorName: vendorNameOf(current, vendors),
          value: currentValue,
          email,
        });
        toast.success("The bill you were on is saved in Drafts");
      }
      const { data, error } = await supabase
        .from("bill_drafts")
        .select("data")
        .eq("id", id)
        .single();
      if (error) throw new Error(error.message);
      setDraft({ ...newDraft(), ...(data.data as unknown as Draft), savedId: id });
      await inv("bill_drafts");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  }
  async function remove(id: string, label: string) {
    if (!confirm(`Delete the draft ${label}? This can't be undone.`)) return;
    setBusy(id);
    const { error } = await supabase.from("bill_drafts").delete().eq("id", id);
    setBusy("");
    if (error) {
      toast.error(error.message);
      return;
    }
    if (current.savedId === id) setDraft((d) => ({ ...d, savedId: undefined }));
    toast.success("Draft deleted");
    await inv("bill_drafts");
  }

  return (
    <Card>
      <CardTitle right={<Pill tone="warn">{list.length}</Pill>}>Saved drafts</CardTitle>
      <ul className="grid gap-2">
        {list.map((r) => {
          const label = [r.vendor_name ?? "No vendor", r.bill_no].filter(Boolean).join(" · ");
          const isOpen = current.savedId === r.id;
          const mine = r.created_by === userId;
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card p-2.5"
            >
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="wrap-any text-sm font-semibold">
                  {label}
                  {isOpen && (
                    <Pill tone="info" className="ml-2">
                      open now
                    </Pill>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.line_count} line{r.line_count === 1 ? "" : "s"}
                  {r.value ? ` · ${inr(Number(r.value))}` : ""}
                  {r.bill_date
                    ? ` · bill ${new Date(r.bill_date).toLocaleDateString("en-IN", { dateStyle: "medium" })}`
                    : ""}{" "}
                  · saved{" "}
                  {new Date(r.updated_at).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {(r.updated_by_email ?? r.created_by_email)
                    ? ` by ${(r.updated_by_email ?? r.created_by_email ?? "").split("@")[0]}`
                    : ""}
                </span>
                {r.note && (
                  <span className="wrap-any text-xs text-warning-foreground dark:text-warning">
                    Pending: {r.note}
                  </span>
                )}
              </div>
              {!isOpen && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={!!busy}
                  onClick={() => open(r.id)}
                >
                  <FolderOpen className="size-4" /> Open
                </Button>
              )}
              {(mine || canEdit) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full text-muted-foreground"
                  disabled={!!busy}
                  aria-label={`Delete draft ${label}`}
                  onClick={() => remove(r.id, label)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
