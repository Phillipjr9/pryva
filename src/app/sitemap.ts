import type { MetadataRoute } from "next";
import { blogPosts } from "@/lib/blog";

const routes = [
  "",
  "/virtual-numbers",
  "/esim",
  "/proxies",
  "/email-otp",
  "/accounts",
  "/digital-services",
  "/blog",
  // These were published pages that no route list mentioned: the help centre
  // was only linked from transactional email, and customer feedback from
  // nowhere at all.
  "/help",
  "/testimonials",
  "/status",
  "/terms",
  "/privacy",
  "/refund-policy",
  "/cookie-policy",
  "/pricing",
  "/how-it-works",
  "/about",
  "/faq",
  "/contact",
  "/login",
  "/signup",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://pryva.ng";
  const staticRoutes = routes.map((route) => ({
    url: `${base}${route}`,
    lastModified: new Date(),
    changeFrequency: (route === "" ? "weekly" : "monthly") as "weekly" | "monthly",
    priority: route === "" ? 1 : route.startsWith("/pricing") ? 0.9 : 0.7,
  }));
  const posts = blogPosts.map((post) => ({
    url: `${base}/blog/${post.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
  return [...staticRoutes, ...posts];
}
