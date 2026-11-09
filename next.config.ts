import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  ...(process.env.PROCONECT_SELF_HOSTED === "1" ? { output: "standalone", distDir: ".next-selfhost", outputFileTracingRoot: process.cwd() } : {}),
  webpack(config, { webpack }) {
    if (process.env.PROCONECT_SELF_HOSTED === "1") {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/, resolve(process.cwd(), "server/selfhost/env.mjs")));
    }
    return config;
  },
};

export default nextConfig;
