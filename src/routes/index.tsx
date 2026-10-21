import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SEC Inventory · Sportagon" },
      { name: "description", content: "Inventory, product coding and pricing for Sportagon's sports-goods outlet." },
      { property: "og:title", content: "SEC Inventory · Sportagon" },
      { property: "og:description", content: "Inventory, product coding and pricing for Sportagon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="bg-hero flex min-h-screen items-center justify-center px-6">
      <div className="max-w-xl text-center text-primary-foreground">
        <p className="code-tag text-sm opacity-80">SPORTAGON</p>
        <h1 className="heading mt-3 text-4xl sm:text-6xl">SEC Inventory</h1>
        <p className="mt-4 opacity-90">Receive stock, issue product codes, price and export to Zoho. Setup in progress.</p>
      </div>
    </main>
  );
}
