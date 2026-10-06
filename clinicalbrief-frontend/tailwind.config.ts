import type { Config } from "tailwindcss";

const BRAND = {
  50: "#F4FAED", 100: "#E6F4D4", 200: "#CDEAA9", 300: "#B2EB76", 400: "#8FD14F", 500: "#5E9E1F",
  600: "#3F7308", 700: "#325C07", 800: "#24420A", 900: "#18280E", 950: "#0E1808",
};
const OLIVE = {
  50: "#F7F9F4", 100: "#EEF2E9", 200: "#DFE6D6", 300: "#C5D0B8", 400: "#95A386", 500: "#6B7A5C",
  600: "#4A5B38", 700: "#364429", 800: "#232E1A", 900: "#172012", 950: "#0B1209",
};

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Global green theme (matches the landing page): every blue/indigo utility renders in the brand
        // greens, and slate renders as olive-tinted neutrals. Semantic red / amber / green stay as they are.
        blue: BRAND,
        indigo: BRAND,
        slate: OLIVE,
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};
export default config;
