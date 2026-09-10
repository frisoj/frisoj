import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Placeholder gallery/hero images in this phase are locally authored SVGs
    // (no external fetching). Allow next/image to optimize local SVGs.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
