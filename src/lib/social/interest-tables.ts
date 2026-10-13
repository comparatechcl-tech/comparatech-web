/**
 * Tablas y pesos del puntaje de interés (ver lib/social/interest).
 *
 * Todo lo que es criterio editorial vive acá, en un solo lugar: qué tipo de
 * producto hace que alguien deje de deslizar, qué marcas reconoce la gente y
 * cuánto pesa cada cosa. Son juicios, no mediciones: el dueño puede corregir
 * un número de estas tablas sin tocar las cuentas.
 *
 * Las expresiones se aplican sobre el nombre en minúsculas, sin tildes y sin
 * puntuación (normalizeName), siempre con límite de palabra: "Disipador" no
 * es un iPad. Sin lookbehind ni grupos con nombre (el sitio compila a ES2017).
 */

// ---------------------------------------------------------------------------
// Pesos

/** Los números que se tocan para afinar el orden. Sin señales, el tope es 100. */
export const INTEREST_WEIGHTS = {
  // 2. Marca
  brandStar: 12,
  brandKnown: 7,
  brandUnknown: 0,
  brandGeneric: -4,

  // 3. Qué tan real es la oferta (tope 25)
  deal: 25,
  /** Una baja vista por el sitio: hasta 20 puntos, que se alcanzan con 30%. */
  drop: 20,
  dropFullAtPct: 30,
  /**
   * Una baja de pocos pesos no es noticia: el porcentaje se multiplica por
   * 0,25 + 0,375 × log10(monto / 1.000), entre 0,25 ($1.000 o menos) y 1
   * ($100.000 o más). $5.000 pesa la mitad; $20.000, tres cuartos.
   */
  dropAmountBase: 0.25,
  dropAmountPerDecade: 0.375,
  /** Historial de 0, 1 y 2 o más días: una baja recién vista vale menos. */
  dropByDays: [0.5, 0.7, 1],
  /**
   * El descuento sobre el precio de lista: hasta 10 puntos. Se cuenta desde
   * 10% (menos que eso no es noticia) y llega al tope
   * con 40%: 20% vale un tercio, 30% dos tercios.
   */
  list: 10,
  listFromPct: 10,
  listFullAtPct: 40,
  /** Pasado este descuento de lista, cada punto extra resta uno (a 80% ya no vale nada): casi siempre es una lista inflada. */
  listFadesFromPct: 50,
  /** Si quien vende no es tienda oficial ni Mercado Libre, la cifra se le atribuye ya desde acá. */
  sellerFigureFromPct: 40,
  /** Con menos de dos días de historial no se pudo comprobar si estuvo más barato. */
  listShortHistory: 0.9,
  /**
   * Cuánto se le cree al precio de lista. La marca sola llega a la mitad: el
   * precio de lista lo pone quien vende, y cualquiera puede inflarlo…
   */
  listTrustStar: 0.5,
  listTrustKnown: 0.45,
  listTrustUnknown: 0.25,
  listTrustGeneric: 0.15,
  /** …así que pesa tanto o más quién vende (se suman, con tope 1). */
  listTrustOfficialStore: 0.25,
  listTrustSoldByMl: 0.25,
  /**
   * Un vendedor que no es tienda oficial ni Mercado Libre y lleva menos
   * ventas que esto puede poner cualquier marca y cualquier precio de lista:
   * a su descuento se le cree como al de una marca desconocida.
   */
  listTrustSmallSellerBelow: 1_000,

  // 4. Alcance (0-15): hasta $30.000 lo puede pagar casi cualquiera.
  reach: 15,
  reachFullUntil: 30_000,
  /** Cuántas décadas de precio hacen falta para llegar a cero (1,6: cerca de $1.200.000). */
  reachDecades: 1.6,
  reachMin: 1,
  /**
   * Lo caro que igual hace mirar: un tipo "héroe" con una baja de verdad y un
   * vendedor de confianza no baja de este alcance (el de algo de $100.000).
   */
  heroReach: 10,
  heroMinDropPct: 5,
  heroMinDropAmount: 10_000,
  heroMinDays: 2,
  heroMinSales: 1_000,

  // 5. Comisión (0-10), en escala logarítmica entre $500 y $30.000.
  commission: 10,
  commissionFrom: 500,
  commissionFullAt: 30_000,

  // 6. Entrega y confianza (hasta 8)
  freeShipping: 3,
  full: 2,
  soldByMl: 2,
  warranty: 1,

  // 7. Señales opcionales (tope 6)
  signals: 6,
  /** [hasta la posición, puntos] en los más vendidos de su categoría en Mercado Libre. */
  positionSteps: [
    [3, 4],
    [10, 3],
    [20, 2],
    [50, 1],
  ],
  /** Menos clics que esto no cuentan: con tan pocos, el orden lo decidiría el ruido. */
  clicksMin: 3,
  clicksMax: 3,
  /** Más clics que esto no es un conteo, es un error: se ignora para no escribir "1e+21 clics". */
  clicksSaneMax: 1_000_000,

  // 8. Castigos
  penaltyCodeName: 4,
  /**
   * Precio movido: dos o más cambios en 48 horas, o un precio que va y vuelve
   * entre los mismos valores. La imagen que se publica lleva el precio
   * escrito: si cambia a las horas, quien llega a Mercado Libre ve otro.
   */
  movingPriceFromChanges: 2,
  penaltyMovingPrice: 6,
  /**
   * Muchos vendedores en la misma ficha se turnan la caja de compra, y con
   * ella el precio. Medido el 12-10-2026: con un vendedor el precio cambia
   * unas 0,6 veces cada 48 horas; con cuatro o más, entre 1,4 y 3,9.
   */
  manySellersFrom: 4,
  penaltyManySellers: 4,
  /** Otro vendedor tiene el mismo producto a menos en la misma publicación: el precio que mostramos no es el mejor. */
  penaltyNotLowest: 6,
  /** Un vendedor casi sin ventas es lo que más puede hacer quedar mal a la cuenta. */
  penaltyFewSales: 12,
  fewSalesBelow: 100,
  /** No es nuevo (reacondicionado, usado, caja abierta…): el nombre del peso quedó de cuando solo se veía lo primero. */
  penaltyRefurbished: 5,
  /**
   * Oferta chica: si el bloque de oferta da menos de 3 puntos (una baja de
   * $1.000, o 20% de lista dicho por un vendedor cualquiera), se restan 3 por
   * cada punto que falte. Lo deseable no alcanza si no hay oferta que mostrar.
   */
  weakDealBelow: 3,
  penaltyWeakDealPerPoint: 3,
  /** Precio sobre el mínimo que el sitio registró en 30 días: hasta 3% no se cuenta… */
  seenCheaperFromPct: 3,
  /** …de ahí, 4 puntos por cada 1%… */
  seenCheaperPerPct: 4,
  /** …hasta 30. */
  seenCheaperMax: 30,
  /** 9. Desde esta diferencia con el mínimo de 30 días el producto no se publica. */
  excludeAbovePct: 10,
} as const;

// ---------------------------------------------------------------------------
// Tipos de producto

/** [expresión, etiqueta para la frase, deseo 0-30] */
export type TypeRule = [RegExp, string, number];

/**
 * Qué es el producto, por las palabras del nombre.
 *
 * Gana la regla cuya palabra aparece PRIMERO en el nombre: los nombres de
 * Mercado Libre parten por lo que el producto es ("Soporte TV…" es un
 * soporte, "Smart TV… + Control" es un televisor). Si dos empatan en
 * posición, gana la que está antes en esta tabla.
 *
 * El deseo es un juicio editorial: qué tan seguido la gente anda buscando
 * esto y qué tan bien se ve en una historia.
 */
export const TYPE_RULES: TypeRule[] = [
  // Lo que la gente sueña o anda buscando siempre.
  // Una Switch se nombra sin decir "consola" ni sus GB: "Nintendo Switch Lite Turquesa".
  [/\bconsola\b|^(ps[45]|playstation ?[45]|xbox series [sx]|nintendo switch)\b.*\b\d+ ?(tb|gb)\b|^nintendo switch (lite|oled|2)\b/, 'Consola', 30],
  [/\b(celular|smartphone|iphone)\b|\bgalaxy [asz] ?\d|\bmoto (edge|[ge] ?\d)|\bredmi (note )?\d|\bpoco [xmfc] ?\d|\bhonor x\d/, 'Celular', 28],
  [/\b(smart tv|televisor|television)\b|\b(qled|oled|uhd|mini led)\b.*\btv\b/, 'Smart TV', 27],
  [/\b(audifonos?|auricular(es)?|buds|headset|earbuds|airpods)\b/, 'Audífonos', 24],
  // Va antes que el notebook para ganarle el empate: "Ryzen 5 … Ssd 512gb Pc Gamer" calza en los dos desde
  // el procesador, y es un computador de escritorio. "Notebook … Ryzen" sigue siendo notebook: parte antes.
  // Su deseo no baja de HIGH_DESIRE: así un "Mousepad Para Pc Gamer" no se vuelve un computador.
  [/(\b(ryzen|core i\d|intel core)\b.*)?\b(pc gamer|mini pc|pc de escritorio|computador de escritorio|all in one)\b/, 'Computador de escritorio', 19],
  [/\b(notebook|laptop|macbook|ideapad|vivobook|book ?\d)\b|\b(ryzen|core i\d|intel core)\b.*\b(rtx|ssd|512gb|1tb)\b/, 'Notebook', 23],
  [/\b(tablet|ipad|galaxy tab|redmi pad|ideatab)\b|^tab [a-z]?\d/, 'Tablet', 23],
  [/\b(freidora|air ?fryer)\b/, 'Freidora de aire', 22],
  // "Watch Dogs" es un juego, no un reloj.
  [/\b(smartwatch|smartband|reloj inteligente|pulsera inteligente|watch(?! dogs)|galaxy fit ?\d?|huawei fit|(huawei|xiaomi|honor|redmi|smart|mi) band)\b/, 'Reloj inteligente', 21],
  [/\b(parlantes?|speaker|altavoz|boombox)\b/, 'Parlante', 21],
  [/\b(aspiradora robot|robot aspirador(a)?)\b/, 'Aspiradora robot', 20],
  // "Juego" a secas no está acá: solo vale en la categoría gaming (TYPE_RULES_BY_CATEGORY).
  [/\b(videojuego|pokemon|zelda|mario|minecraft|ea sports fc|fifa|call of duty|fortnite|gta|grand theft auto|spider man|god of war|donkey kong|smash bros|astro bot|gran turismo|watch dogs)\b|\b(standard edition|edicion estandar|formato fisico|edicion fisica)\b/, 'Videojuego', 19],
  [/\b(echo (dot|spot|show|pop)|bocina inteligente|parlante inteligente)\b/, 'Parlante inteligente', 17],
  [/\b(barra de sonido|soundbar|sound bar|home theaters?)\b/, 'Barra de sonido', 16],
  [/\bsilla (gamer|gaming)\b/, 'Silla gamer', 16],
  [/\bmonitor(es)?\b/, 'Monitor', 16],
  [/\b(kindle|kobo|e ?reader)\b/, 'Lector de libros', 15],
  [/\bcafetera\b/, 'Cafetera', 15],
  [/\b(tv ?box|box 4k|tv stick|stick|streamer|chromecast|fire tv|dispositivo de streaming|roku (premier|express|ultra|streaming))\b/, 'Streaming para la TV', 14],
  [/\b(drone?|dron|dji (flip|mini|neo|air|mavic|avata|lito))\b/, 'Drone', 14],
  [/\b(proyector|projector)\b/, 'Proyector', 14],
  [/\bcamara (de accion|deportiva|digital|instantanea|de fotos)\b|\b(gopro|instax|osmo (action|pocket))\b/, 'Cámara', 14],
  // "Refrigerador frigobar" es un frigobar: va antes para ganar el empate.
  [/\b(refrigerador )?(frigobar|minibar)\b/, 'Frigobar', 12],
  [/\b(refrigerador|side by side)\b/, 'Refrigerador', 14],
  [/\baspiradora\b/, 'Aspiradora', 14],
  [/\b(lavadora|secadora de ropa)\b/, 'Lavadora', 13],
  [/\b(power ?bank|bateria (externa|portatil)|cargador portatil)\b/, 'Batería externa', 13],
  [/\bstarlink\b|\binternet (via )?satelit/, 'Internet satelital', 13],
  [/\b(horno (de )?)?microondas\b/, 'Microondas', 12],
  // "Control remoto" va antes que el control de consola: los dos calzan en la primera palabra.
  // Un "Control Smart TV Samsung" también es remoto, salvo que el nombre hable de jugar.
  [/\bcontrol remoto\b|^control\b(?!.*\b(ps[345]|playstation|play station|xbox|nintendo|switch|gamepad|joystick|dualsense|dualshock|gamer|gaming|juegos?|consolas?)\b).*\b(tv|televisor|television|aire acondicionado)\b/, 'Control remoto', 3],
  [/^control\b|\b(joystick|gamepad|mando|controlador|controller|dualsense|dualshock)\b/, 'Control para jugar', 12],
  [/\blector de discos\b/, 'Lector de discos para consola', 12],
  [/\b(secador de pelo|alisador|plancha de pelo)\b/, 'Cuidado del pelo', 12],
  [/\bcamaras?\b.*\b(seguridad|vigilancia)\b|\b(security camera|camara ip)\b/, 'Cámara de seguridad', 11],
  [/\bimpresora\b/, 'Impresora', 11],
  [/\bsilla\b/, 'Silla de escritorio', 11],
  [/\b(escritorio|mesa)\b/, 'Escritorio', 10],
  [/\b(localizador|rastreador|smart finder|smart ?tag\d?|airtag|moto tag)\b/, 'Localizador', 10],
  [/\b(licuadora|batidora|juguera)\b/, 'Electrodoméstico de cocina', 10],
  // Útil, pero nadie deja de deslizar por esto.
  [/\bhorno (empotrad[oa]|empotrable)\b/, 'Horno empotrable', 5],
  [/\bhorno\b/, 'Horno eléctrico', 12],
  [/\b(mouse|raton|teclado)\b/, 'Mouse o teclado', 9],
  [/\bcargador\b/, 'Cargador', 9],
  [/\bmicrofonos?\b/, 'Micrófono', 9],
  [/\bdisco duro\b|\bssd externo\b/, 'Disco externo', 9],
  [/\b(tira|cinta)\b.*\bled\b|\bretroiluminacion\b/, 'Tira de luces LED', 9],
  [/\b(tripode|aro (de )?luz|ring light|luz relleno|crear contenido)\b/, 'Accesorio para grabar', 9],
  [/\bhervidor\b/, 'Hervidor', 9],
  [/\b(cortadora de pelo|maquina de corte|afeitadora|depiladora)\b/, 'Cuidado personal', 9],
  [/\b(webcam|camara web)\b/, 'Cámara web', 8],
  [/\b(rack|mueble)\b.*\btv\b/, 'Mueble para TV', 8],
  // El ventilador de un computador ("120mm PWM") no es uno de pie: va antes para ganar el empate.
  [/\bventilador(es)?\b.*\b(pwm|argb|(80|92|120|140) ?mm)\b/, 'Componente de computador', 3],
  [/\b(calefactor|termoventilador|estufa|aire acondicionado|ventilador)\b/, 'Calefactor o ventilador', 8],
  [/\b(freezer|congelador)\b/, 'Freezer', 8],
  [/\b(repetidor|extensor|amplificador de senal|router|enrutador(es)?|mesh|access point|deco|wi ?fi en malla)\b/, 'Router o repetidor wifi', 7],
  [/\bdispensador (de )?agua\b/, 'Dispensador de agua', 7],
  [/\b(disco solido|ssd)\b/, 'Disco SSD', 7],
  [/\b(pendrive|unidad flash|memoria flash|tarjeta de memoria|tarjeta (micro ?)?sd|micro ?sd|sd extreme)\b/, 'Memoria', 6],
  [/\bradio\b|\bwalkie\b/, 'Radio', 6],
  [/\btelefono (de escritorio|de sobremesa|inalambrico|fijo|senior|celular senior)\b|\b(senior|adulto mayor)\b/, 'Teléfono simple', 6],
  [/\bcocina\b/, 'Cocina', 6],
  [/\bantena\b/, 'Antena', 5],
  [/\btimbre\b/, 'Timbre', 5],
  [/\bmemoria ram\b|\bddr\d\b/, 'Memoria RAM', 5],
  [/\bpilas?\b/, 'Pilas', 5],
  [/\bcapturadora\b|\btarjeta de captura\b/, 'Capturadora de video', 5],
  [/\bencimera\b/, 'Encimera', 4],
  [/\b(hub|adaptador|divisor)\b|\busb wi ?fi\b/, 'Adaptador', 4],
  // "Pedestal" solo no basta: un ventilador de pedestal no es un soporte.
  [/\b(soporte|brazo|atril)\b|\b(base|pedestal)\b.*\b(tv|monitor|microfono)\b/, 'Soporte', 4],
  [/\b(ampolletas?|bombillo|tubos?( foco)? led|focos? led|lampara|linterna)\b/, 'Iluminación', 4],
  [/\bcampana\b/, 'Campana de cocina', 3],
  [/\b(calefont?|calentador de agua)\b/, 'Calefont', 3],
  [/\b(ups|estabilizador|refrigeracion liquida|disipador|cooler|pasta termica|thermal pad|metal liquido)\b/, 'Componente de computador', 3],
  [/\b(tintas?|toner|cartuchos?)\b/, 'Tinta para impresora', 3],
  // Lo que acompaña a un aparato y lleva su nombre: "Estuche Rigido Consola Nintendo Switch Oled" no es
  // una consola ni "Mochila Notebook 15.6" un notebook. Como gana la palabra que aparece primero, un
  // aparato que trae su accesorio ("Tablet … + Cover + Lapiz") sigue siendo el aparato.
  [/\b(correa|pulsera|funda|carcasa|case|covers?|estuches?|mochilas?|bolsos?|maletin(es)?|protector(es)?|vidrios? templados?|laminas?|micas?|skins?|almohadillas?|repuestos?|canastillos?|filtros?|bolsas?|dock|lapiz|stylus)\b|\bbase (de carga|cargadora|enfriadora)\b|\b(bateria|pantalla|display)( (de|del|lcd|led|oled|tactil|original|completa|repuesto))* (notebook|laptop|macbook|celular|iphone|ipad|tablet)\b/, 'Accesorio', 3],
  [/^cable\b/, 'Cable', 3],
  [/^switch\b|\bswitch \d+ puertos\b/, 'Switch de red', 3],
  [/\bcamara (de cuerpo|endoscopica)\b/, 'Cámara especial', 3],
  [/\b(escaner|codigo (de )?barras?)\b/, 'Lector de códigos', 2],
  [/\bfilamento\b/, 'Filamento para impresora 3D', 2],
];

/**
 * Frases que deciden sin importar dónde estén: un "stick con juegos retro"
 * no es un aparato de streaming, y un "TV Box" no es un televisor aunque el
 * nombre parta con "Smart TV Box".
 */
export const TYPE_OVERRIDES: TypeRule[] = [
  [/\b(juegos retro|miniconsola|consola retro)\b/, 'Consola retro', 11],
  [/\b(smart )?tv ?box\b/, 'Streaming para la TV', 14],
];

/**
 * Palabras que dicen qué es el producto solo dentro de una categoría del
 * sitio. "Juego" es un videojuego en gaming; un "Juego De Ollas" o un "Juego
 * De Destornilladores" no lo es. Compiten con TYPE_RULES por aparecer primero.
 */
export const TYPE_RULES_BY_CATEGORY: Record<string, TypeRule[]> = {
  gaming: [[/\bjuego\b/, 'Videojuego', 19]],
};

/**
 * Precio mínimo creíble de los tipos caros. Un "Consola Ps5 Base Vertical" de
 * $19.990 no es una consola por mucho que el nombre parta así: bajo este
 * precio el nombre no alcanza y el producto se trata como no reconocido.
 *
 * Calibrados con el catálogo de octubre de 2026: lo más barato de verdad era
 * una consola de $284.990, un notebook de $405.990, un televisor de 32" de
 * $117.990, una tablet de $119.507 y un celular de $99.990. Cada piso queda
 * en menos de la mitad de eso, para que una oferta fuerte o un modelo más
 * sencillo no se pierdan; los accesorios de esos aparatos cuestan bastante menos.
 */
export const MIN_CREDIBLE_PRICE: Record<string, number> = {
  Consola: 100_000,
  Notebook: 150_000,
  'Smart TV': 55_000,
  Tablet: 50_000,
  Celular: 45_000,
};

/** Una "consola" sin ninguna de estas palabras es de las que traen juegos retro, no una que se desee. */
export const PLATFORM_WORDS = /\b(playstation|ps[345]|xbox|nintendo|switch|sw2|steam deck|rog ally)\b/;

/** Audífonos para jugar: interesan a menos gente que unos audífonos para todos. */
export const GAMER_WORDS = /\b(gamer|gaming|jugadores|razer|hyperx|redragon|onikuma)\b/;
export const GAMER_HEADSET: [string, number] = ['Audífonos gamer', 20];
export const RETRO_CONSOLE: [string, number] = ['Consola retro', 11];

/**
 * Desde este deseo un tipo es "de los que se desean". Lo que viene después de
 * "para" o "compatible" no puede convertir un producto en uno de esos.
 */
export const HIGH_DESIRE = 19;

/** Lo que se asume cuando ninguna palabra del nombre dice qué es. [etiqueta, deseo] */
export const CATEGORY_FALLBACK: Record<string, [string, number]> = {
  celulares: ['Producto de telefonía', 10],
  gaming: ['Producto gamer', 12],
  audio: ['Producto de audio', 10],
  electronica: ['Producto de electrónica', 8],
  computacion: ['Producto de computación', 7],
  electrodomesticos: ['Electrodoméstico', 8],
  hogar: ['Producto para la casa', 7],
};
export const DEFAULT_FALLBACK: [string, number] = ['Producto', 7];

/** Tipos que para el que mira son "lo mismo": unos audífonos gamer después de unos audífonos es repetir. */
export const TYPE_GROUPS: Record<string, string> = {
  'Audífonos gamer': 'Audífonos',
  'Parlante inteligente': 'Parlante',
  'Silla gamer': 'Silla',
  'Silla de escritorio': 'Silla',
  Frigobar: 'Refrigerador',
  Freezer: 'Refrigerador',
  Microondas: 'Horno',
  'Horno eléctrico': 'Horno',
  'Horno empotrable': 'Horno',
  Encimera: 'Cocina',
  'Consola retro': 'Consola',
};

/** Tipos con pulgadas que vale la pena decir. */
export const TYPES_WITH_INCHES: Record<string, true> = { 'Smart TV': true, Monitor: true };

/** Lo caro que igual detiene el dedo cuando la baja es de verdad (ver heroReach). */
export const HERO_TYPES: Record<string, true> = { Consola: true, Celular: true, 'Smart TV': true, Notebook: true };

// ---------------------------------------------------------------------------
// Marcas

/** Marcas que casi cualquier persona en Chile reconoce y desea. clave normalizada -> cómo se escribe. */
export const STAR_BRANDS: Record<string, string> = {
  apple: 'Apple', iphone: 'Apple', samsung: 'Samsung', sony: 'Sony', playstation: 'PlayStation',
  nintendo: 'Nintendo', xbox: 'Xbox', microsoft: 'Microsoft', jbl: 'JBL', xiaomi: 'Xiaomi',
  redmi: 'Xiaomi', motorola: 'Motorola', huawei: 'Huawei', lg: 'LG', bose: 'Bose',
  amazon: 'Amazon', kindle: 'Amazon', alexa: 'Amazon', google: 'Google', gopro: 'GoPro', dji: 'DJI',
  logitech: 'Logitech', lenovo: 'Lenovo', hp: 'HP',
  asus: 'Asus', acer: 'Acer', dell: 'Dell', msi: 'MSI', garmin: 'Garmin', canon: 'Canon',
  nikon: 'Nikon', epson: 'Epson', beats: 'Beats', marshall: 'Marshall', dyson: 'Dyson',
  oster: 'Oster', philips: 'Philips', sennheiser: 'Sennheiser', nespresso: 'Nespresso',
  'ea sports': 'EA Sports', mojang: 'Minecraft', 'rockstar games': 'Rockstar Games', panasonic: 'Panasonic',
};

/**
 * Marcas conocidas en el comercio chileno, sin ser de las que se sueñan.
 * Las de periféricos para jugar (Razer, HyperX, Redragon, Logitech G) van acá:
 * las conoce quien juega, no el seguidor común.
 */
export const KNOWN_BRANDS: Record<string, string> = {
  'logitech g': 'Logitech G', razer: 'Razer', hyperx: 'HyperX', redragon: 'Redragon',
  tcl: 'TCL', hisense: 'Hisense', mademsa: 'Mademsa', midea: 'Midea', mabe: 'Mabe',
  electrolux: 'Electrolux', thomas: 'Thomas', sindelen: 'Sindelen', somela: 'Somela',
  fensa: 'Fensa', whirlpool: 'Whirlpool', bosch: 'Bosch', 'black decker': 'Black+Decker',
  anker: 'Anker', soundcore: 'Anker', eufy: 'Anker', aiwa: 'Aiwa', philco: 'Philco',
  honor: 'Honor', oppo: 'Oppo', realme: 'Realme', zte: 'ZTE', nokia: 'Nokia', kodak: 'Kodak',
  brother: 'Brother', kingston: 'Kingston', sandisk: 'SanDisk', toshiba: 'Toshiba',
  seagate: 'Seagate', 'western digital': 'Western Digital', 'tp link': 'TP-Link', tplink: 'TP-Link',
  mercusys: 'Mercusys', duracell: 'Duracell', energizer: 'Energizer', shure: 'Shure',
  roku: 'Roku', 'master g': 'Master-G', masterg: 'Master-G',
  'ursus trotter': 'Ursus Trotter', 'albin trotter': 'Albin Trotter', splendid: 'Splendid',
  kobo: 'Kobo', recco: 'Recco', nex: 'Nex', kendal: 'Kendal', magefesa: 'Magefesa',
  maxell: 'Maxell', aoc: 'AOC', caixun: 'Caixun', mlab: 'Mlab', libero: 'Libero', gamesir: 'GameSir',
  daewoo: 'Daewoo', pioneer: 'Pioneer', amazfit: 'Amazfit', skullcandy: 'Skullcandy',
  corsair: 'Corsair', steelseries: 'SteelSeries', tefal: 'Tefal', braun: 'Braun',
  remington: 'Remington', wahl: 'Wahl', karcher: 'Kärcher', irobot: 'iRobot',
  roborock: 'Roborock', hikvision: 'Hikvision', ezviz: 'Ezviz', crucial: 'Crucial',
  genius: 'Genius', ugreen: 'Ugreen', adata: 'Adata', instax: 'Instax', fujifilm: 'Fujifilm',
  starlink: 'Starlink', apc: 'APC', babylisspro: 'BaBylissPRO', babyliss: 'BaByliss', gigabyte: 'Gigabyte',
  teka: 'Teka', junkers: 'Junkers', intel: 'Intel', alcatel: 'Alcatel', movistar: 'Movistar',
};

/**
 * El vendedor dice que no tiene marca: no se busca una en el nombre. "S/M" y
 * "N/A" llegan acá como "s m" y "n a".
 */
export const GENERIC_BRAND =
  /^((marca )?generic[ao]?s?|sin marca|oem|no aplica|no tiene|n a|s m|otras? marcas?|otr[ao]s?|varias?( marcas)?|ningun[ao]?|importad[oa]s?|universal(es)?)$/;

/**
 * El campo dice con qué funciona o a qué se parece, no de quién es
 * ("Compatible con Kindle", "Reemplazo para HP", "Alternativo HP", "Tipo
 * Apple", "Genérico HP"). Tampoco se busca la marca en el nombre: una funda
 * para Kindle no es Amazon.
 */
export const COMPATIBLE_BRAND = /\b(compatibles?|para|for|tipo|alternativ[oa]s?|reemplazo|repuesto|generic[oa]s?)\b/;

/**
 * Lo que puede ir entre "para" (o "compatible") y la marca cuando el nombre dice con qué se usa el producto:
 * "para celulares Samsung", "compatible con el iPhone 15 y Samsung". Cualquier otra palabra corta la lectura:
 * en "Impresora Para Niños Mlab" la marca es Mlab.
 */
export const BEFORE_TARGET_BRAND =
  /^(con|el|la|los|las|de|del|tu|su|y|o|e|\d+|celular(es)?|telefonos?|smartphones?|tablets?|notebooks?|laptops?|pc|impresoras?|tv|televisor(es)?|consolas?|reloj(es)?|control(es)?|camaras?|audifonos|equipos?|dispositivos?|modelos?|marcas?)$/;

/**
 * Tipos cuyo nombre suele listar las marcas con las que funcionan ("Soporte
 * Tv Samsung Lg Sony", "Cable Cargador iPhone Lightning"). Si el vendedor no
 * llenó el campo de marca, a estos no se les toma una del nombre.
 */
export const TYPES_NAMING_OTHER_BRANDS: Record<string, true> = {
  Soporte: true,
  Cable: true,
  Cargador: true,
  'Control remoto': true,
  Accesorio: true,
  Adaptador: true,
  'Tinta para impresora': true,
};

/** El nombre dice que el producto no es nuevo. */
export const NOT_NEW =
  /\b(reacondicionad[oa]s?|refurbished|usad[oa]s?|open box|caja abierta|segunda seleccion|segunda mano|semi ?nuev[oa]s?)\b/;

/** Valores del campo marca que no son una marca: ahí sí se mira el nombre. */
export const NOT_A_BRAND = /^(pro|smart|smart camera|sports|lamp|hot plate|ring fill light)$/;

/** En un nombre, estas palabras suelen decir "funciona con", no "es de". */
export const FIELD_ONLY_BRANDS: Record<string, true> = { alexa: true, google: true };

/** Una consola se conoce por su nombre, no por el fabricante: "Consola PlayStation", no "Consola Sony". */
export const CONSOLE_NAMES: [RegExp, string][] = [
  [/\b(playstation|ps[345])\b/, 'PlayStation'],
  [/\bxbox\b/, 'Xbox'],
  [/\b(nintendo|switch|sw2)\b/, 'Nintendo'],
];

// ---------------------------------------------------------------------------
// Palabras que el sitio no usa nunca (ver lib/content/captions y la voz de la marca).

/** Sin tildes y en minúsculas, para comparar palabra por palabra. */
export const FORBIDDEN_WORDS = [
  'mejor precio',
  'el mas barato',
  'imperdible',
  'oferton',
  'solo hoy',
  'ultimas unidades',
  'antes',
  'rebajado',
  'precio normal',
  'ahorra',
  'recomendado',
  'publicidad',
];
