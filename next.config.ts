import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite is a runtime builtin — never try to bundle it.
  serverExternalPackages: ["node:sqlite"],
  // Opening the dev server from another device on the LAN: set
  // DEV_ORIGINS=192.168.1.20,phone.local to allow those hosts.
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean),
  experimental: {
    // Chat responses stream for minutes on long agent runs.
    proxyTimeout: 1000 * 60 * 10,
  },
};

export default nextConfig;
