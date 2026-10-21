# Trophy Stockroom Catalog

Build "SEC Inventory" for Sportagon — an inventory, product-coding and pricing system for a sports-goods sales outlet (trophies, apparel, sports infrastructure material), plus a public trophy catalogue. Use Lovable Cloud (database, auth, file storage). This replaces a working prototype; replicate the behaviour below exactly.

## Brand
Primary deep blue #0B2E8A, accent electric cyan #00B3D6. Montserrat (800/900 uppercase, tight tracking for headings; 400/500 body); IBM Plex Mono for product codes. Radius 12px. Cards lift on hover. Light and dark themes. Fully responsive: desktop top nav with text tabs; on phones (<720px) a fixed bottom tab bar with icons + short labels (Receive, Products, Vendors, Zoho, Settings, Guide), badge counts on icons, detail panels open full-screen with a Back button. Nothing may overflow horizontally at 320px; long names/codes wrap, codes never break mid-code.

## Auth & roles
Email login. Roles: owner/editor (everything incl. Settings, pricing, code lists, clearing data), contributor (receive stock, edit products, upload photos, adjust stock), viewer (read-only). Record who did every receipt, reversal and adjustment.

## Code system
Each sellable item (every size and finish) gets:
- Public Product Code: Division letter + Type letter + "-" + running number from 1001 per prefix, auto-issued, never reused, never edited. E.g. TC-1001 = Trophy Cup. Printed on tags, used as Zoho SKU and barcode.
- Friendly Name (public): "<Design name> · <size> · <finish>", e.g. "Champion Cup · 12in · Gold".
- Spec Code (internal, never printed): DIV-TYPE-MAT-SPORT-DESIGN(3 digits)-SIZE(3)-FINISH, e.g. TR-CUP-MT-CRK-001-012-GD. Design number groups a family (all sizes/finishes of one physical design = Zoho Item Group).

Seed code lists (editable in Settings, owner only):
- Divisions (code, name, public letter): TR Trophies & Awards T; AP Apparel A; IN Infrastructure Material I; SV Services S; EQ Sports Equipment E.
- Types (div, code, name, public letter, size unit, UoM, HSN, GST): TR: CUP Cup Trophy C in pcs 83062920 18%; FIG Figure Trophy F in; DIA Diamond Trophy D in 70139900; STR Star Trophy S in; COL Tower Trophy T in; MOM Memento E in 39264049; PLQ Plaque P in 44209090; SHD Shield H in; MED Medal M mm; RIB Medal Ribbon R mm 58063200; BDG Badge B mm 71179090; TOP Trophy Topper X in; BAS Trophy Base Y in 44209090 (others 83062920, all 18%). AP (size unit = size code, GST by price rule): JRS Jersey J 6110; TSH T-Shirt T 6109; POL Polo P 6105; SHT Shorts S 6104; TRK Track Pant R 6103; JKT Jacket W 6201; CAP Cap C 6505; SCK Socks O pair 6115; KIT Kit Set K set 6112. IN: TRF Artificial Turf T mm sqft 57033090 18%; NET Sports Net N ft sqft 95069990 5%; FLR Sports Flooring F mm sqft 39181090 18%; GPT Goal Post Set G none set 95069990 5%; LGT Flood Light L W pcs 94054900 18%; FEN Fencing C ft sqft 73141990 18%; MAT Sports Mat M mm 95069190 18%; MRK Line Marking Paint P none ltr 32089090 18%. SV (service, SAC, 18%, no size): ENG Engraving E 998898; PRN Logo Printing P 998912; NAM Name & Number Printing N 998912; LOG Logo Plate L 998898; ASM Trophy Assembly A 998898; INS Installation I sqft 995468.
- Materials: MT Metal, BR Brass, ST Steel, WD Wood, FB Fibre, GL Glass, CR Crystal, AC Acrylic, RS Resin, MX Mixed, DF Dri-fit Polyester, PL Polyester, CT Cotton, CB Cotton Blend, LY Lycra, NY Nylon, PE Polyethylene, PP Polypropylene, PU Polyurethane, PV PVC, RB Rubber, GI Galvanised Iron, AL Aluminium, NA Not applicable.
- Sports: GEN Generic, MUL Multi-sport, CRK Cricket, FTB Football, BDM Badminton, BSK Basketball, VLB Volleyball, TTN Table Tennis, TNS Tennis, PKL Pickleball, KBD Kabaddi, HKY Hockey, ATH Athletics, CHS Chess, CRM Carrom, SWM Swimming, SKT Skating, BOX Boxing, YGA Yoga, ESP Esports, GLF Golf, COR Corporate.
- Finishes: GD Gold, SV Silver, BZ Bronze, RG Rose Gold, AN Antique, CH Chrome, CL Clear, FR Frosted, NT Natural, BK Black, WH White, BL Blue, NV Navy, RD Red, MR Maroon, GN Green, YL Yellow, OR Orange, GY Grey, PK Pink, PR Purple, MC Multi-colour, NA.
- Apparel sizes: XSM XS, SML S, MED M, LRG L, XLG XL, 2XL, 3XL, 4XL, K22–K34 Kids, FRE Free Size.
Size stored as 3-digit number for in/mm/ft/W units (12 → 012), size code for apparel, 000 for none. Adding a type must enforce a unique public letter within its division.

Naming rules: every non-service product needs a Design Name. Reject names made only of category/material/sport/finish/size words or generic words (trophy, award, sports, design, etc.) — "Memento", "Gold Cup Trophy" rejected; "Aurora", "Titan Cup" accepted. One design name belongs to exactly one design family; sizes/finishes of the family share it (Aurora · 10in and Aurora · 12in allowed). Exact duplicate friendly names blocked (offer "Link to existing instead"). Renaming applies to the whole family.

## Pricing
Landed cost = unit cost × (1 + freight %) + packaging ₹ (per division: TR 5%/₹20, AP 4%/₹15, IN 6%/₹0, SV 0/0, EQ 4%/₹10).
Default selling rule — multiplier bands on landed cost (editable, add/remove bands, owner only): landed < ₹1,000 → ×2.5; ₹1,000–₹2,000.99 → ×2; ≥ ₹2,001 → ×1.5. Option: multiplier gives price before GST (default) or MRP incl. GST. Option per division: use bands or target margin (TR 45%, AP 40%, IN 25%, SV 70%, EQ 30%; type overrides MED 50, DIA 50, TOP 35, BAS 35, ENG 75, TRF 22). Optional "edge protection" toggle: never price an item below the top of the band beneath it.
Rounding up per division: TR/AP/EQ ₹10, IN ₹1, SV ₹5. MRP = selling × (1+GST) rounded up. Apparel GST: 5% if selling ≤ ₹2,500/piece else 18% (editable). Floor price = landed ÷ (1 − floor margin) (TR 30%, AP 25%, IN 15%, SV 50%, EQ 18%), never above selling. Bulk price = selling × (1 − bulk %) (TR 10%, AP 12%, IN 5%, SV 20%, EQ 8%) at min qty (25/15/500/25/10), never below floor.
Per-product override: Automatic / Custom multiplier / Custom margin % / Fixed selling price. Show which rule priced each product; flag "below cost".

## Vendors (Zoho-ready onboarding)
Vendor code V001, V002… Fields: display name*, company, salutation, first/last name, email, phone, mobile, website; GST treatment* (business_registered_regular, business_registered_composition, business_unregistered, business_sez, overseas, consumer), GSTIN, source of supply* (Indian state codes), PAN, MSME/Udyam; billing attention, street 1/2, city, state, PIN, country (India); payment terms (Due on Receipt, Advance, Net 7/15/30/45/60) and currency INR; bank holder, bank, account no., IFSC; divisions supplied, lead time, MOQ, status (Prospect/Sample/Approved/Active/Paused/Exited), quality 1–5, notes. Entering a valid GSTIN auto-fills state, source of supply and PAN. Validate GSTIN, PAN, IFSC, 6-digit PIN, email. Show "Ready" vs "N missing" for Zoho. Block duplicate name or GSTIN. Each vendor shows its code map (their item code → our product code, last cost) with Unlink.

## Receive stock (main workflow)
Three receipt types: Vendor bill, Opening stock, Customer return. Steps: Source → Lines → Check & receive.
- Header: vendor (or "+ New vendor" with the full onboarding form inline), bill no., date, bill total before GST (cross-check).
- Add lines by: uploading a bill photo (camera on mobile), PDF, Excel/CSV, or pasted text — use AI (Lovable AI) to extract vendor name/GSTIN, bill no., date, and lines {vendor item code, description, qty, unit cost ex-GST}; or add lines manually.
- Matching: if the code typed is one of our product codes → match it; else if (vendor, vendor item code or normalised description) was seen before → "Known", maps automatically. Otherwise "New" (AI pre-fills division/type/material/sport/size/finish/design name; mark "Filled by Claude/AI · check") or "Link" to an existing product (searchable by code or name). "Not this product?" unlinks a wrong match. Show product thumbnail on matched lines.
- Per line: billed qty, received qty (only received goes to stock; flag "short"), unit cost, SEC shelf location. Warnings (non-blocking): cost changed >25% vs last (show MRP impact), received > billed, ₹0 cost, discontinued product. Errors block: missing fields, naming rules, duplicates.
- New lines: design family select (New design / existing design of same DIV-TYPE-MAT-SPORT / "Same new design as line #n"), "+ Another size/finish of this design", "Copy details from line above". Preview shows the code to be issued, friendly name, MRP and price rule.
- Sticky summary bar: lines, units, value ex-GST, new codes, checks, and whether value matches bill total. "Review & receive" → confirmation summary → "Confirm receive".
- Block re-receiving the same vendor + bill number.
- Saving is atomic and concurrency-safe (DB transaction / row locks): issue sequential codes without gaps or collisions, increment stock using current DB values, remember every vendor code mapping, update cost/preferred vendor on bill receipts, record the receipt with who/when.
- After receive: success card with new codes, "Add photos / Take photo" per product, "Download label sheet" (Excel: code, friendly name, MRP, labels to print = qty received, location, barcode value = code), Export to Zoho.
- Recent receipts list (cards on mobile) with lines, billed vs received, label sheet, and "Reverse this receipt" (removes its stock, discontinues codes it created if their stock hits 0, logged as adjustments). Draft receipt auto-saves.

## Products
Photo grid view (default) and list view; search by code, name, spec, vendor code; filters: division, status (Active, Draft, Clearance, Discontinued, Needs attention = missing name/cost/location/photo, low stock, below cost). Product detail: large main photo + up to 6 photos (upload multiple, take photo, set main ★, remove ×, drag-drop, lightbox), copy code, spec breakdown, money (unit cost, landed, rule, selling, MRP, floor, bulk, margin), sources (vendors + their codes), stock with adjustments (±qty with reason: Damaged, Lost, Physical count correction, Used for display, Gifted/sample, Other; history with who), pricing override, edit fields (status, design name, reorder point, cost, location, award class, customisable, description). Photos resized client-side to ≤1400px JPEG.

## Zoho export
Two full-refresh files (xlsx/csv): Vendors first, then Items. User can upload Zoho's sample import file per type; the export then uses exactly its column headers and order, auto-mapping by header name with a per-column mapping editor; otherwise use standard headers. Items columns: Item Name (friendly), SKU (code), Unit, Item Type (Inventory / Sales and Purchases), Product Type (goods/service), Description, Rate (selling ex-GST), Account Sales, Purchase Rate, Purchase Account Cost of Goods Sold, Purchase Description, Inventory Account, Opening Stock, Opening Stock Rate (landed), Reorder Point, Preferred Vendor, HSN/SAC, Taxable, Intra State Tax Name GST<rate>/Rate, Inter State Tax Name IGST<rate>/Rate, Category Name (type name), Status, plus CF.Spec Code, CF.Family Code, CF.Division, CF.Material, CF.Sport, CF.Size, CF.Finish, CF.Vendor Item Code, CF.Landed Cost, CF.MRP, CF.Floor Price, CF.Bulk Price, CF.Bulk Min Qty, CF.SEC Location, CF.Image Link. Vendors columns: Display Name, Company Name, Salutation, First Name, Last Name, EmailID, Phone, MobilePhone, Website, GST Treatment, GST Identification Number (GSTIN), Source of Supply, PAN Number, MSME/Udyam No, Currency Code, Payment Terms, Payment Terms Label, Billing Attention/Address/Street2/City/State/Country/Code/Phone, Notes, Status, CF.Vendor Code, CF.Lead Time Days, CF.MOQ, CF.Divisions Supplied. Show last export time and records changed since.

## Settings (owner/editor only)
Selling price rule (bands editor with worked examples, basis, divisions, edge protection), division pricing table, apparel GST rule, types & public letters list + add type, other code lists + add code, one-click Excel backup (products, vendors, vendor codes, receipts, adjustments).

## Public trophy catalogue
A public, no-login, read-only page at /catalogue (shareable link, SEO-friendly, works on any device). Show only Active products from divisions selected in settings (default Trophies & Awards only). Fields shown: Code, Name (friendly name), Price (MRP, labelled just "Price" — never mention GST, HSN, tax codes; strip any HSN/SAC/GST references from descriptions), Description, and all photos (swipeable gallery per card with dots, arrows on desktop, full-screen lightbox with name and price; "Photo coming soon" placeholder). Header: Sportagon logo (uploadable in settings; fallback wordmark "SPORTAGON") and title "Trophy catalogue" — do not say "Experience Center". Search by code or name, chips by trophy type with counts, 2 cards per row on phones, 3 on tablet, 4 on desktop. Footer: Enquiries — play@sportagon.in, +91 83088 84539, www.sportagon.in; "Prices and availability may change. Engraving and customisation are quoted separately." Never expose cost, vendor, stock or internal data in public API responses (use a restricted view/RLS).

## Training guide
An in-app "How to use" page with lessons and per-user progress: how the system works, reading a code, onboarding a vendor, receiving a bill, setting up new products & naming, opening stock and returns, product photos, fixing mistakes safely, finding a product for a customer, exporting to Zoho, pricing, updating the public catalogue, fixing warnings, do's and don'ts.

Start with seed code lists and a few clearly-marked sample products/vendors that can be cleared from Settings.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/88447cad-8da4-461f-9aab-4a72d3c52080).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
