import type { NextConfig } from "next";

// Content-Security-Policy: only the third-party origins the app actually
// calls are allowlisted. Inline scripts (Next's own hydration data,
// JSON-LD <script type="application/ld+json"> blocks, and the GA4/Meta/
// TikTok snippets loaded post-consent) are same-origin/inline, so
// 'unsafe-inline' is scoped to script-src only where those run — a nonce
// would require wiring next.config → every inline <script> by hand across
// layout/JSON-LD/analytics, which is a larger change than this security
// pass covers; document as a follow-up in RUNBOOK.md/DECISIONS.md instead.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://*.supabase.co https://api.mollie.com https://www.google-analytics.com https://www.googletagmanager.com https://connect.facebook.net https://analytics.tiktok.com",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net https://analytics.tiktok.com",
  "frame-src 'self' https://*.mollie.com",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://*.mollie.com\")",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Every route except admin gets the same baseline headers; admin
        // additionally gets a hard noindex header (belt-and-braces on top
        // of the per-page `robots` metadata) since it's excluded from the
        // sitemap/robots.txt but should never be indexable even if crawled
        // directly.
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/admin/:path*",
        headers: [...securityHeaders, { key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
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
