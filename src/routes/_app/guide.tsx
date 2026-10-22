import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useInvalidate } from "@/lib/data";
import { Card, Code, PageHead, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/guide")({
  head: () => ({ meta: [{ title: "How to use · Sportagon Stockroom" }] }),
  component: GuidePage,
});

const Ol = ({ children }: { children: ReactNode }) => (
  <ol className="grid max-w-3xl list-decimal gap-1.5 pl-5 text-sm">{children}</ol>
);
const Ul = ({ children }: { children: ReactNode }) => (
  <ul className="grid max-w-3xl list-disc gap-1.5 pl-5 text-sm">{children}</ul>
);

const LESSONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "overview",
    title: "How the system works",
    body: (
      <>
        <p className="text-sm">
          Stockroom is the one place where products get their Sportagon code, price and stock. Zoho
          is updated from it — never the other way round.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {["Vendor bill", "Receive stock", "Photograph & tag", "Zoho export"].map((x, i) => (
            <span key={x} className="flex items-center gap-2">
              <span className="rounded-lg border bg-muted px-3 py-2 font-semibold">{x}</span>
              {i < 3 && <span className="font-black text-accent">→</span>}
            </span>
          ))}
        </div>
        <Ul>
          <li>
            <b>Receive stock</b> — everything that enters the store: vendor bills, opening counts,
            customer returns.
          </li>
          <li>
            <b>Products</b> — the master list with photos; open any code to see cost, price, stock
            and vendors.
          </li>
          <li>
            <b>Vendors</b> — onboarding with every Zoho field, plus each vendor's code map.
          </li>
          <li>
            <b>Zoho export</b> — files in Zoho's exact import layout.
          </li>
          <li>
            <b>Settings</b> — pricing, catalogue, team and code lists (owner/editors).
          </li>
        </Ul>
      </>
    ),
  },
  {
    id: "codes",
    title: "Reading a product code",
    body: (
      <>
        <p className="text-sm">
          Every product has a short public code and a friendly name. Both go on the tag.
        </p>
        <p className="text-sm">
          <Code>TC-1001</Code> = <b>T</b> division (Trophies) · <b>C</b> type (Cup) · <b>1001</b>{" "}
          running number. Name: <b>Champion Cup · 12in · Gold</b> — design name, size, finish. Every
          size and finish is its own code.
        </p>
        <Ul>
          <li>
            Codes never change and are never reused. Retire a product with Archive on its panel.
          </li>
          <li>The code carries no cost or vendor, so it is safe to show customers.</li>
        </Ul>
      </>
    ),
  },
  {
    id: "vendor",
    title: "Onboard a vendor",
    body: (
      <Ol>
        <li>Vendors → Onboard a vendor.</li>
        <li>Enter the display name and GSTIN — state, source of supply and PAN fill themselves.</li>
        <li>
          Check GST treatment (Registered business for most suppliers; Unregistered if no GSTIN).
        </li>
        <li>
          Add contact, address, payment terms and bank details. "Ready" means Zoho has everything.
        </li>
        <li>You can also choose "+ New vendor" while receiving their first bill.</li>
      </Ol>
    ),
  },
  {
    id: "receive",
    title: "Receive a vendor bill",
    body: (
      <Ol>
        <li>
          Receive stock → Vendor bill → vendor, bill number, date and the bill total before GST.
        </li>
        <li>Take a photo of the bill (or upload PDF/Excel, or paste text). AI fills the lines.</li>
        <li>
          Count the cartons. If fewer arrived, enter <b>Received</b> — only received units go into
          stock.
        </li>
        <li>
          Read the tags: <Pill tone="ok">Known</Pill> already mapped; <Pill tone="brand">New</Pill>{" "}
          a new product — check AI's details; <Pill tone="info">Link</Pill> a product you already
          stock from a new vendor/code.
        </li>
        <li>
          The bar at the bottom should say <Pill tone="ok">matches bill total</Pill>. If not, look
          for a missing line or a rate including GST.
        </li>
        <li>Review & receive → read the summary → Confirm receive.</li>
        <li>Add photos for new products, download the label sheet, tag every piece, shelve it.</li>
      </Ol>
    ),
  },
  {
    id: "newprod",
    title: "Set up new products correctly",
    body: (
      <Ul>
        <li>
          <b>Design family</b>: "New design" for a model you've never stocked; pick the existing
          design for another size/colour of it.
        </li>
        <li>
          Several sizes of one new model on the same bill: fill the first line, then "+ Another size
          / finish of this design".
        </li>
        <li>
          <b>Design name</b> must be distinctive — customers see it. "Aurora", "Titan Cup" ✓ ·
          "Memento", "Gold Cup Trophy" ✗ (only category words). One name belongs to one design.
        </li>
      </Ul>
    ),
  },
  {
    id: "other",
    title: "Opening stock and customer returns",
    body: (
      <Ul>
        <li>
          <b>Opening stock</b> — stock already on the shelf. Type the product code in the Code
          column with the counted quantity; add new products for items without a code.
        </li>
        <li>
          <b>Customer return</b> — type the code from the tag and the sellable quantity. Neither
          changes cost or vendor.
        </li>
      </Ul>
    ),
  },
  {
    id: "photos",
    title: "Product photos",
    body: (
      <Ol>
        <li>Right after receiving, each product on the receipt has Add photos / Take photo.</li>
        <li>Shoot on a plain background, front-on, tag visible. Up to 6 per product.</li>
        <li>
          Later: Products → open item → Add photos. ★ makes a photo the main one; × removes it.
        </li>
        <li>Products → Status "Needs attention" lists items without photos.</li>
      </Ol>
    ),
  },
  {
    id: "mistakes",
    title: "Fix a mistake safely",
    body: (
      <Ul>
        <li>
          Whole receipt wrong → Receive stock → Recent receipts → open it → Reverse this receipt.
        </li>
        <li>
          Damaged, lost or count differs → Products → open item → Stock → enter −2 or +3 with a
          reason.
        </li>
        <li>
          Vendor code matched the wrong product → "Not this product?" on the line, or Vendors → Code
          map → Unlink.
        </li>
        <li>Wrong design name → Products → open item → Design name (renames the whole family).</li>
        <li>
          No longer sold → Products → open item → Archive (hidden from list and catalogue, can be
          restored). Delete only works for items never received on a bill and with zero stock.
        </li>
      </Ul>
    ),
  },
  {
    id: "approvals",
    title: "Accounts and bill approvals",
    body: (
      <Ul>
        <li>
          There is no sign-up. The owner adds each person in Settings → Team & access and shares
          their login.
        </li>
        <li>
          If your bills need approval, finish the bill as usual and press Submit for approval. Stock
          and new codes appear only once it's approved.
        </li>
        <li>Sent back? Receive stock → My submitted bills → read the note → Fix & resubmit.</li>
        <li>
          Approvers see Bills waiting for approval at the top of Receive stock: Approve, Edit then
          approve, or Send back with a note.
        </li>
        <li>Change your own password in Settings → My account.</li>
      </Ul>
    ),
  },
  {
    id: "find",
    title: "Find a product for a customer",
    body: (
      <Ol>
        <li>Read the code on the tag, or type part of the name, in Products search.</li>
        <li>Match the item in hand against the photo.</li>
        <li>
          The panel shows price, floor price (lowest without approval) and bulk price for team
          orders.
        </li>
      </Ol>
    ),
  },
  {
    id: "pricing",
    title: "How prices are set",
    body: (
      <Ul>
        <li>Landed cost = unit cost + freight % + packaging.</li>
        <li>
          Selling price = landed × band multiplier: under ₹1,000 ×2.5, ₹1,000–₹2,000 ×2, ₹2,001+
          ×1.5 (Settings).
        </li>
        <li>Price on the tag = selling + GST.</li>
        <li>
          One item needs a different price? Products → item → Pricing → custom multiplier, margin or
          fixed price.
        </li>
      </Ul>
    ),
  },
  {
    id: "zoho",
    title: "Export to Zoho",
    body: (
      <Ol>
        <li>Zoho export → upload Zoho's sample import file once for vendors and for items.</li>
        <li>Download the Vendors file and import it in Zoho first, then the Items file.</li>
        <li>
          Zoho applies opening stock only to new items; record later stock via purchase bills or
          adjustments in Zoho.
        </li>
      </Ol>
    ),
  },
  {
    id: "catalogue",
    title: "The public catalogue",
    body: (
      <Ul>
        <li>
          Settings → Public catalogue shows the link to share. It updates live — no extra steps.
        </li>
        <li>
          It shows only active products from the ticked divisions (trophies by default): code, name,
          price, description and photos.
        </li>
        <li>Costs, vendors, stock and tax codes never appear.</li>
      </Ul>
    ),
  },
  {
    id: "rules",
    title: "Do's and don'ts",
    body: (
      <Ul>
        <li>Receive stock the day it arrives, before it goes on the shelf.</li>
        <li>Tag every piece before display.</li>
        <li>Don't create products in Zoho directly — create them here and export.</li>
        <li>Don't change pricing or code lists without the owner.</li>
      </Ul>
    ),
  },
];

function GuidePage() {
  const { userId } = useAuth();
  const inv = useInvalidate();
  const q = useQuery({
    queryKey: ["guide", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("guide_progress")
        .select("lesson_id")
        .eq("user_id", userId!);
      return new Set((data ?? []).map((x) => x.lesson_id));
    },
  });
  const done = q.data ?? new Set<string>();
  async function toggle(id: string) {
    const r = done.has(id)
      ? await supabase.from("guide_progress").delete().eq("user_id", userId!).eq("lesson_id", id)
      : await supabase.from("guide_progress").insert({ user_id: userId!, lesson_id: id });
    if (r.error) {
      toast.error(r.error.message);
      return;
    }
    inv("guide");
  }
  const pc = Math.round((done.size / LESSONS.length) * 100);
  return (
    <>
      <PageHead
        title="How to use"
        lede="Training for everyone who receives stock, answers customers or updates Zoho. Work through the lessons and tick each one off."
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong>Your progress</strong>
          <span className="text-sm text-muted-foreground">
            {done.size} of {LESSONS.length} lessons
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pc}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-accent" style={{ width: `${pc}%` }} />
        </div>
      </Card>
      <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="panel grid gap-0.5 p-2 lg:sticky lg:top-20" aria-label="Lessons">
          {LESSONS.map((l, i) => (
            <a
              key={l.id}
              href={`#g-${l.id}`}
              className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted"
            >
              <span>
                {i + 1}. {l.title}
              </span>
              {done.has(l.id) && <Check className="size-4 text-success" />}
            </a>
          ))}
        </nav>
        <div className="grid min-w-0 gap-4">
          {LESSONS.map((l, i) => (
            <Card key={l.id}>
              <div
                id={`g-${l.id}`}
                className="flex scroll-mt-24 flex-wrap items-center justify-between gap-2"
              >
                <h3 className="text-base font-bold">
                  {i + 1}. {l.title}
                </h3>
                <Button
                  size="sm"
                  variant={done.has(l.id) ? "outline" : "default"}
                  className="rounded-full"
                  onClick={() => toggle(l.id)}
                >
                  {done.has(l.id) ? "Done ✓" : "Mark as done"}
                </Button>
              </div>
              {l.body}
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
