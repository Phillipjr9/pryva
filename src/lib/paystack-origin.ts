import { isLocalHost } from "@/lib/net";

/** A return URL must be an origin, and public deployments must use HTTPS. */
export function paystackAppOrigin(value: string, allowLocalHttp: boolean): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !url.hostname) return null;
    if (url.protocol !== "https:" && !(allowLocalHttp && url.protocol === "http:" && isLocalHost(url.host))) return null;
    return url.origin;
  } catch {
    return null;
  }
}
