import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/** Public, customer-facing address: shows only the catalogue — no login, no app. */
export const CATALOGUE_HOST = "catalogue.sportagon.in";
export const CATALOGUE_URL = `https://${CATALOGUE_HOST}`;
/** Staff address: stockroom, receiving, settings. */
export const APP_HOST = "sgninv.sportagon.in";

/** Host name of the current request (server) or page (browser), lower-case, without port. */
export const currentHost = createIsomorphicFn()
  .server(() => {
    const h = getRequest().headers;
    return (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]!.trim();
  })
  .client(() => window.location.host);

const hostName = () => (currentHost() ?? "").toLowerCase().split(":")[0];
export const isCatalogueHost = () => hostName() === CATALOGUE_HOST;
export const isAppHost = () => hostName() === APP_HOST;

/** Where staff should open the public catalogue from inside the app. */
export function publicCatalogueUrl(): string {
  if (typeof window === "undefined") return CATALOGUE_URL;
  const h = window.location.hostname;
  // Previews and local runs use the built-in /catalogue path.
  return h.endsWith("sportagon.in") ? CATALOGUE_URL : `${window.location.origin}/catalogue`;
}
