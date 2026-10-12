import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath: process.env.GITHUB_PAGES === "true" ? "/opt" : undefined,
  trailingSlash: true,
};

export default nextConfig;
