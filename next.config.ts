import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["pg", "@meteora-ag/dynamic-bonding-curve-sdk", "@meteora-ag/cp-amm-sdk"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "same-origin" },
    ] }];
  },
};
export default config;
