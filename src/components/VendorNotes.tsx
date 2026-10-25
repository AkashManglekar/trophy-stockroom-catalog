import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Paperclip,
  Pin,
  PinOff,
  StickyNote,
  Trash2,
  Upload,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { errMsg, useInvalidate, useVendorNotes } from "@/lib/data";
import type { VendorNote } from "@/lib/domain";
import { uid } from "@/lib/draft";
import { Field, TextArea, TextInput } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Kind = "note" | "link" | "file";
const MAX_BYTES = 25 * 1024 * 1024;
const LINK_HINTS = ["Catalogue", "Price list", "Website", "Google Drive", "WhatsApp group"];

const fmtSize = (n: number | null) =>
  n == null
    ? ""
    : n < 1024 * 1024
      ? `${Math.max(1, Math.round(n / 1024))} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
const safeName = (n: string) =>
  n
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(-80) || "file";
const withScheme = (u: string) =>
  /^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`;
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** Everything about a vendor in one place: notes, links (catalogue, price list…) and documents. */
export function VendorNotes({ vendorId, vendorCode }: { vendorId: string; vendorCode: string }) {
  const { canContribute, canEdit, userId } = useAuth();
  const inv = useInvalidate();
  const notes = useVendorNotes(vendorId);
  const items = notes.data ?? [];
  const [kind, setKind] = useState<Kind>("note");
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [sure, setSure] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Private files open through signed links, refreshed well before they expire.
  const paths = items.map((x) => x.file_path).filter((p): p is string => !!p);
  const signed = useQuery({
    queryKey: ["vendor_note_urls", paths.join("|")],
    enabled: paths.length > 0,
    staleTime: 45 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("media").createSignedUrls(paths, 3600);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((d) => [d.path ?? "", d.signedUrl]));
    },
  });

  const reset = () => {
    setBody("");
    setTitle("");
    setUrl("");
  };
  const refresh = () => inv("vendor_notes");

  async function addNote() {
    if (!body.trim()) {
      toast.error("Write the note first");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("vendor_notes")
      .insert({
        vendor_id: vendorId,
        kind: "note",
        body: body.trim(),
        title: title.trim() || null,
      });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Note added");
    reset();
    refresh();
  }
  async function addLink() {
    const u = withScheme(url);
    try {
      new URL(u);
    } catch {
      toast.error("That doesn't look like a link");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("vendor_notes").insert({
      vendor_id: vendorId,
      kind: "link",
      url: u,
      title: title.trim() || hostOf(u),
      body: body.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Link saved");
    reset();
    refresh();
  }
  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    const big = list.filter((f) => f.size > MAX_BYTES);
    if (big.length) toast.error(`${big.map((f) => f.name).join(", ")} is over 25 MB — skipped`);
    const ok = list.filter((f) => f.size <= MAX_BYTES);
    if (!ok.length) return;
    setBusy(true);
    let done = 0;
    for (const f of ok) {
      const path = `vendors/${vendorId}/${uid()}-${safeName(f.name)}`;
      const up = await supabase.storage
        .from("media")
        .upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
      if (up.error) {
        toast.error(`${f.name}: ${up.error.message}`);
        continue;
      }
      const { error } = await supabase.from("vendor_notes").insert({
        vendor_id: vendorId,
        kind: "file",
        file_path: path,
        file_name: f.name,
        mime: f.type || null,
        size_bytes: f.size,
        title: ok.length === 1 && title.trim() ? title.trim() : null,
        body: ok.length === 1 && body.trim() ? body.trim() : null,
      });
      if (error) {
        await supabase.storage.from("media").remove([path]);
        toast.error(`${f.name}: ${error.message}`);
        continue;
      }
      done++;
    }
    setBusy(false);
    if (done) {
      toast.success(`${done} document${done === 1 ? "" : "s"} added to ${vendorCode}`);
      reset();
      refresh();
    }
    if (fileRef.current) fileRef.current.value = "";
  }
  async function togglePin(n: VendorNote) {
    const { error } = await supabase
      .from("vendor_notes")
      .update({ pinned: !n.pinned })
      .eq("id", n.id);
    if (error) toast.error(error.message);
    else refresh();
  }
  async function remove(n: VendorNote) {
    if (sure !== n.id) {
      setSure(n.id);
      return;
    }
    setSure(null);
    try {
      const { error } = await supabase.from("vendor_notes").delete().eq("id", n.id);
      if (error) throw error;
      if (n.file_path) await supabase.storage.from("media").remove([n.file_path]);
      toast.success("Removed");
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  const tabs: { k: Kind; label: string; icon: typeof StickyNote }[] = [
    { k: "note", label: "Note", icon: StickyNote },
    { k: "link", label: "Link", icon: Link2 },
    { k: "file", label: "Document", icon: Paperclip },
  ];

  return (
    <section
      className={cn("grid gap-3 rounded-xl border p-3", drag && "border-primary bg-primary/5")}
      onDragOver={(e) => {
        if (!canContribute) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        if (!canContribute) return;
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
      }}
    >
      <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
        Notes, links & documents · {items.length}
      </h4>

      {canContribute && (
        <div className="grid gap-2">
          <div className="inline-flex w-fit gap-1 rounded-full border bg-muted p-1" role="tablist">
            {tabs.map(({ k, label, icon: Icon }) => (
              <button
                key={k}
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase text-muted-foreground",
                  kind === k && "bg-card text-primary shadow-sm",
                )}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>

          {kind === "note" && (
            <>
              <TextArea
                className="min-h-20 font-sans"
                placeholder="Rates agreed, contact person, delivery habits, quality issues…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <Button
                size="sm"
                className="w-fit rounded-full"
                disabled={busy || !body.trim()}
                onClick={addNote}
              >
                Add note
              </Button>
            </>
          )}

          {kind === "link" && (
            <>
              <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
                <Field label="Name">
                  <TextInput
                    value={title}
                    placeholder="e.g. Catalogue 2026"
                    list="vendor-link-hints"
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  <datalist id="vendor-link-hints">
                    {LINK_HINTS.map((h) => (
                      <option key={h} value={h} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Link">
                  <TextInput
                    inputMode="url"
                    value={url}
                    placeholder="https://…"
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && url.trim() && addLink()}
                  />
                </Field>
              </div>
              <Button
                size="sm"
                className="w-fit rounded-full"
                disabled={busy || !url.trim()}
                onClick={addLink}
              >
                Save link
              </Button>
            </>
          )}

          {kind === "file" && (
            <>
              <Field label="Name (optional)">
                <TextInput
                  value={title}
                  placeholder="e.g. Price list Oct 2026"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && upload(e.target.files)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="size-4" /> {busy ? "Uploading…" : "Choose files"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  PDF, Excel, Word, images — up to 25 MB each. You can also drop files here.
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {notes.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : !items.length ? (
        <p className="text-xs text-muted-foreground">
          Nothing yet — keep their catalogue, price lists, agreements and notes here.
        </p>
      ) : (
        <ul className="grid gap-2">
          {items.map((n) => {
            const Icon =
              n.kind === "note"
                ? StickyNote
                : n.kind === "link"
                  ? Link2
                  : n.mime?.startsWith("image/")
                    ? ImageIcon
                    : FileText;
            const href =
              n.kind === "link" ? n.url : n.file_path ? signed.data?.[n.file_path] : undefined;
            const mine = n.created_by === userId;
            const heading =
              n.kind === "note"
                ? n.title
                : n.kind === "link"
                  ? n.title || hostOf(n.url ?? "")
                  : n.title || n.file_name;
            return (
              <li
                key={n.id}
                className={cn(
                  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg bg-muted/60 p-2.5 text-sm",
                  n.pinned && "ring-1 ring-primary/40",
                )}
              >
                <Icon className="mt-0.5 size-4 text-muted-foreground" />
                <div className="grid min-w-0 gap-0.5">
                  {heading &&
                    (href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="wrap-any inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                      >
                        {heading} <ExternalLink className="size-3 shrink-0" />
                      </a>
                    ) : (
                      <strong className="wrap-any">{heading}</strong>
                    ))}
                  {n.kind === "link" && n.title && (
                    <span className="wrap-any text-xs text-muted-foreground">
                      {hostOf(n.url ?? "")}
                    </span>
                  )}
                  {n.kind === "file" && (
                    <span className="wrap-any text-xs text-muted-foreground">
                      {n.title ? `${n.file_name} · ` : ""}
                      {fmtSize(n.size_bytes)}
                    </span>
                  )}
                  {n.body && <p className="wrap-any whitespace-pre-wrap">{n.body}</p>}
                  <span className="text-[11px] text-muted-foreground">
                    {(n.created_by_email ?? "").split("@")[0] || "—"} ·{" "}
                    {new Date(n.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-0.5">
                  {canContribute && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 rounded-full"
                      title={n.pinned ? "Unpin" : "Pin to top"}
                      aria-label={n.pinned ? "Unpin" : "Pin to top"}
                      onClick={() => togglePin(n)}
                    >
                      {n.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                    </Button>
                  )}
                  {(canEdit || mine) && (
                    <Button
                      size={sure === n.id ? "sm" : "icon"}
                      variant={sure === n.id ? "destructive" : "ghost"}
                      className={cn("rounded-full", sure !== n.id && "size-8")}
                      aria-label="Remove"
                      title="Remove"
                      onClick={() => remove(n)}
                    >
                      {sure === n.id ? "Remove?" : <Trash2 className="size-4" />}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Storage paths of a vendor's documents (removed when the vendor is deleted). */
export async function vendorFilePaths(vendorId: string): Promise<string[]> {
  const { data } = await supabase
    .from("vendor_notes")
    .select("file_path")
    .eq("vendor_id", vendorId)
    .not("file_path", "is", null);
  return (data ?? []).map((r) => r.file_path).filter((p): p is string => !!p);
}
