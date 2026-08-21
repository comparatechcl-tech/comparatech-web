'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // El tema real solo se conoce en el cliente (next-themes lo resuelve
  // después de hidratar) — antes de eso mostramos un espacio reservado del
  // mismo tamaño para no saltar el layout ni desincronizar con el servidor.
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-7 w-14" aria-hidden />;

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      className="flex h-7 w-14 shrink-0 items-center rounded-full border border-border bg-surface2 px-1 transition"
    >
      <Sun size={13} className={isDark ? 'text-muted' : 'text-mlYellow'} />
      <span
        className={`mx-1 h-5 w-5 shrink-0 rounded-full bg-accent shadow-glow transition-transform ${
          isDark ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
      <Moon size={13} className={isDark ? 'text-accent' : 'text-muted'} />
    </button>
  );
}
