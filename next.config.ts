import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // /faq existed only as a nav placeholder in Phase 1/2 (always 404'd —
      // see DECISIONS.md); redirect it now that the real page lives at
      // /veelgestelde-vragen so any indexed/bookmarked link still resolves.
      { source: "/faq", destination: "/veelgestelde-vragen", permanent: true },
    ];
  },
  images: {
    // Placeholder gallery/hero images in this phase are locally authored SVGs
    // (no external fetching). Allow next/image to optimize local SVGs.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
