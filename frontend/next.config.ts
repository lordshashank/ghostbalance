import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empty turbopack config to silence the Turbopack/webpack config error
  turbopack: {},
  async rewrites() {
    return [
      {
        source: "/crs/:path*",
        destination: "https://crs.aztec.network/:path*",
      },
    ];
  },
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

    // bb.js WASM should not be bundled server-side
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push("@aztec/bb.js");
    }

    return config;
  },
};

export default nextConfig;
