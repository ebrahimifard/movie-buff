import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        obsidian: "#0B0B0C",
        charcoal: "#141518",
        bone: "#E9E4D8",
        gold: "#A98B55",
        oxide: "#7A2E2A",
        silver: "#9CA0A8"
      },
      backgroundImage: {
        "cinema-grid":
          "linear-gradient(rgba(233,228,216,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(233,228,216,0.05) 1px, transparent 1px)"
      },
      backgroundSize: {
        "cinema-grid": "32px 32px"
      },
      boxShadow: {
        halo: "0 0 0 1px rgba(169, 139, 85, 0.45), 0 16px 60px rgba(0, 0, 0, 0.4)"
      }
    }
  },
  plugins: []
};

export default config;
