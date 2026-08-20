import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#070B14',
        surface: '#0B1220',
        surface2: '#101827',
        border: 'rgba(255,255,255,0.08)',
        accent: '#00D4FF',
        blue: '#087EFF',
        blueDeep: '#063B8F',
        mlYellow: '#FFE600',
        muted: '#94A3B8',
      },
      boxShadow: {
        glow: '0 0 40px -12px rgba(0,212,255,0.35)',
      },
      fontFamily: {
        heading: ['var(--font-space-grotesk)', 'sans-serif'],
        body: ['var(--font-inter)', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
