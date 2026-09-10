import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Canonical host is www (see lib/site.ts's `site.url`) — redirect the
  // apex domain to it so there is exactly one indexable URL per page. See
  // DECISIONS.md ("www vs. non-www") for why www was chosen over the
  // reverse.
  async redirects() {
    return [
      { source: "/faq", destination: "/veelgestelde-vragen", permanent: true },
      {
        source: "/:path*",
        has: [{ type: "host", value: "purelitter.nl" }],
        destination: "https://www.purelitter.nl/:path*",
        permanent: true,
      },
    ];
  },
  // No trailing slash on any route (Next.js default) — kept explicit here
  // so the convention is documented rather than implicit.
  trailingSlash: false,
  images: {
    // Placeholder gallery/hero images in this phase are locally authored SVGs
    // (no external fetching). Allow next/image to optimize local SVGs.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
