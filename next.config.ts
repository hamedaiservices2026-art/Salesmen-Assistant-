import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  // The upload action takes a file of up to 2 MB (checked there); the framework default of 1 MB would refuse it first.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  // Invite links carry a secret token in the path: never send it on to another site as a referrer.
  async headers() {
    const noReferrer = [{ key: "Referrer-Policy", value: "no-referrer" }];
    return [
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
