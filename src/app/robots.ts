import type { MetadataRoute } from "next";
import { canonicalSiteUrl } from "@/lib/platform/net";

export default function robots(): MetadataRoute.Robots {
  return {
    // /admin is behind requireAdmin(); crawlers have no business requesting it.
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/admin", "/api"] }],
    sitemap: `${canonicalSiteUrl()}/sitemap.xml`,
  };
}
