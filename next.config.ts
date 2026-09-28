import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lib/search.ts reads the corpus at runtime; ship it with the search route
  outputFileTracingIncludes: {
    "/api/search": ["./data/corpus.json"],
  },
};

export default nextConfig;
