import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ai-agent/shared"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;