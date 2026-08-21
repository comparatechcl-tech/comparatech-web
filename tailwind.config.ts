import type { Config } from 'tailwindcss';

function withOpacity(varName: string) {
  return `rgb(var(${varName}) / <alpha-value>)`;
}

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: withOpacity('--color-bg'),
        surface: withOpacity('--color-surface'),
        surface2: withOpacity('--color-surface2'),
        border: 'var(--color-border)',
        accent: withOpacity('--color-accent'),
        blue: withOpacity('--color-blue'),
        blueDeep: withOpacity('--color-blue-deep'),
        mlYellow: withOpacity('--color-ml-yellow'),
        muted: withOpacity('--color-muted'),
        fg: withOpacity('--color-fg'),
        // Texto oscuro fijo para botones de color brillante (accent/mlYellow) --
        // no depende del tema, siempre necesita contraste oscuro encima.
        ink: '#0A0E17',
      },
      boxShadow: {
        glow: '0 0 40px -12px rgba(0,212,255,0.35)',
      },
      fontFamily: {
        heading: ['var(--font-inter)', 'sans-serif'],
        body: ['var(--font-inter)', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
