import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0b0d12",
        panel: "#12151c",
        accent: "#6c8eef",
      },
    },
  },
  plugins: [],
} satisfies Config;
