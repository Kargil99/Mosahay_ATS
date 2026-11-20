import type { NextConfig } from "next";

const configuredApiOrigin = process.env.API_PROXY_ORIGIN?.trim()
  || (process.env.NODE_ENV === "production" ? "https://mosahay-ats.vercel.app" : "");
const apiOrigin = configuredApiOrigin
  ? (configuredApiOrigin.startsWith("http") ? configuredApiOrigin : `https://${configuredApiOrigin}`).replace(/\/+$/, "")
  : "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (!apiOrigin) return [];
    return [{ source: "/api/v1/:path*", destination: `${apiOrigin}/api/v1/:path*` }];
  },
};

export default nextConfig;
