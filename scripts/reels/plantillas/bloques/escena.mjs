// La escena de la plantilla "bloques": qué se dibuja, dónde y cuándo. La usan armar.mjs y obrero.mjs a través
// de index.mjs. Aquí no hay nada de archivos de video: solo capas, medidas y tiempos.
//
// Enérgica y directa, en cuatro planos con cortes marcados:
//   A. gancho    desde el cuadro 0 la pantalla son bloques de color de la marca: el descuento enorme en tinta
//                sobre cian, la frase en blanco sobre azul y, debajo, la tarjeta blanca con la foto real (así el
//                primer cuadro, que muchas apps usan de miniatura, ya muestra el producto). Los bloques suben de
//                un empujón y la tarjeta crece hasta...
//   B. tarjeta   ...su tamaño grande, sobre un bloque azul inclinado; abajo la marca y el nombre.
//   C. precio    la etiqueta cian con el precio se estampa sobre el borde de la tarjeta (golpe, eco y sacudida);
//                al tiro saltan el descuento, "sin descuento" con la cifra que se tacha, las etiquetas y,
//                pegado debajo, "Precio revisado ..." / "Precios en Mercado Libre".
//   Z. cierre    tres barras (cian, azul, noche) suben y tapan todo: logo, ComparaTech y la llamada en una losa.
import * as capas from '../../capas.mjs';
import { COLOR, MENOS, arribaDeLetra, lineaBase } from '../../capas.mjs';
import { precio as formatoPrecio } from '../../datos.mjs';
import { leerFoto, prepararFoto, achicar } from '../../foto.mjs';
import { W, H, fase, mezcla, suave, rgb, limitar, poner, ponerConBrillo, ponerEscalada, rectangulo, ponerFoto, sombraDeApoyo, resplandor } from '../../pintar.mjs';
import { etiquetaPrecio, bloqueTexto, losaLlamada } from './piezas.mjs';
import { fondoNoche, fondoGancho, fondoProducto, copiarFondo, tarjeta, cortina, bordeEn } from './fondos.mjs';

export const FPS = 30;
export const CTA_POR_DEFECTO = 'Más ofertas en el perfil';

// --- Zonas seguras (Reels, TikTok, Shorts) ----------------------------------------------------------------
// Las apps tapan los 220 px de arriba, los 420 de abajo y, de la mitad hacia abajo, lo que queda a la derecha
// de x=924 (la columna de botones). Nada importante va ahí.
export const SEGURO = { arriba: 220, abajo: H - 420, derecha: 924, mitad: H / 2 };
const MARGEN = 72;
const ANCHO_TEXTO = SEGURO.derecha - MARGEN; // 852: bajo la mitad, el texto vive entre x=72 y x=924
const DERECHA_ARRIBA = W - MARGEN; // 1008: sobre la mitad no hay botones
const PIE = 1476; // lo último escrito termina aquí

// --- Reparto de la pantalla -------------------------------------------------------------------------------
const MARCA_Y = SEGURO.arriba + 6; // la pastilla con el logo: de y=226 a y=294, todo el video
const MARCA_ALTO = 68;
const NOTA = { tam: 34, alto: 42, paso: 40 }; // "Precio revisado..." y "Precios en Mercado Libre", bajo la fila del descuento
const TARJETA_Y = 318;
const TARJETA_ALTA = { x: MARGEN, w: ANCHO_TEXTO }; // foto alta o cuadrada: la tarjeta no pasa de x=924
const TARJETA_APAISADA = { x: 48, w: W - 96 }; // foto apaisada: casi todo el ancho, con el producto sobre la mitad
const PAD = 24; // aire de la tarjeta alrededor del producto
const SOLAPE = 52; // cuánto se monta la etiqueta sobre el borde de abajo de la tarjeta
const PAD_PIE = SOLAPE + 14; // aire bajo el producto: la etiqueta se pega ahí sin tapar el producto
const ESPACIO_B = 40; // aire arriba y abajo de la marca y el nombre grandes
const RESPIRO = 34; // aire de más arriba y abajo de un producto bajo, para que la tarjeta no quede justa
const TARJETA_MIN = 440; // una tarjeta nunca es más baja que esto
const BAJAR_MAX = 130; // cuánto puede bajar el grupo (tarjeta y etiqueta) cuando la tarjeta se achica
const X_ETIQUETA = 34; // la etiqueta asoma por la izquierda de la tarjeta (con su punta), como pegada a mano
const GIRO = -2.5; // grados: la etiqueta sube un poco hacia la derecha
const PROPORCION_APAISADA = 1.2;
const ESTIRAR_MAX = 1.6; // una foto chica no se agranda más que esto: se vería borrosa
// Los bordes inclinados (y en el centro, y cuánto suben por px hacia la derecha). En el gancho, el borde entre el
// cian y el azul se calcula según el alto del número; el de abajo queda justo sobre la franja de las apps.
const TECHO = 170;
const PENDIENTE_B1 = 0.07;
const B2 = { y: 1492, pendiente: 0.05 };
// El bloque azul detrás de la tarjeta, en B y C (y en la portada): de y=170 a un borde inclinado sobre la mitad.
const FIRMA = { techo: TECHO, borde: { y: 880, pendiente: 0.07 } };
const PENDIENTE_BARRAS = 0.07;
// La tarjeta del gancho: si se puede (achicando un poco el número), no es más baja que esto.
const GANCHO_TARJETA_ALTO = 400;
const GANCHO_TARJETA_MIN = { w: 260, h: 240 };

/** Texto de la consola: 0,5 */
const coma = (n, d = 1) => n.toFixed(d).replace('.', ',');

/** El producto lo más grande que quepa en un sitio de w x h, sin deformarlo ni estirarlo de más. */
function productoEn(leida, w, h) {
  const bw = Math.max(1, Math.min(w, leida.original.w * ESTIRAR_MAX, h * leida.proporcion));
  return { w: bw, h: bw / leida.proporcion };
}

// --- A. El gancho -------------------------------------------------------------------------------------------
// El dato del descuento, tal cual: "45%" y "de descuento". Sin descuento vale la baja medida por el sitio
// ("Bajó 12%" / "según nuestro historial": una baja del historial no es un descuento); sin ninguna de las dos
// no hay gancho y el video parte con la tarjeta. Nada de preguntas que adivinan qué busca la gente.

/**
 * Acomoda el gancho de arriba abajo: el número (y "Bajó" encima) en el bloque cian, el borde inclinado justo
 * bajo el número, la frase en el bloque azul y, debajo, la tarjeta con la foto, que mide lo que pide el producto
 * dentro de lo que queda (sin pasar de x=924 ni bajar del borde del bloque azul).
 */
function acomodarGancho(numero, encima, filas, leida) {
  const A = { encima: null };
  const GAP = 26;
  let y = MARCA_Y + MARCA_ALTO + 40;
  if (encima) {
    A.encima = { capa: encima, y: y - encima.tinta.y0 };
    y += encima.tinta.y1 - encima.tinta.y0 + GAP;
  }
  A.numero = { capa: numero, y: y - numero.tinta.y0 };
  y += numero.tinta.y1 - numero.tinta.y0;
  // El borde cian/azul pasa 46 px bajo el número en su punta derecha (a la izquierda queda más abajo).
  const derecha = MARGEN + numero.tinta.x1;
  const b1 = { y: Math.round(y + 46 + PENDIENTE_B1 * (derecha - W / 2)), pendiente: PENDIENTE_B1 };
  A.cortes = { techo: TECHO, b1, b2: B2 };

  // La frase, bajo el borde (que a la izquierda está más abajo): un renglón ("de descuento") o dos ("según
  // nuestro" / "historial"). Cada renglón mide de alto lo que su capa.
  const PASO = 100;
  const yf = Math.round(bordeEn(b1, MARGEN) + 30 - arribaDeLetra(filas[0].tam, filas[0].h));
  A.frases = filas.map((capa, i) => ({ capa, y: yf + i * PASO }));
  const ultima = filas[filas.length - 1];
  const finFrase = yf + (filas.length - 1) * PASO + lineaBase(ultima.tam, ultima.h) + 0.22 * ultima.tam; // con lo que cuelga ("g", "j")

  // La tarjeta: bajo la frase y dentro del bloque azul (30 px sobre su borde de abajo y con la sombra arriba de la
  // franja de las apps), pegada a la derecha: con su sombra dura llega justo a x=924, donde empieza la columna
  // de botones. Así el número, la frase y el producto bajan en diagonal. Mide lo que pide el producto.
  const arriba = Math.round(finFrase + 30);
  const tope = SEGURO.derecha - 18; // 18 px: la sombra dura de la tarjeta
  const abajo = Math.floor(Math.min(SEGURO.abajo - 18 - 12, bordeEn(B2, tope) - 30));
  const libre = abajo - arriba;
  const p = productoEn(leida, tope - MARGEN - 2 * PAD, libre - 2 * PAD);
  const w = Math.max(GANCHO_TARJETA_MIN.w, Math.round(p.w + 2 * PAD));
  const h = Math.round(limitar(p.h + 2 * PAD + 2 * RESPIRO, Math.min(GANCHO_TARJETA_MIN.h, libre), libre));
  A.tarjeta = { x: tope - w, y: arriba + Math.round((libre - h) / 2), w, h };
  A.caja = { w: p.w, h: p.h, cx: A.tarjeta.x + w / 2, cy: A.tarjeta.y + h / 2 };
  A.libre = libre;
  return A;
}

async function armarGancho(producto, leida, dicho) {
  let cifra;
  let previo = null;
  let frases;
  let letra;
  if (producto.descuento) {
    cifra = `${producto.descuento}%`;
    // "de descuento" cabe en un renglón: va más grande que la frase de la baja y le deja más alto a la tarjeta.
    frases = ['de descuento'];
    letra = { alto: 136, pasos: [{ tam: 120, espaciado: -3 }, { tam: 110, espaciado: -2.5 }, { tam: 100, espaciado: -2.5 }] };
  } else if (producto.bajaHistorial) {
    cifra = `${producto.bajaHistorial}%`;
    previo = 'Bajó';
    frases = ['según nuestro', 'historial'];
    letra = { alto: 108, pasos: [{ tam: 94, espaciado: -2.5 }, { tam: 86, espaciado: -2 }, { tam: 78, espaciado: -1.5 }] };
  } else return null;
  const filas = [];
  for (const f of frases) filas.push(await capas.renglonQueQuepa(f, { peso: 800, color: COLOR.blanco, anchoMax: ANCHO_TEXTO, alto: letra.alto }, letra.pasos));
  const encima = previo ? await capas.renglon(previo, { tam: 116, alto: 136, peso: 800, color: COLOR.tinta, espaciado: -3.5, anchoMax: DERECHA_ARRIBA - MARGEN }) : null;
  // El número llega desde un poco más grande (LLEGA): ni así pasa de x=1008 (sobre la mitad no hay botones). Va lo
  // más grande que quepa, pero si así la tarjeta de abajo quedara muy baja, un poco más chico.
  const LLEGA = 1.06;
  let A = null;
  for (const tam of [470, 450, 430, 410, 390, 370, 350, 330]) {
    const numero = await capas.renglon(cifra, { tam, alto: Math.round(tam * 1.1), peso: 800, color: COLOR.tinta, espaciado: -0.05 * tam, anchoMax: Math.floor((DERECHA_ARRIBA - MARGEN) / LLEGA) });
    if (!numero) continue;
    A = acomodarGancho(numero, encima, filas, leida);
    if (A.libre >= GANCHO_TARJETA_ALTO) break;
  }
  if (!A) throw new Error('No cabe el gancho del descuento');
  A.latido = LLEGA;
  dicho.push(previo ? `${previo} ${cifra}` : cifra, frases.join(' '));
  return A;
}

// --- B. Marca y nombre, grandes, bajo la tarjeta -------------------------------------------------------------
async function armarNombre(producto, dicho) {
  const B = { kicker: null, nombre: [] };
  let y = 0;
  if (producto.marca) {
    const capa = await capas.renglonQueQuepa(producto.marca.toLocaleUpperCase('es'), { peso: 800, color: COLOR.cian, anchoMax: ANCHO_TEXTO, alto: 44 }, [
      { tam: 34, espaciado: 5 },
      { tam: 30, espaciado: 3.5 },
      { tam: 26, espaciado: 2.5 },
      { tam: 22, espaciado: 1.5 },
    ]);
    B.kicker = { capa, y: 0 };
    dicho.push(capa.texto);
    y = 54;
  }
  const pasos = [68, 62, 56, 50, 46, 42, 38].map((tam) => ({ tam, alto: Math.round(tam * 1.14), espaciado: -0.022 * tam }));
  const nombre = await capas.bloque(producto.nombre, { anchoMax: ANCHO_TEXTO, peso: 800, pasos });
  B.nombre = nombre.capas.map((capa, i) => ({ capa, y: y + i * nombre.alto }));
  dicho.push(nombre.filas.join(' '));
  const ultima = B.nombre[B.nombre.length - 1];
  const arriba = B.kicker ? arribaDeLetra(B.kicker.capa.tam, 44) : arribaDeLetra(nombre.tam, nombre.alto);
  B.arriba = arriba; // desde y=0 hasta donde empieza la letra
  B.alto = Math.round(ultima.y + lineaBase(nombre.tam, nombre.alto) + 0.2 * nombre.tam - arriba);
  return B;
}

// --- C. La etiqueta del precio y lo que va debajo ---------------------------------------------------------
async function armarPrecio(producto, apaisada, dicho) {
  const C = { fila: { bloque: null, lista: [], tachado: null, etiquetas: [], alto: 0 }, notas: [] };
  // La etiqueta: el precio en 156 px (160 con foto apaisada, que tiene la tarjeta más ancha) o lo que quepa sin
  // pasar de x=924.
  const et = await etiquetaPrecio(producto.precio, { tamMax: apaisada ? 160 : 156, anchoMax: SEGURO.derecha - X_ETIQUETA, giro: GIRO });
  // Se estampa desde más grande, con su borde de arriba quieto (así nunca sube sobre el producto) y corrida a la
  // izquierda: al principio la punta y el agujero quedan fuera de la pantalla, pero el "$" y las cifras se ven
  // enteros en todos los cuadros (el "$" parte en x=4) y la etiqueta nunca pasa de x=924.
  et.desde = limitar((SEGURO.derecha - 4) / (et.tinta.x1 + 1 - et.inicioPrecio), 1, 1.25);
  et.izquierda = Math.min(X_ETIQUETA, Math.round(4 - et.inicioPrecio * et.desde)); // dónde parte su borde izquierdo
  C.etiqueta = et;
  dicho.push(et.texto);

  // El nombre, chico: aquí manda el precio.
  const pasos = [42, 39, 36, 34].map((tam) => ({ tam, alto: tam + 8, espaciado: -0.012 * tam }));
  const nombre = await capas.bloque(producto.nombre, { anchoMax: ANCHO_TEXTO, peso: 600, pasos });
  C.nombre = nombre.capas.map((capa, i) => ({ capa, y: i * nombre.alto }));
  C.nombreArriba = arribaDeLetra(nombre.tam, nombre.alto);
  C.nombreAlto = Math.round((nombre.capas.length - 1) * nombre.alto + lineaBase(nombre.tam, nombre.alto) + 0.22 * nombre.tam - C.nombreArriba);
  if (!dicho.includes(nombre.filas.join(' '))) dicho.push(nombre.filas.join(' '));

  // La fila del descuento: un bloque blanco ("−45%"), al lado "sin descuento" sobre "$399.990" (la cifra tachada
  // que pone el vendedor, que se tacha) y, si caben, las etiquetas apiladas a la derecha. Todo pegado a la
  // izquierda, lejos de los botones.
  const F = C.fila;
  const etiquetas = async (chicas) => {
    const lista = [];
    if (producto.envioGratis) lista.push(await capas.etiquetaEnvio(chicas));
    if (producto.full) lista.push(await capas.etiquetaFull(chicas));
    return lista;
  };
  const hayEtiquetas = producto.envioGratis || producto.full;
  const conLista = Boolean(producto.descuento);
  const textoBloque = conLista ? `${MENOS}${producto.descuento}%` : producto.bajaHistorial ? `Bajó ${producto.bajaHistorial}%` : null;
  let y = 0;
  let etiquetasAbajo = hayEtiquetas;
  if (textoBloque) {
    const tamanos = conLista
      ? [{ p: 84, a: 30, b: 46 }, { p: 80, a: 28, b: 40 }, { p: 76, a: 26, b: 35 }, { p: 72, a: 24, b: 30 }]
      : [{ p: 70, a: 32, b: 32 }, { p: 64, a: 30, b: 30 }, { p: 58, a: 28, b: 28 }];
    const renglones = conLista ? ['sin descuento', formatoPrecio(producto.precioLista)] : ['según nuestro', 'historial'];
    let armado = null;
    for (const alLado of hayEtiquetas ? [true, false] : [false]) {
      for (const m of tamanos) {
        const bloque = await bloqueTexto(textoBloque, { tam: m.p, anchoMax: ANCHO_TEXTO });
        const a = await capas.renglon(renglones[0], { tam: m.a, alto: m.a + 8, peso: 600, color: conLista ? COLOR.nota : COLOR.blanco, anchoMax: ANCHO_TEXTO });
        const b = await capas.renglon(renglones[1], { tam: m.b, alto: m.b + 10, peso: 600, anchoMax: ANCHO_TEXTO });
        if (!bloque || !a || !b) continue;
        const lado = alLado ? await etiquetas(true) : [];
        const anchoBloque = Math.max(a.w, b.w);
        const total = bloque.w + 24 + anchoBloque + (alLado ? 26 + Math.max(...lado.map((e) => e.w)) : 0);
        if (total > ANCHO_TEXTO) continue;
        armado = { bloque, a, b, lado, anchoBloque };
        break;
      }
      if (armado) break;
    }
    if (!armado) throw new Error('No cabe la fila del descuento');
    const { bloque, a, b, lado } = armado;
    const altoFila = Math.max(bloque.h, lado.length * 46 + (lado.length - 1) * 8);
    F.bloque = { capa: bloque, x: 0, y: y + Math.round((altoFila - bloque.h) / 2) };
    const xb = bloque.w + 24;
    const yb = y + Math.round((altoFila - (a.h + b.h)) / 2);
    F.lista = [
      { capa: a, x: xb, y: yb },
      { capa: b, x: xb, y: yb + a.h },
    ];
    if (conLista) F.tachado = { x: xb + b.tinta.x0 - 6, y: yb + a.h + Math.round((b.tinta.y0 + b.tinta.y1) / 2) - 2, w: b.tinta.x1 - b.tinta.x0 + 13 };
    dicho.push(textoBloque);
    if (conLista) dicho.push(renglones[0], { texto: renglones[1], nota: 'tachado' });
    else dicho.push(renglones.join(' '));
    etiquetasAbajo = hayEtiquetas && lado.length === 0;
    if (lado.length) {
      const xe = xb + armado.anchoBloque + 26;
      let ye = y + Math.round((altoFila - (lado.length * 46 + (lado.length - 1) * 8)) / 2);
      for (const capa of lado) {
        F.etiquetas.push({ capa, x: xe, y: ye });
        ye += 54;
      }
    }
    y += altoFila;
  }
  if (etiquetasAbajo) {
    if (y > 0) y += 16;
    let xe = 0;
    for (const capa of await etiquetas(false)) {
      F.etiquetas.push({ capa, x: xe, y });
      xe += capa.w + 14;
    }
    y += 58;
  }
  for (const e of F.etiquetas) dicho.push(e.capa.texto);
  F.alto = y;

  // La letra chica, pegada bajo la fila del descuento (como en "estudio"): de dónde sale el precio y cuándo se
  // revisó. Así se lee junto al precio y queda claro que el precio es de Mercado Libre. En 34 px no cabe en un
  // renglón entre el margen y la columna de botones, así que va en dos.
  const notas = [];
  if (producto.revisado) notas.push(`Precio revisado ${producto.revisado.fecha} ${producto.revisado.hora}`);
  notas.push('Precios en Mercado Libre');
  for (const [i, nota] of notas.entries()) {
    const capa = await capas.renglon(nota, { tam: NOTA.tam, alto: NOTA.alto, peso: 400, color: COLOR.nota, anchoMax: ANCHO_TEXTO });
    if (!capa) throw new Error(`No cabe la nota: ${nota}`);
    C.notas.push({ capa, y: i * NOTA.paso });
    dicho.push(nota);
  }
  C.notasArriba = arribaDeLetra(NOTA.tam, NOTA.alto);
  C.notasAlto = Math.round((notas.length - 1) * NOTA.paso + lineaBase(NOTA.tam, NOTA.alto) + 0.22 * NOTA.tam - C.notasArriba);
  return C;
}

// --- Z. El cierre -------------------------------------------------------------------------------------------
async function armarCierre(producto, cta, dicho) {
  const Z = {};
  Z.logo = await capas.logoGrande(400); // se muestra a 200 px
  Z.luz = resplandor(960, 960, 0.22);
  Z.marca = await capas.nombreMarca(96);
  // La llamada en una losa cian, centrada y sin pasar de x=924 (768 px de ancho).
  const ancho = 2 * (SEGURO.derecha - W / 2);
  Z.losa = await losaLlamada(cta, { anchoMax: ancho });
  dicho.push(Z.losa.filas.join(' '));
  Z.llamadaCortada = Z.losa.filas.join(' ') !== cta ? Z.losa.filas.join(' ') : null;
  Z.pie = [];
  const notas = [];
  if (producto.revisado) notas.push(`Precio revisado ${producto.revisado.fecha} ${producto.revisado.hora}`);
  notas.push('Precios en Mercado Libre');
  for (const nota of notas) Z.pie.push(await capas.renglon(nota, { tam: 34, alto: 44, peso: 400, color: COLOR.nota, anchoMax: ancho }));
  const total = 200 + 22 + Z.marca.h + 40 + Z.losa.h + 40 + Z.pie.length * 44;
  let y = Math.round((SEGURO.arriba + SEGURO.abajo) / 2 - total / 2);
  Z.logoY = y + 100; // centro del logo
  y += 200 + 22;
  Z.marcaY = y;
  y += Z.marca.h + 40;
  Z.losaY = y;
  y += Z.losa.h + 40;
  Z.pieY = y;
  return Z;
}

/**
 * Dibuja todas las capas del producto y resuelve las medidas. Se hace una sola vez por video.
 * Devuelve la escena (lo que necesita el pintor) con `dicho`: todo el texto que va a salir escrito.
 */
export async function preparar(producto, cta, { zonas = false } = {}) {
  const dicho = ['ComparaTech'];
  const leida = await leerFoto(producto.foto); // primero la foto: si no se puede leer, no se arma nada
  const apaisada = leida.proporcion >= PROPORCION_APAISADA;
  const L = { marca: await capas.pastillaMarca(MARCA_ALTO) };
  const A = await armarGancho(producto, leida, dicho);
  const B = await armarNombre(producto, dicho);
  const C = await armarPrecio(producto, apaisada, dicho);
  const Z = await armarCierre(producto, cta, dicho);

  // C. Lo que va bajo la tarjeta, de arriba abajo: la etiqueta (montada SOLAPE px sobre la tarjeta), el nombre,
  // la fila del descuento y la letra chica. La tarjeta ocupa todo lo que eso deja libre.
  const et = C.etiqueta.capa;
  const huecos = [12, C.fila.alto ? 14 : 0, 14]; // etiqueta-nombre, nombre-fila, fila (o nombre)-letra chica
  const usados = () => huecos.filter(Boolean).length;
  const suma = () => huecos.reduce((s, v) => s + v, 0);
  const pila = () => et.h - SOLAPE + suma() + C.nombreAlto + C.fila.alto + C.notasAlto;
  /** Lo que sobra se reparte en los huecos, sin que ninguno pase de `tope`. */
  const repartir = (sobra, tope) => {
    if (sobra <= 0) return;
    const extra = Math.floor(sobra / (usados() + 1));
    for (let i = 0; i < huecos.length; i++) if (huecos[i]) huecos[i] += Math.max(0, Math.min(extra, tope - huecos[i]));
  };
  const molde = apaisada ? TARJETA_APAISADA : TARJETA_ALTA;
  // Con foto apaisada el producto vive entero sobre la mitad de la pantalla (no pisa la columna de botones).
  const bajoMitad = apaisada ? SEGURO.mitad : Infinity;
  let fondoC = PIE - pila();
  if (apaisada) fondoC = Math.min(fondoC, SEGURO.mitad + PAD_PIE);
  repartir(PIE - pila() - fondoC, 40); // si sobra alto, los huecos crecen un poco (sin despegarse demasiado)
  const cardC0 = { x: molde.x, y: TARJETA_Y, w: molde.w, h: fondoC - TARJETA_Y };
  if (cardC0.h < 420) throw new Error('No queda sitio para la foto: el precio, el nombre y el descuento ocupan demasiado');
  // B. Antes del precio la tarjeta es más grande: debajo solo van la marca y el nombre. Justo antes de que se
  // estampe la etiqueta se encoge a su tamaño de C.
  // (Si lo de C ocupa poco, la tarjeta de C puede ser más alta que la de B: entonces crece en vez de encogerse.)
  let fondoB = PIE - B.alto - 2 * ESPACIO_B;
  if (apaisada) fondoB = Math.min(fondoB, SEGURO.mitad + PAD);
  if (fondoC <= PIE - B.alto - 2 * ESPACIO_B) fondoB = Math.max(fondoB, fondoC);

  // El producto: centrado en la tarjeta, lo más grande que quepa sin estirarlo de más.
  const cajaEn = (card, aireAbajo) => {
    const dentro = { x: card.x + PAD, y: card.y + PAD, w: card.w - 2 * PAD, h: Math.min(card.h - PAD - aireAbajo, bajoMitad - card.y - PAD) };
    const p = productoEn(leida, dentro.w, dentro.h);
    return { w: p.w, h: p.h, cx: dentro.x + dentro.w / 2, cy: dentro.y + dentro.h / 2 };
  };
  // Si el producto es bajo (una barra de sonido, una foto chica), la tarjeta no queda medio vacía: mide lo que
  // pide el producto más un poco de aire, y todo el grupo baja un poco para quedar centrado.
  const altoNatural = (caja, aireAbajo) => caja.h + PAD + aireAbajo + 2 * RESPIRO;
  const hC = Math.round(limitar(altoNatural(cajaEn(cardC0, PAD_PIE), PAD_PIE), TARJETA_MIN, cardC0.h));
  const bajar = Math.min(BAJAR_MAX, Math.round((cardC0.h - hC) / 2));
  const cardC = { ...cardC0, y: TARJETA_Y + bajar, h: hC };
  fondoC = cardC.y + cardC.h;
  const cajaB0 = cajaEn({ ...cardC, h: fondoB - cardC.y }, PAD);
  const cardB = { ...cardC, h: Math.round(limitar(altoNatural(cajaB0, PAD), Math.min(hC, fondoB - cardC.y), fondoB - cardC.y)) };
  fondoB = cardB.y + cardB.h;
  const cajaB = cajaEn(cardB, PAD);
  const cajaC = cajaEn(cardC, PAD_PIE);
  // Lo que sobra bajo la letra chica (si la tarjeta se achicó) agranda un poco los huecos.
  repartir(PIE - (fondoC - SOLAPE + et.h + suma() + C.nombreAlto + C.fila.alto + C.notasAlto), 40);
  const geo = {};
  geo.etiquetaY = fondoC - SOLAPE;
  geo.nombreY = Math.round(geo.etiquetaY + et.h + huecos[0] - C.nombreArriba);
  let y = geo.nombreY + C.nombreArriba + C.nombreAlto;
  geo.filaY = Math.round(y + huecos[1]);
  y = geo.filaY + C.fila.alto;
  geo.notasY = Math.round(y + huecos[2] - C.notasArriba);
  // B: la marca y el nombre grandes bajo la tarjeta; centrados en lo que queda, pero sin alejarse más de 80 px.
  geo.nombreBY = Math.round(fondoB + Math.min(80, (PIE - fondoB - B.alto) / 2) - B.arriba);

  // La foto, al tamaño más grande que se va a mostrar. En el gancho se muestra bastante más chica: ahí se usa una
  // copia achicada (se ve más fina que achicarla cuadro a cuadro).
  const anchoMax = Math.max(cajaB.w, cajaC.w, A ? A.caja.w : 0);
  const foto = await prepararFoto(leida, anchoMax);
  const kA = A ? A.caja.w / foto.caja.w : 1;
  const fotoA = kA < 0.9 ? await achicar(foto, kA) : null;

  const avisos = [];
  const estirada = anchoMax / leida.original.w;
  if (estirada > 1.25) avisos.push(`la foto es chica (el producto mide ${leida.original.w}x${leida.original.h} px): se muestra a ${Math.round(anchoMax)} px de ancho, ${coma(estirada)} veces su tamaño${estirada >= ESTIRAR_MAX - 0.01 ? ' (el tope, para que no se vea borrosa)' : ''}.`);
  if (Z.llamadaCortada) avisos.push(`la llamada del cierre es muy larga: ni en 40 px cabe en dos renglones, así que sale cortada ("${Z.llamadaCortada}").`);
  if (leida.modo === 'lamina') avisos.push('la foto no viene sobre fondo blanco: se muestra entera, como una lámina con sombra.');

  const tam = (c) => `${Math.round(c.w)}x${Math.round(c.h)}`;
  return {
    L, A, B, C, Z, cardB, cardC, cajaB, cajaC, geo, foto, fotoA, apaisada, zonas, dicho, avisos,
    medidas: {
      foto: leida.modo,
      original: leida.original,
      producto: `${A ? `${tam(A.caja)} (gancho), ` : ''}${tam(cajaB)} (nombre) y ${tam(cajaC)} (precio)`,
      tarjeta: `${A ? `${tam(A.tarjeta)}, ` : ''}${cardC.w}x${cardB.h} y ${cardC.w}x${cardC.h}`,
      precioTam: C.etiqueta.tam,
      numeroTam: A ? A.numero.capa.tam : null,
      llamadaTam: Z.losa.tam,
    },
  };
}

/**
 * El guion: en qué segundo pasa cada cosa. Sin gancho (producto sin descuento ni baja) el video parte con la
 * tarjeta ya puesta y la etiqueta se estampa antes.
 */
export function tiempos(conGancho) {
  const T = {};
  T.empuje = conGancho ? [1.25, 1.53] : null; // los bloques del gancho suben de un empujón...
  T.crece = conGancho ? [1.25, 1.65] : null; // ...y la tarjeta del gancho crece hasta su tamaño de B
  T.llega = conGancho ? T.crece[1] : 0;
  T.estampa = conGancho ? 2.6 : 1.25; // la etiqueta empieza a estamparse...
  T.golpe = T.estampa + 0.16; // ...y aquí pega (2,76 s con gancho)
  T.encoge = [T.estampa - 0.36, T.estampa - 0.02]; // justo antes, la tarjeta se encoge a su tamaño de C
  T.nombreSale = T.estampa - 0.34; // y el nombre grande se va
  T.nombreC = T.golpe + 0.06;
  T.descuento = T.golpe + 0.24;
  T.lista = T.golpe + 0.38;
  T.tachado = [T.golpe + 0.6, T.golpe + 0.84];
  T.etiquetas = T.golpe + 0.74;
  T.notas = T.golpe + 0.95;
  T.latido = T.golpe + 2.4; // segundo golpe: un brillo cruza la etiqueta y el descuento late
  T.cierre = conGancho ? 7.25 : 7.0; // suben las barras
  T.portada = T.cierre - 0.35; // el cuadro que se guarda con --portada: el precio completo
  T.fin = T.cierre + 2.35;
  return T;
}

/** Ocho momentos para la hoja de contactos, con su rótulo. */
export function momentos(T) {
  const g = T.empuje != null;
  return [
    { t: 0, rotulo: 'cuadro 0' },
    g ? { t: 0.73, rotulo: 'gancho (late)' } : { t: 0.6, rotulo: 'tarjeta y nombre' },
    g ? { t: T.empuje[0] + 0.16, rotulo: 'suben los bloques' } : { t: T.estampa + 0.08, rotulo: 'se estampa la etiqueta' },
    g ? { t: T.encoge[0] - 0.15, rotulo: 'tarjeta y nombre' } : { t: T.golpe + 0.03, rotulo: 'golpe del precio' },
    g ? { t: T.golpe + 0.03, rotulo: 'golpe del precio' } : { t: T.golpe + 0.5, rotulo: 'después del golpe' },
    { t: T.portada, rotulo: 'precio completo (portada)' },
    { t: T.cierre + 0.17, rotulo: 'suben las barras' },
    { t: T.fin - 0.3, rotulo: 'cierre' },
  ];
}

/**
 * Devuelve pintar(lienzo, segundo): dibuja el cuadro completo de ese instante. No recuerda nada de un cuadro
 * a otro, así que los cuadros se pueden pintar en cualquier orden y en varios hilos a la vez.
 */
export function pintor(escena, T) {
  const { L, A, B, C, Z, cardB, cardC, cajaB, cajaC, geo, foto, fotoA, zonas } = escena;
  const noche = fondoNoche();
  const fondoP = fondoProducto(FIRMA);
  const gancho = A ? fondoGancho(A.cortes) : null;
  const BLANCO = [255, 255, 255];
  const CIAN = rgb(COLOR.cian);
  const AZUL = rgb(COLOR.azul);
  const x = MARGEN;
  const et = C.etiqueta;

  /** Aparece con una subida corta. */
  const asomar = (dst, capa, xx, yy, p, desde = 14, opacidad = 1) => {
    if (p <= 0) return;
    const e = suave.sale(p);
    poner(dst, capa, xx, yy + (1 - e) * desde, e * opacidad);
  };
  /** Salta a su lugar desde más chica, pasándose un poco. */
  const saltar = (dst, capa, xx, yy, p) => {
    if (p <= 0) return;
    if (p >= 1) return poner(dst, capa, xx, yy);
    ponerEscalada(dst, capa, xx + capa.w / 2, yy + capa.h / 2, 0.45 + 0.55 * suave.rebote(p), Math.min(1, p * 4));
  };
  /** Un brillo que cruza la capa una vez mientras `p` va de 0 a 1; fuera de eso, la capa tal cual. */
  const conBrillo = (dst, capa, xx, yy, opacidad, p, color, ancho = 200, fuerza = 0.8) => {
    if (p > 0 && p < 1) ponerConBrillo(dst, capa, xx, yy, opacidad, xx + mezcla(-ancho - 50, capa.w + ancho + 50, suave.entraSale(p)), ancho, color, fuerza);
    else poner(dst, capa, xx, yy, opacidad);
  };
  const entre = (a, b, p) => ({ x: mezcla(a.x, b.x, p), y: mezcla(a.y, b.y, p), w: mezcla(a.w, b.w, p), h: mezcla(a.h, b.h, p) });

  /**
   * La tarjeta blanca con la foto real. `caja` es el sitio del producto (centro y ancho) y `zoom` cuánto de ese
   * sitio usa (nunca más que 1: el producto no pasa de su caja). En el gancho se dibuja desde la copia achicada.
   */
  function ponerTarjeta(dst, card, caja, zoom) {
    tarjeta(dst, card.x, card.y, card.w, card.h, { sombra: CIAN });
    const w = caja.w * zoom;
    const f = fotoA && w <= fotoA.caja.w * 1.5 ? fotoA : foto;
    const escala = w / f.caja.w;
    const h = f.caja.h * escala;
    const fx = caja.cx - w / 2;
    const fy = caja.cy - h / 2;
    if (f.modo === 'fundida') sombraDeApoyo(dst, caja.cx, fy + h + Math.max(8, w * 0.01), w * 0.44, Math.max(10, w * 0.022), 0.16);
    ponerFoto(dst, f.img, fx - f.caja.x * escala, fy - f.caja.y * escala, escala);
  }

  // En el gancho la foto se acerca apenas, sin pasar de su caja.
  const zoomA = (t) => 0.975 + 0.025 * suave.entraSale(fase(t, 0, T.empuje ? T.empuje[0] : 1));

  // --- A. El gancho, corrido `dy` filas (cuando sube de un empujón). Con `conTarjeta`, también su tarjeta ---
  function planoGancho(dst, t, dy, conTarjeta) {
    copiarFondo(dst, gancho, dy);
    if (!dy) poner(dst, L.marca, x, MARCA_Y); // mientras los bloques suben, el logo queda fijo (ver pintar)
    if (A.encima) poner(dst, A.encima.capa, x, A.encima.y + dy);
    // El número está desde el cuadro 0: llega un poco más grande y se asienta; a los 0,6 s late una vez.
    const c = A.numero.capa;
    const escala = t < 0.3 ? mezcla(A.latido, 1, suave.sale(fase(t, 0, 0.3))) : 1 + (A.latido - 1) * 0.75 * Math.sin(Math.PI * fase(t, 0.6, 0.86));
    if (escala > 1.0008) ponerEscalada(dst, c, x, A.numero.y + dy + c.h / 2, escala, 1, [0, 0.5]);
    else poner(dst, c, x, A.numero.y + dy);
    for (const f of A.frases) poner(dst, f.capa, x, f.y + dy);
    if (conTarjeta) ponerTarjeta(dst, A.tarjeta, A.caja, zoomA(t));
  }

  // --- B y C. La tarjeta con el producto y lo que se dice debajo, corrido `dy` filas ---
  function planoProducto(dst, t, dy) {
    copiarFondo(dst, fondoP, dy);
    if (!dy) poner(dst, L.marca, x, MARCA_Y);

    // Cuando pega la etiqueta, la tarjeta y la foto se sacuden.
    const g = t - T.golpe;
    const sacudida = g >= 0 && g < 0.4 ? 11 * Math.exp(-9 * g) * Math.sin(46 * g) : 0;
    const pc = suave.entraSale(fase(t, T.encoge[0], T.encoge[1]));
    let card = { x: cardC.x, y: cardC.y + dy + sacudida, w: cardC.w, h: mezcla(cardB.h, cardC.h, pc) };
    let caja = { w: mezcla(cajaB.w, cajaC.w, pc), cx: mezcla(cajaB.cx, cajaC.cx, pc), cy: mezcla(cajaB.cy, cajaC.cy, pc) + dy + sacudida };
    // La foto se acerca despacio (en B y otra vez en C), sin pasar nunca de su caja.
    let zoom = mezcla(0.965 + 0.035 * suave.entraSale(fase(t, T.llega, T.encoge[0])), 0.975 + 0.025 * suave.entraSale(fase(t, T.golpe, T.cierre)), pc);
    // Mientras los bloques suben, la tarjeta del gancho crece desde su sitio hasta el de B (no corre con el plano:
    // es la misma tarjeta, que se queda en pantalla).
    if (A && t < T.crece[1]) {
      const q = suave.entraSale(fase(t, T.crece[0], T.crece[1]));
      card = entre(A.tarjeta, { x: cardC.x, y: cardC.y, w: cardC.w, h: cardB.h }, q);
      caja = { w: mezcla(A.caja.w, cajaB.w, q), cx: mezcla(A.caja.cx, cajaB.cx, q), cy: mezcla(A.caja.cy, cajaB.cy, q) };
      zoom = mezcla(zoomA(t), zoom, q);
    }
    ponerTarjeta(dst, card, caja, zoom);

    // B. La marca y el nombre grandes. Entran con el plano (con un pequeño rebote, y siempre bajo la tarjeta que
    // todavía crece) y se van justo antes de que se estampe la etiqueta.
    if (t < T.estampa) {
      const sale = suave.entra(fase(t, T.nombreSale, T.nombreSale + 0.14));
      const atraso = A ? 110 * (1 - suave.rebote(fase(t, T.empuje[0] + 0.12, T.crece[1] + 0.12))) : 0;
      const bajoTarjeta = card.y + card.h + (geo.nombreBY - (cardB.y + cardB.h));
      const o = Math.max(geo.nombreBY + dy + atraso, bajoTarjeta) + sale * 22;
      if (B.kicker) poner(dst, B.kicker.capa, x, o + B.kicker.y, 1 - sale);
      for (const n of B.nombre) poner(dst, n.capa, x, o + n.y, 1 - sale);
    }
    if (t < T.estampa) return;

    // C. La etiqueta del precio: se estampa desde más grande (ver armarPrecio: su borde de arriba no se mueve, así
    // que nunca pisa el producto, y el precio se ve entero en todos los cuadros), pega, deja un eco de luz y todo
    // sacude.
    const ye = geo.etiquetaY + dy + sacudida * 0.5;
    const pe = fase(t, T.estampa, T.golpe);
    if (pe < 1) {
      const e = suave.entra(pe);
      ponerEscalada(dst, et.capa, mezcla(et.izquierda, X_ETIQUETA, e), ye, mezcla(et.desde, 1, e), Math.min(1, 0.35 + pe * 4), [0, 0]);
    } else {
      if (g < 0.3) {
        // El eco crece desde el borde de arriba de la etiqueta hacia abajo y a los lados: un destello que se apaga
        // en 0,3 s (por la derecha asoma un poco en la columna de botones mientras se apaga; no dice nada).
        const e = suave.sale(g / 0.3);
        ponerEscalada(dst, et.eco, X_ETIQUETA + et.eco.w / 2, ye, 1 + 0.12 * e, 0.8 * (1 - e) ** 1.5, [0.5, 0]);
      }
      conBrillo(dst, et.capa, X_ETIQUETA, ye, 1, fase(t, T.latido, T.latido + 0.75), BLANCO, 190, 0.6);
    }

    // El nombre chico, bajo la etiqueta.
    C.nombre.forEach(({ capa, y }, i) => asomar(dst, capa, x, geo.nombreY + dy + y, fase(t, T.nombreC + 0.05 * i, T.nombreC + 0.05 * i + 0.3), 16));

    // La fila: el bloque del descuento salta, el precio sin descuento entra y se tacha, las etiquetas saltan.
    const F = C.fila;
    const o = geo.filaY + dy;
    if (F.bloque) {
      const c = F.bloque.capa;
      const pd = fase(t, T.descuento, T.descuento + 0.34);
      const late = Math.sin(Math.PI * fase(t, T.latido + 0.12, T.latido + 0.42));
      if (pd >= 1 && late > 0) ponerEscalada(dst, c, x + F.bloque.x + c.w / 2, o + F.bloque.y + c.h / 2, 1 + 0.08 * late);
      else saltar(dst, c, x + F.bloque.x, o + F.bloque.y, pd);
      const pl = suave.sale(fase(t, T.lista, T.lista + 0.28));
      if (pl > 0) for (const pieza of F.lista) poner(dst, pieza.capa, x + pieza.x - (1 - pl) * 30, o + pieza.y, pl);
      if (F.tachado) {
        const pt = suave.entraSale(fase(t, T.tachado[0], T.tachado[1]));
        if (pt > 0) rectangulo(dst, x + F.tachado.x, o + F.tachado.y, F.tachado.w * pt, 5, CIAN, 1);
      }
    }
    F.etiquetas.forEach((e, i) => saltar(dst, e.capa, x + e.x, o + e.y, fase(t, T.etiquetas + 0.1 * i, T.etiquetas + 0.1 * i + 0.32)));

    // La letra chica, pegada bajo la fila.
    C.notas.forEach((n, i) => asomar(dst, n.capa, x, geo.notasY + dy + n.y, fase(t, T.notas + 0.07 * i, T.notas + 0.07 * i + 0.35), 12));
  }

  // --- Z. El cierre: logo, ComparaTech, la losa con la llamada y la letra chica ---
  function planoCierre(dst, t) {
    const c0 = T.cierre;
    const pLogo = fase(t, c0 + 0.42, c0 + 0.85);
    if (pLogo > 0) {
      poner(dst, Z.luz, W / 2 - Z.luz.w / 2, Z.logoY - Z.luz.h / 2, suave.sale(pLogo));
      const deriva = 1 + 0.03 * fase(t, c0 + 0.42, T.fin);
      ponerEscalada(dst, Z.logo, W / 2, Z.logoY, 0.5 * (0.55 + 0.45 * suave.rebote(pLogo)) * deriva, Math.min(1, pLogo * 3.5));
    }
    const pMarca = fase(t, c0 + 0.5, c0 + 0.95);
    if (pMarca > 0) {
      const m = Z.marca;
      const e = suave.saleFuerte(pMarca);
      const xx = Math.round(W / 2 - m.w / 2);
      poner(dst, m, xx, Z.marcaY + (1 - e) * m.h * 0.8, Math.min(1, pMarca * 3), [xx, Z.marcaY, xx + m.w, Z.marcaY + m.h]);
    }
    saltar(dst, Z.losa, Math.round(W / 2 - Z.losa.w / 2), Z.losaY, fase(t, c0 + 0.6, c0 + 0.96));
    Z.pie.forEach((capa, i) => asomar(dst, capa, Math.round(W / 2 - capa.w / 2), Z.pieY + i * 44, fase(t, c0 + 0.82 + 0.06 * i, c0 + 1.15 + 0.06 * i), 12));
  }

  return function pintar(dst, t) {
    if (A && t < T.empuje[1]) {
      // El gancho; al final sus bloques suben de un empujón, la noche entra desde abajo y la tarjeta crece.
      const p = suave.entraSale(fase(t, T.empuje[0], T.empuje[1]));
      planoGancho(dst, t, -p * H, p === 0);
      if (p > 0) {
        planoProducto(dst, t, (1 - p) * H);
        // La pastilla del logo está en el mismo sitio en los dos planos: mientras suben, queda quieta encima.
        poner(dst, L.marca, x, MARCA_Y);
      }
    } else if (t < T.cierre) {
      planoProducto(dst, t, 0);
    } else {
      // Tres barras suben una tras otra (cian, azul y la noche del cierre) y tapan todo.
      const barras = [
        { color: CIAN, d: 0 },
        { color: AZUL, d: 0.07 },
        { fondo: noche, d: 0.14 },
      ];
      const cubierto = t >= T.cierre + 0.14 + 0.3;
      if (cubierto) copiarFondo(dst, noche, 0);
      else {
        planoProducto(dst, t, 0);
        const alto = PENDIENTE_BARRAS * W / 2 + 2;
        for (const b of barras) {
          const p = suave.entraSale(fase(t, T.cierre + b.d, T.cierre + b.d + 0.3));
          if (p > 0) cortina(dst, mezcla(H + alto, -alto, p), PENDIENTE_BARRAS, b.color, b.fondo);
        }
      }
      planoCierre(dst, t);
    }

    // Para revisar (--zonas): en rojo, lo que tapan las apps.
    if (zonas) {
      const ROJO = [255, 40, 60];
      rectangulo(dst, 0, 0, W, SEGURO.arriba, ROJO, 0.38);
      rectangulo(dst, 0, SEGURO.abajo, W, H - SEGURO.abajo, ROJO, 0.38);
      rectangulo(dst, SEGURO.derecha, SEGURO.mitad, W - SEGURO.derecha, SEGURO.abajo - SEGURO.mitad, ROJO, 0.38);
    }
  };
}
