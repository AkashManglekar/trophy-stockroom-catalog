import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCatalogue } from "@/lib/catalogue.functions";
import { isCatalogueHost } from "@/lib/hosts";
import { CatalogueError, CatalogueView, catalogueHead } from "@/components/CatalogueView";

/** On catalogue.sportagon.in the home page is the public catalogue; elsewhere it opens the app. */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (!isCatalogueHost()) throw redirect({ to: "/receive" });
  },
  loader: () => getCatalogue(),
  head: catalogueHead,
  component: function Home() {
    return <CatalogueView data={Route.useLoaderData()} />;
  },
  errorComponent: CatalogueError,
});
