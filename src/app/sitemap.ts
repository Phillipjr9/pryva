import type { MetadataRoute } from "next";

const routes = [
  "",
  "/virtual-numbers",
  "/esim",
  "/proxies",
  "/email-otp",
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
  return routes.map((route) => ({
    url: `${base}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route.startsWith("/pricing") ? 0.9 : 0.7,
  }));
}
