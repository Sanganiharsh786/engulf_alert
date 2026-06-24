/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0e1a",
        panel: "#111726",
        panel2: "#0e1422",
        border: "#1e2840",
        ink: "#e8edff",
        muted: "#8b97b8",
        bull: "#26a69a",
        bear: "#ef5350",
        accent: "#3b82f6",
        gold: "#f1c40f",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
