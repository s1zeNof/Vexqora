import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@crypto-bot/shared", "@crypto-bot/exchange", "@crypto-bot/trading"]
};

export default nextConfig;

