import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Ensure root monorepo .env and .env.local are authoritatively loaded across Next.js server actions and API routes
loadEnvConfig(path.resolve(__dirname, "../.."));

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
