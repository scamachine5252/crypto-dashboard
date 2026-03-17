import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['ccxt'],
  turbopack: {},
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'protobufjs/minimal': false,
      }
    }
    return config
  },
};

export default nextConfig;
