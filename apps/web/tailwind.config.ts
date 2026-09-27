import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b0d12",
          900: "#10131b",
          800: "#171b26",
          700: "#202636",
          600: "#2b3247",
        },
        celia: {
          300: "#8bd8ff",
          400: "#4cc2ff",
          500: "#1eaaef",
          600: "#0b87c9",
        },
      },
    },
  },
  plugins: [],
};
export default config;
