// Patch global fetch to proxy CRS requests through Next.js rewrites,
// avoiding CORS issues with crs.aztec.network.
const CRS_ORIGIN = "https://crs.aztec.network/";

let patched = false;

export function patchCrsFetch() {
  if (patched || typeof window === "undefined") return;
  patched = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith(CRS_ORIGIN)) {
      const proxied = input.replace(CRS_ORIGIN, "/crs/");
      return originalFetch(proxied, init);
    }
    if (input instanceof Request && input.url.startsWith(CRS_ORIGIN)) {
      const proxied = input.url.replace(CRS_ORIGIN, "/crs/");
      return originalFetch(new Request(proxied, input), init);
    }
    return originalFetch(input, init);
  };
}
