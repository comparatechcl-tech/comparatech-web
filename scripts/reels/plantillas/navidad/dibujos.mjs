// Los dibujos de Navidad, hechos a mano aquí (SVG propio, sin imágenes de afuera): el gorro del Viejito Pascuero
// que se pone sobre el logo, el Viejito Pascuero que se asoma con su saco de regalos, un arbolito y un bastón de
// dulce. Los usan el reel "navidad" (adornos.mjs) y las historias de Navidad: scripts/piezas/navidad.mjs los pasa
// a PNG y escribe src/lib/content/christmas-art.ts. Si se cambia un dibujo, se vuelve a correr ese script.
//
// Colores: el rojo y el dorado de los adornos, el verde del arbolito y, en los regalos, el cian de la marca.

const ROJOS = `<linearGradient id="rojo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8394F"/><stop offset="1" stop-color="#A3142C"/></linearGradient>`;
const PIEL = `<radialGradient id="piel" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#FFE0C7"/><stop offset="1" stop-color="#F0B994"/></radialGradient>`;
const PIEL_GRIS = `<linearGradient id="piel2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#DCE2EC"/></linearGradient>`;
// Un montón de nieve, y un fundido que borra hacia abajo todo el dibujo (nieve incluida): así lo que "se asoma"
// no termina en un borde recto. `alto` es el alto del lienzo y `desde` la fila donde empieza a borrarse.
const NIEVE = `<linearGradient id="nieve" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#DCE6F2"/></linearGradient>`;
const fundido = (ancho, alto, desde) =>
  `<linearGradient id="bajar" x1="0" y1="0" x2="0" y2="${alto}" gradientUnits="userSpaceOnUse"><stop offset="${(desde / alto).toFixed(3)}" stop-color="#FFFFFF"/><stop offset="1" stop-color="#000000"/></linearGradient><mask id="fundido" maskUnits="userSpaceOnUse" x="0" y="0" width="${ancho}" height="${alto}"><rect width="${ancho}" height="${alto}" fill="url(#bajar)"/></mask>`;

/**
 * El gorro, en un lienzo de 120x100. El borde de piel blanca va abajo, de x=10 a x=104, inclinado: es lo que se
 * apoya sobre la lupa del logo. La punta cae hacia la derecha con el pompón.
 */
export const GORRO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100">
<defs>${ROJOS}${PIEL_GRIS}</defs>
<g transform="rotate(-14 60 70)">
<path d="M18 74 C24 46 40 20 66 12 C86 6 102 14 108 30 C110 38 108 46 104 52 C100 40 94 32 84 32 C90 46 94 60 98 74 Z" fill="url(#rojo)"/>
<path d="M30 70 C36 48 48 30 66 22" fill="none" stroke="#FFFFFF" stroke-opacity=".22" stroke-width="5" stroke-linecap="round"/>
<circle cx="104" cy="56" r="12" fill="url(#piel2)"/>
<rect x="8" y="66" width="98" height="24" rx="12" fill="url(#piel2)"/>
<g fill="#FFFFFF"><circle cx="16" cy="70" r="7"/><circle cx="30" cy="67" r="7"/><circle cx="46" cy="66" r="7"/><circle cx="62" cy="66" r="7"/><circle cx="78" cy="66" r="7"/><circle cx="94" cy="67" r="7"/></g>
</g>
</svg>`;

/**
 * El Viejito Pascuero que se asoma desde abajo, saludando con una mano y con el saco de regalos al hombro, en un
 * lienzo de 200x220. Sale de la cintura para arriba: el borde de abajo del lienzo es donde "se esconde".
 */
export const VIEJITO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 220">
<defs>${ROJOS}${PIEL}${PIEL_GRIS}${NIEVE}${fundido(200, 220, 190)}
<linearGradient id="saco" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B07A45"/><stop offset="1" stop-color="#7A4E26"/></linearGradient>
<linearGradient id="oro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE7A3"/><stop offset="1" stop-color="#C99A35"/></linearGradient>
</defs>
<g mask="url(#fundido)">
<!-- el saco, detrás del hombro derecho, con dos regalos asomando -->
<rect x="138" y="58" width="34" height="30" rx="4" fill="#00D4FF" transform="rotate(12 155 73)"/>
<rect x="152" y="57" width="6" height="32" fill="#C81E3A" transform="rotate(12 155 73)"/>
<rect x="116" y="66" width="28" height="26" rx="4" fill="url(#oro)" transform="rotate(-10 130 79)"/>
<rect x="127" y="65" width="6" height="28" fill="#C81E3A" transform="rotate(-10 130 79)"/>
<path d="M112 92 C108 72 130 70 150 74 C176 78 194 96 192 130 C190 168 170 196 140 200 C120 202 108 186 112 160 Z" fill="url(#saco)"/>
<path d="M114 94 C130 88 154 88 176 94" fill="none" stroke="#5E3A1A" stroke-width="5" stroke-linecap="round"/>
<path d="M150 118 C160 134 162 156 154 178" fill="none" stroke="#5E3A1A" stroke-opacity=".35" stroke-width="4" stroke-linecap="round"/>
<!-- el cuerpo: abrigo rojo con piel blanca al centro -->
<path d="M30 220 C30 176 52 152 100 150 C148 152 170 176 170 220 Z" fill="url(#rojo)"/>
<rect x="88" y="150" width="24" height="70" fill="url(#piel2)"/>
<rect x="30" y="196" width="140" height="14" fill="#1E2433"/>
<rect x="90" y="193" width="20" height="20" rx="3" fill="none" stroke="url(#oro)" stroke-width="4"/>
<!-- el brazo izquierdo, saludando, con su mitón -->
<path d="M50 172 C34 150 26 122 34 100" fill="none" stroke="url(#rojo)" stroke-width="24" stroke-linecap="round"/>
<rect x="20" y="104" width="30" height="12" rx="6" fill="url(#piel2)" transform="rotate(-8 35 110)"/>
<ellipse cx="36" cy="88" rx="15" ry="17" fill="#1F8A57"/>
<ellipse cx="24" cy="92" rx="6" ry="9" fill="#1F8A57" transform="rotate(-25 24 92)"/>
<!-- la barba -->
<path d="M58 104 C56 140 74 170 100 172 C126 170 144 140 142 104 C130 112 116 116 100 116 C84 116 70 112 58 104 Z" fill="url(#piel2)"/>
<g fill="#FFFFFF"><circle cx="66" cy="132" r="10"/><circle cx="80" cy="150" r="11"/><circle cx="100" cy="158" r="12"/><circle cx="120" cy="150" r="11"/><circle cx="134" cy="132" r="10"/></g>
<!-- la cara -->
<ellipse cx="100" cy="98" rx="34" ry="32" fill="url(#piel)"/>
<circle cx="78" cy="106" r="8" fill="#F28B82" fill-opacity=".55"/>
<circle cx="122" cy="106" r="8" fill="#F28B82" fill-opacity=".55"/>
<path d="M82 92 C86 87 92 87 95 92" fill="none" stroke="#3A2A22" stroke-width="3.6" stroke-linecap="round"/>
<path d="M105 92 C108 87 114 87 118 92" fill="none" stroke="#3A2A22" stroke-width="3.6" stroke-linecap="round"/>
<path d="M78 82 C84 76 92 77 96 81" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>
<path d="M104 81 C108 77 116 76 122 82" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>
<circle cx="100" cy="104" r="7" fill="#EE9A86"/>
<!-- el bigote y la sonrisa -->
<path d="M100 112 C92 106 78 108 72 118 C82 122 94 120 100 114 C106 120 118 122 128 118 C122 108 108 106 100 112 Z" fill="#FFFFFF"/>
<path d="M92 124 C96 128 104 128 108 124" fill="none" stroke="#B5524A" stroke-width="3" stroke-linecap="round"/>
<!-- el gorro -->
<path d="M64 76 C66 46 84 22 112 18 C136 15 154 28 160 46 C162 54 160 62 156 66 C150 54 142 46 130 46 C134 56 136 66 136 76 Z" fill="url(#rojo)"/>
<circle cx="158" cy="68" r="11" fill="url(#piel2)"/>
<rect x="58" y="66" width="86" height="20" rx="10" fill="url(#piel2)"/>
<g fill="#FFFFFF"><circle cx="64" cy="70" r="6"/><circle cx="78" cy="68" r="6"/><circle cx="92" cy="67" r="6"/><circle cx="106" cy="67" r="6"/><circle cx="120" cy="68" r="6"/><circle cx="136" cy="70" r="6"/></g>
<!-- el montón de nieve detrás del que se asoma -->
<path d="M0 220 L0 196 C14 184 30 186 42 192 C56 180 78 182 92 190 C108 178 132 180 146 190 C160 180 182 182 200 194 L200 220 Z" fill="url(#nieve)"/>
</g>
</svg>`;

/** Un arbolito de Navidad con estrella y adornos (en los colores de la marca), en un lienzo de 120x160. */
export const ARBOL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160">
<defs>
<linearGradient id="verde" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2BB673"/><stop offset="1" stop-color="#14794A"/></linearGradient>
<linearGradient id="oro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE7A3"/><stop offset="1" stop-color="#D9A637"/></linearGradient>
</defs>
<rect x="52" y="132" width="16" height="22" rx="3" fill="#7A4E26"/>
<path d="M60 22 L100 78 L82 76 L110 120 L88 118 L116 140 L4 140 L32 118 L10 120 L38 76 L20 78 Z" fill="url(#verde)"/>
<path d="M60 22 L40 76 M60 22 L26 118" fill="none" stroke="#FFFFFF" stroke-opacity=".12" stroke-width="4" stroke-linecap="round"/>
<path d="M30 92 C50 100 74 96 92 84" fill="none" stroke="url(#oro)" stroke-width="3" stroke-linecap="round"/>
<path d="M22 128 C48 136 80 132 102 118" fill="none" stroke="url(#oro)" stroke-width="3" stroke-linecap="round"/>
<g><circle cx="50" cy="64" r="5" fill="#00D4FF"/><circle cx="72" cy="88" r="5.5" fill="#E8394F"/><circle cx="40" cy="104" r="5.5" fill="url(#oro)"/><circle cx="84" cy="112" r="5.5" fill="#00D4FF"/><circle cx="58" cy="122" r="5.5" fill="#E8394F"/><circle cx="66" cy="56" r="4" fill="url(#oro)"/></g>
<path d="M60 2 L65 15 L79 15 L68 23 L72 37 L60 29 L48 37 L52 23 L41 15 L55 15 Z" fill="url(#oro)"/>
</svg>`;

/** Un bastón de dulce (blanco con franjas rojas), en un lienzo de 60x140. */
export const BASTON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 140">
<path d="M20 134 L20 40 C20 18 50 14 50 38" fill="none" stroke="#B9C2D0" stroke-width="16" stroke-linecap="round"/>
<path d="M20 134 L20 40 C20 18 50 14 50 38" fill="none" stroke="#FFFFFF" stroke-width="13" stroke-linecap="round"/>
<path d="M20 134 L20 40 C20 18 50 14 50 38" fill="none" stroke="#D7263D" stroke-width="13" stroke-dasharray="7 9"/>
<path d="M16 130 L16 42" fill="none" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

/**
 * Un rincón: el arbolito y el bastón de dulce sobre un montón de nieve, en un lienzo de 200x170. Es el adorno de la
 * esquina de abajo a la izquierda de la historia y el de arriba a la derecha del cierre del reel.
 */
export const RINCON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 170">
<defs>${NIEVE}${fundido(200, 170, 148)}</defs>
<g mask="url(#fundido)">
<svg x="18" y="0" width="120" height="160" viewBox="0 0 120 160">${ARBOL_SVG.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>
<svg x="128" y="52" width="46" height="108" viewBox="0 0 60 140">${BASTON_SVG.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>
<path d="M0 170 L0 152 C16 142 36 144 52 150 C72 140 100 142 116 150 C134 140 160 142 176 150 C186 146 194 146 200 150 L200 170 Z" fill="url(#nieve)"/>
</g>
</svg>`;
