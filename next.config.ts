import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "*.e2b.app",
    "**.e2b.app",
    "*.e2b.dev",
    "**.e2b.dev",
    "*.vercel.app",
    "**.vercel.app",
    "*.app.github.dev",
    "**.app.github.dev",
    "*.csb.app",
    "*.replit.dev",
    "**.replit.dev",
  ],
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "images.pexels.com", pathname: "/**" },
    ],
  },
};

export default nextConfig;
