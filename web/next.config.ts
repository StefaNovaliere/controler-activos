import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El panel lee y escribe datos que cambian cada 30 min: nada que prerenderizar.
  reactStrictMode: true,
};

export default nextConfig;
