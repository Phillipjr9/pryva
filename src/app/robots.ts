import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    // /admin is behind requireAdmin(); crawlers have no business requesting it.
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/admin", "/api"] }],
    sitemap: "https://pryva.ng/sitemap.xml",
  };
}
