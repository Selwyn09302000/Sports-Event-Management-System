import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local persistence uses the Node 24 built-in `node:sqlite` driver, so there
  // is no native module to compile and no Python/build-tools requirement.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
};

export default nextConfig;
