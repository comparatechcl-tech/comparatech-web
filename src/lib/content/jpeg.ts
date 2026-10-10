/**
 * PNG a JPG. next/og solo entrega PNG, y TikTok y las historias de Instagram
 * no lo aceptan.
 *
 * Sin submuestreo de color: con él, el texto celeste sobre el fondo oscuro
 * de las piezas sale con los bordes sucios. `background` rellena lo
 * transparente (JPG no tiene transparencia).
 *
 * sharp se carga recién acá, para que solo lo arrastre la ruta que convierte.
 */
export async function pngToJpeg(png: ArrayBuffer | Uint8Array, background: string): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  const input = png instanceof Uint8Array ? png : new Uint8Array(png);
  return sharp(input).flatten({ background }).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
}

/** ¿Los bytes son de un JPG? (empieza con FF D8 FF) */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
