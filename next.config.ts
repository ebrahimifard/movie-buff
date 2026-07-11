import type { NextConfig } from "next";

// Posters are downloaded locally by scripts/download-posters.mjs and served
// from public/posters/ — no remote image hosts are ever loaded at runtime.
const nextConfig: NextConfig = {};

export default nextConfig;
