import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The live preview uses an ephemeral `PORT-*.e2b.app` origin.
  allowedDevOrigins: ["*.e2b.app"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.pexels.com", pathname: "/**" },
    ],
  },
};

export default nextConfig;
