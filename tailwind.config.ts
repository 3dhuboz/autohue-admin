import type { Config } from 'tailwindcss';
import path from 'path';

const root = path.resolve(__dirname);

const config: Config = {
  content: [
    path.join(root, 'src/**/*.{js,ts,jsx,tsx}'),
    path.join(root, 'index.html'),
    path.join(root, 'public/**/*.html'),
  ],
  theme: {
    extend: {
      colors: {
        racing: {
          50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5',
          400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c',
          800: '#991b1b', 900: '#7f1d1d', 950: '#450a0a',
        },
        carbon: {
          50: '#1a1a1a', 100: '#171717', 200: '#141414', 300: '#111111',
          400: '#0e0e0e', 500: '#0a0a0a', 600: '#080808', 700: '#050505',
          800: '#030303', 900: '#010101', 950: '#000000',
        },
      },
      fontFamily: {
        heading: ['Space Grotesk', 'sans-serif'],
        body: ['Outfit', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
