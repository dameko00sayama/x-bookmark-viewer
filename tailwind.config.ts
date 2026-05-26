import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0f14",
        panel: "#111820",
        line: "#24303b",
        quiet: "#9aa9b7"
      }
    }
  },
  plugins: []
};

export default config;
