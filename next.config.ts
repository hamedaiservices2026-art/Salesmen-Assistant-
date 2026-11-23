import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "sharp"],
  async headers() {
    // Every page: no framing, no content sniffing, and the origin only as a referrer.
    const everywhere = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ];
    // Invite links carry a secret token in the path: never send it on to another site as a referrer.
    // Listed after the rule above so its Referrer-Policy is the one that applies on those paths.
    const noReferrer = [{ key: "Referrer-Policy", value: "no-referrer" }];
    return [
      { source: "/:path*", headers: everywhere },
      { source: "/invite/:path*", headers: noReferrer },
      { source: "/admin/invite/:path*", headers: noReferrer },
    ];
  },
  // The migrations are read from ./drizzle at run time; make sure a traced deployment ships them.
  outputFileTracingIncludes: { "/**": ["./drizzle/**"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
