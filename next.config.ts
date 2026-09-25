import type { NextConfig } from "next";

// Domaine court facultatif (ex. go.agence.fr) : <domaine>/<code> est servi par /l/<code>.
const shortHost = (process.env.NEXT_PUBLIC_SHORT_DOMAIN || "")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "");

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: { root: __dirname },
  async redirects() {
    if (!shortHost || !process.env.NEXT_PUBLIC_APP_URL) return [];
    // La racine du domaine court renvoie vers l'application
    return [{ source: "/", has: [{ type: "host", value: shortHost }], destination: process.env.NEXT_PUBLIC_APP_URL, permanent: false }];
  },
  async rewrites() {
    if (!shortHost) return [];
    return {
      beforeFiles: [
        { source: "/:code([A-Za-z0-9_-]{2,64})", has: [{ type: "host", value: shortHost }], destination: "/l/:code" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
