import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCatalogue } from "@/lib/catalogue.functions";
import { CATALOGUE_URL, isAppHost } from "@/lib/hosts";
import { CatalogueError, CatalogueView, catalogueHead } from "@/components/CatalogueView";

/** Built-in catalogue path (used by previews). On the stockroom address it forwards to catalogue.sportagon.in. */
export const Route = createFileRoute("/catalogue")({
  beforeLoad: () => {
    if (isAppHost()) throw redirect({ href: CATALOGUE_URL });
  },
  loader: () => getCatalogue(),
  head: catalogueHead,
  component: function CatalogueRoute() {
    return <CatalogueView data={Route.useLoaderData()} />;
  },
  errorComponent: CatalogueError,
});
