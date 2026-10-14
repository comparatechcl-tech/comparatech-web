// La escena de la plantilla "estudio": qué se dibuja, dónde y cuándo. La usan armar.mjs (que arma el video) y
// obrero.mjs (los hilos que pintan cuadros en paralelo), siempre a través de index.mjs. Aquí no hay nada de
// archivos de video: solo capas, medidas y tiempos.
//
// La foto real del producto va grande sobre un fondo claro de estudio. El video tiene cuatro momentos, y todos
// cuelgan de una "hoja" azul noche que sube desde abajo:
//   A. gancho   la foto y, enorme, el dato del descuento ("45% / por debajo del / precio de lista")
//   B. nombre   la marca y el nombre del producto; la foto en su tamaño más grande
//   C. precio   el precio cae y pega; descuento, precio de lista tachado, etiquetas y "Precio revisado"
//   Z. cierre   la hoja sube del todo: logo, ComparaTech, la llamada y "Precio revisado"
import * as capas from '../../capas.mjs';
import { COLOR, MENOS, arribaDeLetra, lineaBase, ALTO_MAYUSCULA } from '../../capas.mjs';
import { precio as formatoPrecio } from '../../datos.mjs';
import { leerFoto, prepararFoto, achicar } from '../../foto.mjs';
import { W, H, fase, mezcla, suave, rgb, limitar, poner, ponerConBrillo, ponerEscalada, rectangulo, ponerFoto, sombraDeApoyo, resplandor } from '../../pintar.mjs';
import { fondoEstudio, hojaOscura, destelloHoja } from './fondos.mjs';

export const FPS = 30;
export const CTA_POR_DEFECTO = 'Más ofertas en el perfil';

// --- Zonas seguras (Reels, TikTok, Shorts) ----------------------------------------------------------------
// Las apps tapan los 220 px de arriba, los 420 de abajo y, de la mitad hacia abajo, lo que queda a la derecha
// de x=924 (la columna de botones). Nada importante va ahí.
export const SEGURO = { arriba: 220, abajo: H - 420, derecha: 924, mitad: H / 2 };
const MARGEN = 72;
const ANCHO_TEXTO = SEGURO.derecha - MARGEN; // 852: todo el texto de la hoja vive entre x=72 y x=924
const PIE = 1476; // el último texto de la hoja termina aquí (el encargo pide 1480 o antes)

// --- Reparto de la pantalla -------------------------------------------------------------------------------
const MARCA_Y = SEGURO.arriba + 6; // la pastilla con el logo: de y=226 a y=294
const MARCA_ALTO = 68;
const FOTO_ARRIBA = MARCA_Y + MARCA_ALTO + 30; // 324: la foto empieza 30 px bajo la pastilla
const FOTO_AIRE = 30; // de la foto a la hoja (ahí cae la sombra del producto)
const FOTO_ANCHO_ALTA = 2 * (SEGURO.derecha - W / 2); // 768: una foto alta baja de la mitad, así que no pasa de x=924
const FOTO_ANCHO_APAISADA = 1000; // una apaisada usa casi todo el ancho...
const FOTO_BAJO_APAISADA = SEGURO.mitad; // ...pero vive entera arriba de la mitad, donde no hay botones
const PROPORCION_APAISADA = 1.2; // desde esta proporción (ancho/alto) le conviene ir arriba
const ESTIRAR_MAX = 1.6; // una foto chica no se agranda más que esto: se vería borrosa
const RADIO = 64; // esquinas de la hoja

/** Texto de la consola: 0,5 */
const coma = (n, d = 1) => n.toFixed(d).replace('.', ',');

// --- A. El gancho -------------------------------------------------------------------------------------------
// El dato del descuento, tal cual. Sin precio de lista vale la baja medida por el sitio; sin ninguna de las dos
// no hay gancho y el video parte con el nombre. No hay preguntas del tipo "¿Buscas...?": adivinarían el producto.
async function armarGancho(producto, apaisada, dicho) {
  let trozos;
  let frases;
  if (producto.descuento) {
    trozos = [{ t: `${producto.descuento}%`, color: COLOR.cian }];
    frases = ['por debajo del', 'precio de lista'];
  } else if (producto.bajaHistorial) {
    trozos = [{ t: 'Bajó ' }, { t: `${producto.bajaHistorial}%`, color: COLOR.cian }];
    frases = ['según nuestro', 'historial'];
  } else return null;
  // El número va en 150 a 200 px: con una foto apaisada la hoja tiene más sitio y va en 200.
  let numero = null;
  for (const tam of apaisada ? [200, 184, 168, 152] : [168, 160, 152]) {
    numero = await capas.renglon(trozos, { tam, alto: Math.round(tam * 1.3), peso: 800, espaciado: -0.03 * tam, anchoMax: ANCHO_TEXTO });
    if (numero) break;
  }
  if (!numero) throw new Error('No cabe el gancho del descuento');
  const TAM = 80;
  const ALTO = 100;
  const PASO = 88;
  const filas = [];
  for (const f of frases) filas.push(await capas.renglon(f, { tam: TAM, alto: ALTO, peso: 800, espaciado: -2, anchoMax: ANCHO_TEXTO }));
  if (!filas.every(Boolean)) throw new Error('No cabe la frase del gancho');
  dicho.push(trozos.map((p) => p.t).join(''), frases.join(' '));
  // Medidas desde el borde de arriba de las cifras del número.
  const cuelga = numero.tinta.y1 - lineaBase(numero.tam, numero.h); // la "j" de "Bajó" baja de la línea
  const y1 = Math.round(ALTO_MAYUSCULA * numero.tam + Math.max(36, cuelga + 16) - arribaDeLetra(TAM, ALTO));
  return {
    numero: { capa: numero, y: Math.round(-arribaDeLetra(numero.tam, numero.h)) },
    frases: filas.map((capa, i) => ({ capa, y: y1 + i * PASO })),
    alto: y1 + PASO + filas[1].tinta.y1 + 2,
    relleno: 42,
  };
}

// --- B. Marca y nombre --------------------------------------------------------------------------------------
async function armarNombre(producto, apaisada, dicho) {
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
    y = 52;
  }
  // El nombre, en dos renglones como máximo. Con una foto apaisada la hoja tiene más sitio: letra más grande.
  const pasos = (apaisada ? [76, 68, 60, 54, 48, 42, 38] : [64, 58, 52, 46, 42, 38]).map((tam) => ({ tam, alto: Math.round(tam * 1.16), espaciado: -0.018 * tam }));
  const nombre = await capas.bloque(producto.nombre, { anchoMax: ANCHO_TEXTO, peso: 600, pasos });
  B.nombre = nombre.capas.map((capa, i) => ({ capa, y: y + i * nombre.alto }));
  dicho.push(nombre.filas.join(' '));
  const ultima = B.nombre[B.nombre.length - 1];
  B.alto = Math.round(ultima.y + lineaBase(nombre.tam, nombre.alto) + 0.22 * nombre.tam);
  B.relleno = Math.round(40 - (B.kicker ? arribaDeLetra(B.kicker.capa.tam, 44) : arribaDeLetra(nombre.tam, nombre.alto)));
  return B;
}

// --- C. El precio -------------------------------------------------------------------------------------------
async function armarPrecio(producto, dicho) {
  const C = { nombre: [], pastilla: null, lista: [], tachado: null, etiquetas: [], pie: [] };
  // Nombre, más chico que en B: aquí manda el precio.
  const pasos = [40, 37, 34].map((tam) => ({ tam, alto: tam + 7, espaciado: -0.012 * tam }));
  const nombre = await capas.bloque(producto.nombre, { anchoMax: ANCHO_TEXTO, peso: 600, pasos });
  C.nombre = nombre.capas.map((capa, i) => ({ capa, y: i * nombre.alto }));
  if (!dicho.includes(nombre.filas.join(' '))) dicho.push(nombre.filas.join(' '));
  let y = nombre.capas.length * nombre.alto + 8;

  // El precio, en unos 170 px. Cae desde más grande: el tamaño más grande con que cabe sin pasar de x=924.
  const precio = await capas.capaPrecio(producto.precio, { anchoMax: ANCHO_TEXTO, tamMax: 170 });
  C.precio = { capa: precio, y, desde: limitar((ANCHO_TEXTO - 2) / (precio.tinta.x1 + 1), 1, 1.36) };
  dicho.push(precio.texto);
  y += precio.h + 12;

  // La fila del descuento: pastilla grande ("−45%"), al lado "precio de lista" sobre "$399.990" (que se tacha)
  // y, si caben, las etiquetas apiladas a la derecha. Todo pegado a la izquierda, lejos de los botones.
  const etiquetas = async (chicas) => {
    const lista = [];
    if (producto.envioGratis) lista.push(await capas.etiquetaEnvio(chicas));
    if (producto.full) lista.push(await capas.etiquetaFull(chicas));
    return lista;
  };
  const hayEtiquetas = producto.envioGratis || producto.full;
  const conLista = Boolean(producto.descuento);
  const textoPastilla = conLista ? `${MENOS}${producto.descuento}%` : producto.bajaHistorial ? `Bajó ${producto.bajaHistorial}%` : null;
  let etiquetasAbajo = hayEtiquetas;
  if (textoPastilla) {
    // De la mejor forma a la más apretada: primero con las etiquetas al lado, después con las etiquetas abajo.
    // El "−N%" nunca baja de 90 px; "Bajó N%" es más largo y puede bajar hasta 72.
    const tamanos = conLista
      ? [{ p: 90, a: 30, b: 46 }, { p: 90, a: 28, b: 40 }, { p: 90, a: 26, b: 35 }, { p: 90, a: 24, b: 30 }]
      : [{ p: 90, a: 32, b: 32 }, { p: 80, a: 30, b: 30 }, { p: 72, a: 28, b: 28 }];
    const renglones = conLista ? ['precio de lista', formatoPrecio(producto.precioLista)] : ['según nuestro', 'historial'];
    let armado = null;
    for (const alLado of hayEtiquetas ? [true, false] : [false]) {
      for (const m of tamanos) {
        const pastilla = await capas.pastillaDescuento(textoPastilla, m.p);
        const a = await capas.renglon(renglones[0], { tam: m.a, alto: m.a + 8, peso: 600, anchoMax: ANCHO_TEXTO });
        const b = await capas.renglon(renglones[1], { tam: m.b, alto: m.b + 10, peso: 600, anchoMax: ANCHO_TEXTO });
        if (!a || !b) continue;
        const lado = alLado ? await etiquetas(true) : [];
        const anchoBloque = Math.max(a.w, b.w);
        const total = pastilla.w + 22 + anchoBloque + (alLado ? 28 + Math.max(...lado.map((e) => e.w)) : 0);
        if (total > ANCHO_TEXTO) continue;
        armado = { pastilla, a, b, lado, anchoBloque };
        break;
      }
      if (armado) break;
    }
    if (!armado) throw new Error('No cabe la fila del descuento');
    const { pastilla, a, b, lado } = armado;
    const altoFila = Math.max(pastilla.h, lado.length * 46 + (lado.length - 1) * 8);
    C.pastilla = { capa: pastilla, x: 0, y: y + Math.round((altoFila - pastilla.h) / 2) };
    const xb = pastilla.w + 22;
    const yb = y + Math.round((altoFila - (a.h + b.h)) / 2);
    C.lista = [
      { capa: a, x: xb, y: yb },
      { capa: b, x: xb, y: yb + a.h },
    ];
    // El tachado cruza las cifras del precio de lista, de izquierda a derecha.
    if (conLista) C.tachado = { x: xb + b.tinta.x0 - 6, y: yb + a.h + Math.round((b.tinta.y0 + b.tinta.y1) / 2) - 1, w: b.tinta.x1 - b.tinta.x0 + 13 };
    dicho.push(textoPastilla);
    if (conLista) dicho.push(renglones[0], { texto: renglones[1], nota: 'tachado' });
    else dicho.push(renglones.join(' '));
    etiquetasAbajo = hayEtiquetas && lado.length === 0;
    if (lado.length) {
      const xe = xb + armado.anchoBloque + 28;
      let ye = y + Math.round((altoFila - (lado.length * 46 + (lado.length - 1) * 8)) / 2);
      for (const capa of lado) {
        C.etiquetas.push({ capa, x: xe, y: ye });
        ye += 54;
      }
    }
    y += altoFila + 12;
  }
  if (etiquetasAbajo) {
    // Sin fila de descuento (o si al lado no cabían): las etiquetas van en su propio renglón.
    let xe = 0;
    for (const capa of await etiquetas(false)) {
      C.etiquetas.push({ capa, x: xe, y: y + 2 });
      xe += capa.w + 14;
    }
    y += 58 + 12;
  }
  for (const e of C.etiquetas) dicho.push(e.capa.texto);

  // La letra chica: de dónde sale el precio y cuándo se revisó. En 34 px no cabe en un renglón entre el margen
  // y la columna de botones (mide 888 px y hay 852), así que va en dos.
  const notas = [];
  if (producto.revisado) notas.push(`Precio revisado ${producto.revisado.fecha} ${producto.revisado.hora}`);
  notas.push('Precios en Mercado Libre');
  for (const [i, nota] of notas.entries()) {
    const capa = await capas.renglon(nota, { tam: 34, alto: 42, peso: 400, color: COLOR.nota, anchoMax: ANCHO_TEXTO });
    if (!capa) throw new Error(`No cabe la nota: ${nota}`);
    C.pie.push({ capa, y: y + i * 40 });
    dicho.push(nota);
  }
  C.alto = Math.round(y + (notas.length - 1) * 40 + lineaBase(34, 42) + 2);
  C.relleno = Math.round(40 - arribaDeLetra(nombre.tam, nombre.alto));
  return C;
}

// --- Z. El cierre -------------------------------------------------------------------------------------------
async function armarCierre(producto, cta, dicho) {
  const Z = {};
  Z.logo = await capas.logoGrande(400); // se muestra a 200 px
  Z.luz = resplandor(960, 960, 0.2);
  Z.marca = await capas.nombreMarca(96);
  // La llamada: en negrita, de 76 px o más si cabe en dos renglones; si es larga baja hasta 40 px y, si ni así,
  // se corta con puntos suspensivos. Va centrada y nunca pasa de x=924 (768 px de ancho).
  const ancho = 2 * (SEGURO.derecha - W / 2);
  const llamada = await capas.bloque(cta, { anchoMax: ancho, peso: 800, pasos: [88, 82, 76, 68, 60, 52, 46, 40].map((tam) => ({ tam, alto: Math.round(tam * 1.14), espaciado: -0.022 * tam })) });
  Z.llamada = llamada.capas;
  Z.llamadaAlto = llamada.alto;
  Z.llamadaTam = llamada.tam;
  dicho.push(llamada.filas.join(' '));
  Z.llamadaCortada = llamada.filas.join(' ') !== cta ? llamada.filas.join(' ') : null;
  Z.pie = [];
  const notas = [];
  if (producto.revisado) notas.push(`Precio revisado ${producto.revisado.fecha} ${producto.revisado.hora}`);
  notas.push('Precios en Mercado Libre');
  for (const nota of notas) Z.pie.push(await capas.renglon(nota, { tam: 34, alto: 44, peso: 400, color: COLOR.nota, anchoMax: ancho }));
  // El bloque entero va centrado en la zona que las apps dejan libre.
  const altoLlamada = Z.llamada.length * Z.llamadaAlto;
  const total = 200 + 20 + Z.marca.h + 26 + 6 + 34 + altoLlamada + 30 + Z.pie.length * 44;
  let y = Math.round((SEGURO.arriba + SEGURO.abajo) / 2 - total / 2);
  Z.logoY = y + 100; // centro del logo
  y += 200 + 20;
  Z.marcaY = y;
  y += Z.marca.h + 26;
  Z.reglaY = y;
  y += 6 + 34;
  Z.llamadaY = y;
  y += altoLlamada + 30;
  Z.pieY = y;
  return Z;
}

/** El sitio para la foto entre `arriba` y `abajo`, sin pasar de `anchoMax` ni estirar la foto más de la cuenta. */
function caja(foto, arriba, abajo, anchoMax) {
  const w = Math.min(anchoMax, foto.original.w * ESTIRAR_MAX);
  const h = Math.min(abajo - arriba, foto.original.h * ESTIRAR_MAX, w / foto.proporcion);
  return { w: h * foto.proporcion, h, cx: W / 2, cy: (arriba + abajo) / 2 };
}

/**
 * Dibuja todas las capas del producto y resuelve las medidas. Se hace una sola vez por video.
 * Devuelve la escena (lo que necesita el pintor) con `dicho`: todo el texto que va a salir escrito (cada
 * entrada es un texto o { texto, nota }), en el orden en que aparece.
 */
export async function preparar(producto, cta, { zonas = false } = {}) {
  const dicho = ['ComparaTech'];
  const leida = await leerFoto(producto.foto); // primero la foto: si no se puede leer, no se arma nada
  const apaisada = leida.proporcion >= PROPORCION_APAISADA;
  const L = { marca: await capas.pastillaMarca(MARCA_ALTO), luzBaja: resplandor(1500, 800, 0.17) };
  const A = await armarGancho(producto, apaisada, dicho);
  const B = await armarNombre(producto, apaisada, dicho);
  const C = await armarPrecio(producto, dicho);
  const Z = await armarCierre(producto, cta, dicho);
  const escenas = { A, B, C };
  const claves = A ? ['A', 'B', 'C'] : ['B', 'C'];

  // Dónde queda el borde de arriba de la hoja en cada momento y dónde va la foto.
  const tope = {};
  const cajas = {};
  if (apaisada) {
    // Foto apaisada: vive entera arriba de la mitad de la pantalla y la hoja sube hasta ella (sin hueco entre
    // las dos). La hoja no se mueve; cada momento va centrado en el alto que le queda.
    const topeContenido = Math.min(...claves.map((k) => PIE - escenas[k].relleno - escenas[k].alto)); // más abajo, algo no cabría
    const libre = Math.min(FOTO_BAJO_APAISADA, topeContenido - FOTO_AIRE);
    const c = caja(leida, FOTO_ARRIBA, libre, FOTO_ANCHO_APAISADA);
    const fijo = Math.min(topeContenido, Math.max(Math.round(FOTO_ARRIBA + c.h + FOTO_AIRE), topeContenido - 70));
    const fin = Math.min(FOTO_BAJO_APAISADA, fijo - FOTO_AIRE);
    for (const k of claves) {
      tope[k] = fijo;
      cajas[k] = { ...c, cy: (FOTO_ARRIBA + fin) / 2 };
    }
  } else {
    // Foto alta o cuadrada: la hoja mide lo que mide lo que dice, así la foto ocupa todo el resto.
    for (const k of claves) {
      tope[k] = PIE - escenas[k].relleno - escenas[k].alto;
      cajas[k] = caja(leida, FOTO_ARRIBA, tope[k] - FOTO_AIRE, FOTO_ANCHO_ALTA);
    }
  }
  if (!A) {
    tope.A = tope.B;
    cajas.A = cajas.B;
  }
  // Desde el borde de la hoja hasta donde empieza lo escrito, en cada momento. Si sobra alto (foto apaisada),
  // lo escrito baja un poco para quedar centrado, pero sin despegarse de la foto.
  const des = {};
  for (const k of claves) des[k] = escenas[k].relleno + limitar(Math.floor((PIE - tope[k] - escenas[k].relleno - escenas[k].alto) / 2), 0, 60);

  // La foto, al tamaño más grande que se va a mostrar. Si en la escena del precio se muestra bastante más
  // chica que su archivo, ahí se usa una copia achicada (se ve más fina que achicarla cuadro a cuadro).
  const anchoMax = Math.max(cajas.A.w, cajas.B.w, cajas.C.w);
  const foto = await prepararFoto(leida, anchoMax);
  const k = cajas.C.w / foto.caja.w;
  const fotoC = k < 0.9 ? await achicar(foto, k) : foto;

  const avisos = [];
  const estirada = anchoMax / leida.original.w;
  if (estirada > 1.25) avisos.push(`la foto es chica (el producto mide ${leida.original.w}x${leida.original.h} px): se muestra a ${Math.round(anchoMax)} px de ancho, ${coma(estirada)} veces su tamaño${estirada >= ESTIRAR_MAX - 0.01 ? ' (el tope, para que no se vea borrosa)' : ''}.`);
  if (Z.llamadaCortada) avisos.push(`la llamada del cierre es muy larga: ni en 40 px cabe en dos renglones, así que sale cortada ("${Z.llamadaCortada}").`);
  if (leida.modo === 'lamina') avisos.push('la foto no viene sobre fondo blanco: se muestra entera, como una lámina con sombra.');

  return {
    L, A, B, C, Z, tope, des, cajas, foto, fotoC, apaisada, zonas, dicho, avisos,
    medidas: {
      foto: leida.modo,
      original: leida.original,
      gancho: A ? `${Math.round(cajas.A.w)}x${Math.round(cajas.A.h)}` : null,
      nombre: `${Math.round(cajas.B.w)}x${Math.round(cajas.B.h)}`,
      precio: `${Math.round(cajas.C.w)}x${Math.round(cajas.C.h)}`,
      precioTam: C.precio.capa.tam,
      llamadaTam: Z.llamadaTam,
    },
  };
}

/**
 * El guion: en qué segundo pasa cada cosa. Sin gancho (producto sin descuento ni baja) el video parte con el
 * nombre y el precio llega antes.
 */
export function tiempos(conGancho) {
  const T = {};
  // El primer cuadro es la portada del video en las grillas: nace completo, con su texto ya puesto.
  T.ganchoSale = conGancho ? 1.4 : null; // el gancho se va (termina de irse a los 1,68)
  T.cambio = conGancho ? [1.5, 2.0] : null; // la hoja y la foto se acomodan para el nombre
  T.nombre = conGancho ? 1.78 : -1; // entran la marca y el nombre
  T.sube = conGancho ? 2.9 : 2.2; // la hoja sube para el precio
  T.nombreSale = T.sube - 0.08;
  T.subida = [T.sube, T.sube + 0.32]; // rápido: cuando el precio empieza a caer la hoja ya casi llegó
  T.precio = T.sube + 0.22; // el precio empieza a caer...
  T.golpe = T.sube + 0.4; // ...y aquí pega (3,3 s con gancho)
  T.descuento = T.golpe + 0.3;
  T.lista = T.golpe + 0.46;
  T.tachado = [T.golpe + 0.74, T.golpe + 1.04];
  T.etiquetas = T.golpe + 1.2;
  T.pie = T.golpe + 1.6;
  T.brillo = [T.golpe + 3.0, T.golpe + 3.7]; // un brillo pasa por el descuento y el precio, con todo ya quieto
  T.cierre = conGancho ? 7.9 : 7.5; // la hoja sube del todo
  T.portada = T.cierre - 0.4; // el cuadro que se guarda con --portada: la escena del precio completa
  T.fin = T.cierre + 2.25;
  return T;
}

/** Ocho momentos para la hoja de contactos, con su rótulo. */
export function momentos(T) {
  const g = T.ganchoSale != null;
  return [
    { t: 0, rotulo: 'cuadro 0 (portada)' },
    g ? { t: 0.9, rotulo: 'gancho' } : { t: 1.2, rotulo: 'nombre y marca' },
    g ? { t: 2.5, rotulo: 'nombre y marca' } : { t: T.precio + 0.1, rotulo: 'el precio cae' },
    { t: T.golpe + 0.04, rotulo: 'golpe del precio' },
    { t: T.golpe + 0.62, rotulo: 'después del golpe' },
    { t: T.portada, rotulo: 'precio completo' },
    { t: T.cierre + 0.3, rotulo: 'entra el cierre' },
    { t: T.fin - 0.3, rotulo: 'cierre' },
  ];
}

/**
 * Devuelve pintar(lienzo, segundo): dibuja el cuadro completo de ese instante. No recuerda nada de un cuadro
 * a otro, así que los cuadros se pueden pintar en cualquier orden y en varios hilos a la vez.
 */
export function pintor(escena, T) {
  const { L, A, B, C, Z, tope, des, cajas, foto, fotoC, apaisada, zonas } = escena;
  const fondo = fondoEstudio();
  poner(fondo, L.marca, MARGEN, MARCA_Y);
  const hoja = hojaOscura({ radio: RADIO });
  const BLANCO = [255, 255, 255];
  const CIAN = rgb(COLOR.cian);
  const DESTELLO = [150, 232, 255]; // cian claro: el golpe de luz cuando pega el precio
  const x = MARGEN;

  // El acercamiento: la foto crece despacio todo el tiempo y llega con un pequeño impulso en el primer segundo.
  // La caja de cada momento es su tamaño máximo: nunca la pasa.
  const impulso = (t) => 0.01 * (1 - suave.sale(fase(t, 0, 0.8)));
  const zoomCorrido = (t) => 0.985 + 0.015 * fase(t, 0, T.cierre + 0.5) - impulso(t);
  const zoomAntes = (t) => 0.985 + 0.015 * fase(t, 0, T.sube) - impulso(t);
  const zoomPrecio = (t) => 0.995 + 0.005 * fase(t, T.sube, T.cierre + 0.5);
  // El número del gancho late una vez al empezar, sin pasarse nunca de x=924.
  const latidoMax = A ? Math.min(0.05, (ANCHO_TEXTO - 2) / (A.numero.capa.tinta.x1 + 1) - 1) : 0;

  /** Aparece con una subida corta. */
  const asomar = (dst, capa, xx, yy, p, desde = 14, opacidad = 1) => {
    if (p <= 0) return;
    const e = suave.sale(p);
    poner(dst, capa, xx, yy + (1 - e) * desde, e * opacidad);
  };
  /** Un brillo que cruza la capa una vez mientras `p` va de 0 a 1; fuera de eso, la capa tal cual. */
  const conBrillo = (dst, capa, xx, yy, opacidad, p, color, ancho = 210, fuerza = 0.85) => {
    if (p > 0 && p < 1) ponerConBrillo(dst, capa, xx, yy, opacidad, xx + mezcla(-ancho - 50, capa.w + ancho + 50, suave.entraSale(p)), ancho, color, fuerza);
    else poner(dst, capa, xx, yy, opacidad);
  };

  return function pintar(dst, t) {
    const pAB = T.cambio ? suave.entraSale(fase(t, T.cambio[0], T.cambio[1])) : 1;
    const pBC = suave.entraSale(fase(t, T.subida[0], T.subida[1]));
    const pZ = suave.entraSale(fase(t, T.cierre, T.cierre + 0.55));
    const g = t - T.golpe; // segundos desde que pegó el precio
    const sacudida = g >= 0 && g < 0.6 ? 7 * Math.exp(-9 * g) * Math.cos(26 * g) : 0;
    const borde = Math.round(mezcla(mezcla(mezcla(tope.A, tope.B, pAB), tope.C, pBC) + sacudida, -120, pZ));

    // 1. Fondo de estudio con la pastilla de la marca (solo lo que no tapa la hoja).
    const filas = Math.max(0, Math.min(H, borde + RADIO));
    dst.set(fondo.subarray(0, filas * W * 3));

    // 2. La foto: se acerca despacio todo el tiempo y se acomoda cuando la hoja cambia de alto.
    if (filas > FOTO_ARRIBA - 40) {
      const zoom = apaisada ? zoomCorrido(t) : mezcla(zoomAntes(t), zoomPrecio(t), pBC);
      const w = mezcla(mezcla(cajas.A.w, cajas.B.w, pAB), cajas.C.w, pBC) * zoom;
      const cy = mezcla(mezcla(cajas.A.cy, cajas.B.cy, pAB), cajas.C.cy, pBC);
      const f = pBC > 0.5 ? fotoC : foto; // el cambio de copia cae en pleno movimiento: no se ve
      const escala = w / f.caja.w;
      const h = f.caja.h * escala;
      const xx = W / 2 - w / 2;
      const yy = cy - h / 2;
      if (f.modo === 'fundida') sombraDeApoyo(dst, W / 2, yy + h + Math.max(10, w * 0.012), w * 0.47, Math.max(12, w * 0.026), 0.2, filas);
      ponerFoto(dst, f.img, xx - f.caja.x * escala, yy - f.caja.y * escala, escala, filas);
    }

    // 3. La hoja, con una luz cian muy leve al fondo (ahí las apps ponen su texto: no lleva nada nuestro) y,
    //    cuando pega el precio, un golpe de luz que se apaga en menos de medio segundo.
    hoja(dst, borde);
    poner(dst, L.luzBaja, W / 2 - L.luzBaja.w / 2, H + 60 - L.luzBaja.h / 2, 1, [0, Math.max(0, borde + RADIO), W, H]);
    if (g >= 0 && g < 0.45) destelloHoja(dst, borde, RADIO, DESTELLO, 0.24 * (1 - g / 0.45) ** 2);

    // 4. Lo que dice la hoja. Todo cuelga de su borde de arriba.
    // A. El gancho: está completo desde el cuadro 0. El número late una vez y lo cruza un brillo; después se va.
    if (A && t < T.ganchoSale + 0.4) {
      const o = borde + des.A;
      const sale = suave.entra(fase(t, T.ganchoSale, T.ganchoSale + 0.2));
      if (sale < 1) {
        const c = A.numero.capa;
        const yy = o + A.numero.y - sale * 36;
        const latido = 1 + latidoMax * Math.sin(Math.PI * fase(t, 0.1, 0.5));
        if (latido > 1.0005) ponerEscalada(dst, c, x, yy + c.h / 2, latido, 1, [0, 0.5]);
        else conBrillo(dst, c, x, yy, 1 - sale, sale > 0 ? 0 : fase(t, 0.55, 1.2), [235, 250, 255], 220, 0.9);
      }
      A.frases.forEach(({ capa, y }, i) => {
        const s = suave.entra(fase(t, T.ganchoSale + 0.04 * (i + 1), T.ganchoSale + 0.04 * (i + 1) + 0.2));
        if (s < 1) poner(dst, capa, x, o + y - s * 30, 1 - s);
      });
    }

    // B. La marca y el nombre: suben desde detrás de su línea. Se van justo antes de que suba el precio.
    const saleB = suave.entra(fase(t, T.nombreSale, T.nombreSale + 0.16));
    if (t >= T.nombre && saleB < 1) {
      const o = borde + des.B - saleB * 24;
      if (B.kicker) {
        const p = suave.sale(fase(t, T.nombre, T.nombre + 0.32));
        poner(dst, B.kicker.capa, x - (1 - p) * 24, o + B.kicker.y, p * (1 - saleB));
      }
      B.nombre.forEach(({ capa, y }, i) => {
        const entra = fase(t, T.nombre + 0.06 + 0.08 * i, T.nombre + 0.06 + 0.08 * i + 0.45);
        if (entra <= 0) return;
        const e = suave.saleFuerte(entra);
        const yy = o + y;
        poner(dst, capa, x, yy + (1 - e) * capa.h * 0.85, Math.min(1, entra * 3.5) * (1 - saleB), [x, yy, x + capa.w, yy + capa.h]);
      });
    }

    // C. El precio. Se apaga cuando la hoja sube al cierre.
    const dentro = 1 - fase(t, T.cierre - 0.04, T.cierre + 0.2);
    if (t >= T.sube && dentro > 0) {
      const o = borde + des.C;
      C.nombre.forEach(({ capa, y }, i) => asomar(dst, capa, x, o + y, fase(t, T.sube + 0.12 + 0.05 * i, T.sube + 0.4 + 0.05 * i), 14, dentro));

      // El precio cae desde más grande, pega y rebota apenas. Siempre es el precio real: no hay conteo.
      const tp = t - T.precio;
      if (tp >= 0) {
        const c = C.precio.capa;
        const yy = o + C.precio.y;
        const caida = T.golpe - T.precio;
        let escala;
        if (tp < caida) escala = mezcla(C.precio.desde, 0.965, suave.entra(tp / caida));
        else {
          const r = tp - caida;
          escala = Math.min(C.precio.desde, 1 - 0.035 * Math.exp(-10 * r) * Math.cos(26 * r)); // el rebote tampoco pasa de x=924
        }
        if (Math.abs(escala - 1) < 0.0015) escala = 1;
        // Se achica hacia su esquina de arriba a la izquierda: mientras cae crece hacia abajo, donde todavía no
        // hay nada, y así no pisa el nombre.
        if (escala !== 1) ponerEscalada(dst, c, x, yy + c.h * 0.08, escala, Math.min(1, tp / 0.07) * dentro, [0, 0.08]);
        else {
          const p1 = fase(t, T.golpe + 0.25, T.golpe + 0.95);
          conBrillo(dst, c, x, yy, dentro, p1 > 0 && p1 < 1 ? p1 : fase(t, T.brillo[0] + 0.15, T.brillo[1] + 0.25), CIAN);
        }
      }

      // El descuento salta a su lugar; después aparece el precio de lista y se tacha solo.
      if (C.pastilla) {
        const pd = fase(t, T.descuento, T.descuento + 0.36);
        if (pd > 0) {
          const c = C.pastilla.capa;
          const xx = x + C.pastilla.x;
          const yy = o + C.pastilla.y;
          if (pd < 1) ponerEscalada(dst, c, xx + c.w / 2, yy + c.h / 2, 0.5 + 0.5 * suave.rebote(pd), Math.min(1, pd * 4) * dentro);
          else conBrillo(dst, c, xx, yy, dentro, fase(t, T.brillo[0], T.brillo[1]), BLANCO, 110, 0.75);
        }
        const pl = suave.sale(fase(t, T.lista, T.lista + 0.3));
        if (pl > 0) for (const pieza of C.lista) poner(dst, pieza.capa, x + pieza.x + (1 - pl) * 26, o + pieza.y, pl * dentro);
        if (C.tachado) {
          const pt = suave.entraSale(fase(t, T.tachado[0], T.tachado[1]));
          if (pt > 0) rectangulo(dst, x + C.tachado.x, o + C.tachado.y, C.tachado.w * pt, 4, BLANCO, dentro);
        }
      }
      C.etiquetas.forEach((e, i) => asomar(dst, e.capa, x + e.x, o + e.y, fase(t, T.etiquetas + 0.12 * i, T.etiquetas + 0.12 * i + 0.3), 14, dentro));
      C.pie.forEach((p, i) => {
        const pp = fase(t, T.pie + 0.08 * i, T.pie + 0.08 * i + 0.4);
        if (pp > 0) poner(dst, p.capa, x, o + p.y, suave.sale(pp) * dentro);
      });
    }

    // Z. El cierre: logo, ComparaTech, una línea, la llamada y la letra chica. Todo centrado.
    if (t > T.cierre + 0.15) {
      const c0 = T.cierre;
      const pLogo = fase(t, c0 + 0.25, c0 + 0.75);
      if (pLogo > 0) {
        poner(dst, Z.luz, W / 2 - Z.luz.w / 2, Z.logoY - Z.luz.h / 2, suave.sale(pLogo));
        const deriva = 1 + 0.03 * fase(t, c0 + 0.25, T.fin); // sigue acercándose apenas: el cierre no queda congelado
        ponerEscalada(dst, Z.logo, W / 2, Z.logoY, 0.5 * (0.6 + 0.4 * suave.rebote(pLogo)) * deriva, Math.min(1, pLogo * 3.5));
      }
      const pMarca = fase(t, c0 + 0.36, c0 + 0.86);
      if (pMarca > 0) {
        const m = Z.marca;
        const e = suave.saleFuerte(pMarca);
        const xx = Math.round(W / 2 - m.w / 2);
        poner(dst, m, xx, Z.marcaY + (1 - e) * m.h * 0.8, Math.min(1, pMarca * 3), [xx, Z.marcaY, xx + m.w, Z.marcaY + m.h]);
      }
      const pRegla = suave.sale(fase(t, c0 + 0.5, c0 + 0.85));
      if (pRegla > 0) rectangulo(dst, W / 2 - 60 * pRegla, Z.reglaY, 120 * pRegla, 6, CIAN, 1);
      Z.llamada.forEach((capa, i) => {
        const p = fase(t, c0 + 0.52 + 0.08 * i, c0 + 0.52 + 0.08 * i + 0.45);
        if (p <= 0) return;
        const e = suave.saleFuerte(p);
        const xx = Math.round(W / 2 - capa.w / 2);
        const yy = Z.llamadaY + i * Z.llamadaAlto;
        poner(dst, capa, xx, yy + (1 - e) * capa.h * 0.8, Math.min(1, p * 3.5), [xx, yy, xx + capa.w, yy + capa.h]);
      });
      Z.pie.forEach((capa, i) => asomar(dst, capa, Math.round(W / 2 - capa.w / 2), Z.pieY + i * 44, fase(t, c0 + 0.7 + 0.06 * i, c0 + 1.05 + 0.06 * i), 12));
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
