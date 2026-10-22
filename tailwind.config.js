/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      colors: {
        studio: {
          bg: 'var(--studio-bg)',
          panel: 'var(--studio-panel)',
          border: 'var(--studio-border)',
          accent: 'var(--studio-accent)',
          text: 'var(--studio-text)',
          muted: 'var(--studio-muted)',
        }
      }
    },
  },
  plugins: [],
};
