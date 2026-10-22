import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@crypto-bot/shared", "@crypto-bot/exchange", "@crypto-bot/trading"],
  redirects() {
    return Promise.resolve([
      {
        source: "/dashboard",
        destination: "/dashboard/chat",
        permanent: false
      }
    ]);
  }
};

export default nextConfig;

