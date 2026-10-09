import {
  Armchair,
  Flame,
  Gamepad2,
  Headphones,
  Info,
  Laptop,
  Package,
  Scale,
  Smartphone,
  Tv,
  WashingMachine,
  type LucideIcon,
} from 'lucide-react';

/**
 * Iconos de categorías y secciones, todos con el mismo lenguaje: una ficha
 * de color con el dibujo en blanco.
 *
 * Antes la portada mezclaba cuatro ilustraciones con cuatro iconos de línea
 * (y los audífonos ilustraban "Electrónica" mientras "Audio" tenía un icono
 * genérico), y el menú usaba otros distintos. Con un solo mapa, una
 * categoría se reconoce por su color en la portada, en el menú y en su
 * página, y una categoría nueva tiene icono desde el primer día.
 *
 * Sin estado ni efectos: se usa igual desde servidor y desde cliente.
 */

export interface IconStyle {
  icon: LucideIcon;
  /** Colores del degradado de la ficha, de arriba a la izquierda a abajo a la derecha. */
  from: string;
  to: string;
  /** Dibujo oscuro en vez de blanco, para fichas claras (amarillo). */
  ink?: boolean;
}

const CATEGORY_ICONS: Record<string, IconStyle> = {
  celulares: { icon: Smartphone, from: '#22d3ee', to: '#2563eb' },
  computacion: { icon: Laptop, from: '#c084fc', to: '#7e22ce' },
  audio: { icon: Headphones, from: '#34d399', to: '#047857' },
  gaming: { icon: Gamepad2, from: '#f472b6', to: '#be185d' },
  electronica: { icon: Tv, from: '#818cf8', to: '#3730a3' },
  hogar: { icon: Armchair, from: '#fdba74', to: '#ea580c' },
  electrodomesticos: { icon: WashingMachine, from: '#94a3b8', to: '#475569' },
};

/** Categoría sin icono propio todavía: gris neutro, nunca un hueco. */
const FALLBACK_ICON: IconStyle = { icon: Package, from: '#94a3b8', to: '#475569' };

export const OFERTAS_ICON: IconStyle = { icon: Flame, from: '#fb923c', to: '#e11d48' };
export const COMPARADOR_ICON: IconStyle = { icon: Scale, from: '#fde047', to: '#f59e0b', ink: true };
export const NOSOTROS_ICON: IconStyle = { icon: Info, from: '#38bdf8', to: '#0369a1' };
/** Color de la marca, para iconos que no son de una categoría. */
export const BRAND_GRADIENT = { from: '#22d3ee', to: '#087eff' };

export function categoryIconStyle(slug: string): IconStyle {
  return CATEGORY_ICONS[slug] ?? FALLBACK_ICON;
}

const SIZES = {
  sm: { box: 'h-7 w-7 rounded-lg', icon: 15, stroke: 2.1 },
  base: { box: 'h-11 w-11 rounded-xl', icon: 21, stroke: 2 },
  md: { box: 'h-14 w-14 rounded-2xl', icon: 27, stroke: 1.9 },
} as const;

export function IconTile({
  icon: Icon,
  from,
  to,
  ink = false,
  size = 'md',
  className = '',
}: IconStyle & { size?: keyof typeof SIZES; className?: string }) {
  const s = SIZES[size];
  return (
    <span
      aria-hidden
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${s.box} ${
        ink ? 'text-ink' : 'text-white'
      } ${className}`}
      style={{
        background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
        // La sombra del color de la ficha es lo que la despega del fondo.
        boxShadow:
          size === 'sm'
            ? 'inset 0 1px 0 rgba(255,255,255,0.3)'
            : `0 12px 24px -12px ${to}, inset 0 1px 0 rgba(255,255,255,0.35)`,
      }}
    >
      {/* Brillo en la mitad de arriba: le da volumen sin usar imágenes. */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
      <Icon size={s.icon} strokeWidth={s.stroke} className="relative" />
    </span>
  );
}
