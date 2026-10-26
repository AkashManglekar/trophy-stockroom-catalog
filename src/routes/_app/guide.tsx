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
            <b>Dashboard</b> — sales, margin, stock value, what to reorder, bills due and enquiries.
          </li>
          <li>
            <b>Receive</b> — vendor bills and new items with no bill; bills waiting for approval.
          </li>
          <li>
            <b>Bills</b> — every bill with its lines, charges and GST; payments, due dates and
            delivery ratings. The owner can edit, reverse or delete a bill.
          </li>
          <li>
            <b>Products</b> — one listing per design with its sizes; open any code for cost, price,
            stock, bills and photos. Opening stock, returns and counts are stock adjustments here.
          </li>
          <li>
            <b>Sales</b> — Zoho invoices and credit notes that take stock out or put it back.
          </li>
          <li>
            <b>Enquiries</b> — quote requests from the public catalogue.
          </li>
          <li>
            <b>Vendors</b> — onboarding with every Zoho field, code map, business and ratings.
          </li>
          <li>
            <b>Zoho</b> — vendor and item files in Zoho's exact import layout.
          </li>
          <li>
            <b>Settings</b> — pricing, catalogue, company GST, team and code lists (owner/editors).
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
          Every design has a short public code and a name. Both go on the tag, with the size.
        </p>
        <p className="text-sm">
          <Code>TC-1001</Code> = <b>T</b> division (Trophies) · <b>C</b> type (Cup) · <b>1001</b>{" "}
          running number. One code per design: every size of Champion Cup is <Code>TC-1001</Code>.
        </p>
        <p className="text-sm">
          Each size has its own price, stock and SKU — <Code>TC-1001-12</Code> is the 12in,{" "}
          <Code>TC-1001-16</Code> the 16in. Tag pieces with the product code and size; the SKU is
          the barcode and the Zoho SKU. A new size of an existing design keeps the same code.
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
          Receive → Vendor bill → vendor, bill number, date and the bill total before GST. Add
          freight or packing under Charges and pick IGST or CGST + SGST; set the GST % on each line.
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
    id: "multivendor",
    title: "Same product from several vendors",
    body: (
      <Ul>
        <li>
          A trophy you already stock, billed by a second vendor under their own code: on the bill
          line pick <b>Same as an existing product</b> and choose your code. It stays one product —
          one listing on Products and the catalogue — and that vendor's code maps to it from then
          on.
        </li>
        <li>
          The product's cost and selling price follow the <b>lowest current price</b> among the
          vendors you buy from (each vendor's latest bill). Vendors marked Paused, Exited or
          Archived don't count.
        </li>
        <li>
          Product page → <b>Sourcing</b>: every vendor, their code, latest and average price, units
          bought, and who is <b>best to order from next</b>.
        </li>
        <li>
          Already created two codes for the same item? Open the one to retire →{" "}
          <b>Same item as another code?</b> → pick the code to keep → Link. Stock, bills, vendor
          prices, photos and sales move across; the old code still finds it in Zoho and on bills.
        </li>
      </Ul>
    ),
  },
  {
    id: "reorder",
    title: "Low-stock reminders and what to order",
    body: (
      <Ul>
        <li>
          Settings → <b>Low-stock reminders</b>: per category, "remind at or below" and "order up
          to". A product can override it on its page (blank = category, 0 = never).
        </li>
        <li>
          Dashboard → <b>Order next</b> lists what's low, grouped by the best vendor, with a
          suggested quantity (up to your target, at least the vendor's MOQ). <b>Copy order</b> gives
          a message for WhatsApp or email.
        </li>
        <li>
          <b>Ordered</b> hides it until that stock arrives on a bill; <b>Ignore</b> hides it for a
          week, 30 days, 3 months or for good.
        </li>
      </Ul>
    ),
  },
  {
    id: "drafts",
    title: "Park a bill as a draft",
    body: (
      <Ul>
        <li>
          Stuck on a bill (price query, missing items)? <b>Save draft</b> at the bottom, note what's
          pending, and the page clears for the next bill.
        </li>
        <li>
          Saved drafts sit at the top of Receive for the whole team. <b>Open</b> picks it up where
          you left it (the bill you're on is saved first); receiving or submitting it removes the
          draft.
        </li>
      </Ul>
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
          <b>Medals</b> (and any type ticked “Colour variants” in Settings → Product types): one
          product code per design, sized in inches (2, 2.5, 2.75…), every size × colour is its own
          variant with its own stock and price — e.g. TM-1001-2.5-GD, TM-1001-2.5-SV,
          TM-1001-2.5-BZ. On the bill use <b>Sizes &amp; colours</b> (or “Several sizes / colours —
          one entry” on a line): type the details once, list the sizes (2, 2.5, 3), tick Gold /
          Silver / Bronze and enter the quantity in each cell of the grid. Costs: one default, a
          cost per size (row “Cost ₹ / size”), or a cost in any cell — each variant’s selling price
          is worked out from its own cost. The product page shows a colour × size grid; the
          catalogue lets customers pick colour and size.
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
          These are <b>stock adjustments</b>, not bills. Products → <b>Adjust stock</b> → pick the
          reason (Opening stock, Customer return, Physical count, Damaged…) → type or scan each
          product code and the quantity → Save. One product? Open it → Stock → Add, Remove or Set
          count.
        </li>
        <li>
          <b>Set count</b> sets stock to what you counted; Add and Remove change it by the quantity.
          Every change is logged on the product with who, when and why. None of them change cost or
          vendor.
        </li>
        <li>
          Item on the shelf with no code yet? Receive stock → <b>New items (no bill)</b> creates its
          code and opening stock.
        </li>
        <li>
          <b>Internal stock</b> (Sportagon caps, staff T-shirts, marketing material): open the
          product → Public catalogue → <b>Internal only</b>. It stays in stock and costs, but never
          shows on the catalogue or in quotes. When receiving a new design, pick “Internal only”
          under Catalogue. Hand-outs: Adjust stock → Remove → Marketing / giveaway or Staff use.
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
          Bill wrong → <b>Bills</b> → open it. The owner can <b>Edit</b> (vendor, bill no., date,
          charges, GST, each line's cost and quantities), <b>Reverse</b> (takes its stock out, keeps
          history) or <b>Delete</b> it.
        </li>
        <li>
          Damaged, lost or count differs → Products → open item → Stock → Remove or Set count with a
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
    id: "money",
    title: "Sales, enquiries and paying vendors",
    body: (
      <Ul>
        <li>
          <b>Sales</b> come from Zoho Books: each invoice takes stock out, credit notes put it back,
          voided or edited invoices correct themselves. Sales → Sync now, or Import Zoho export.
          Match any Zoho item the app couldn't recognise once, under “Zoho items to match”.
        </li>
        <li>
          <b>Enquiries</b> arrive from “Request quote” on the public catalogue. Call or WhatsApp
          from the enquiry, then move it to contacted → quoted → won or lost.
        </li>
        <li>
          <b>Paying vendors</b>: Bills → open the bill → Record payment (amount, date, mode, UTR).
          Due dates come from the vendor's payment terms. “To pay” and “Overdue” filters show what's
          outstanding; each vendor page shows total business, paid, owed and their rating.
        </li>
        <li>
          <b>Vendor notes &amp; documents</b>: Vendors → open the vendor → Notes, links &amp;
          documents. Keep their catalogue link, price lists, agreements and notes in one place
          (files up to 25 MB, private to the team).
        </li>
        <li>
          After a delivery, <b>Rate this delivery</b> on the bill — quality, delivery and pricing —
          so vendor scorecards stay honest.
        </li>
        <li>
          <b>Dashboard</b>: sales and margin this month, stock value, what to reorder, slow movers,
          bills due and the enquiry pipeline.
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
        <li>
          Landed cost = unit cost + that product's share of the bill's charges (freight, packing…).
          Items received without charges use the division's freight % and packaging instead.
        </li>
        <li>
          Selling price = landed × band multiplier: under ₹1,000 ×2.5, ₹1,000–₹2,000 ×2, ₹2,001+
          ×1.5 (Settings).
        </li>
        <li>
          Medals (and any type added under Settings → Price bands by product type) use their own
          bands instead of the main ones.
        </li>
        <li>
          Price on the tag = selling + GST. The GST % is the one entered on the product's bill line;
          the owner or an editor can change it on the product (Selling GST), and “Follow bill” goes
          back to the bill's rate. When the GST changes on a product already priced, its MRP stays
          the same and the price before GST adjusts (shown as “Fixed MRP”).
        </li>
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
        <li>Zoho → upload Zoho's sample import file once for vendors and for items.</li>
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
      return (data ?? []).map((x) => x.lesson_id);
    },
  });
  const done = new Set<string>(Array.isArray(q.data) ? q.data : []);
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
