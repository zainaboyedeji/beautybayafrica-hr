import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: the site is plain files on the host, and talks to the API.
  // cacheComponents / partialPrefetching need a server and cannot be used here.
  output: "export",
  images: {
    unoptimized: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
