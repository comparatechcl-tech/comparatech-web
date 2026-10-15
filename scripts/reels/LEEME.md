# Reels de oferta

Arma solo el video vertical de UN producto: su foto real, sus datos y nada más. Sin persona, sin voz y sin
mirar el reloj: con los mismos datos sale exactamente el mismo video.

Hay dos comandos y los dos usan el mismo armador:

- `generar.mjs` arma **los videos del día**: le pide al sitio qué productos van, baja la foto de cada uno,
  arma el video y lo sube al almacén del sitio. Es el que corre solo, tres veces al día.
- `hacer.mjs` arma **un video a mano**, desde un archivo de productos con la foto al lado. Sirve para probar
  una plantilla o revisar cómo queda un producto.

## Los videos del día

```
node scripts/reels/generar.mjs            los sugeridos de ahora (4)
node scripts/reels/generar.mjs --n 2      otra cantidad (1 a 6)
node scripts/reels/generar.mjs --seco     pide el plan y dice qué haría, sin armar ni subir
```

1. Pide el plan al sitio (`GET /api/social/videos/plan`, con el secreto de los crons). El sitio elige los
   productos y entrega, por cada uno, sus datos, la foto, la plantilla y dos direcciones firmadas de subida.
2. Por cada producto que todavía no tiene video: baja la foto (solo por https y solo de `mlstatic.com`, hasta
   8 MB, y tiene que ser una imagen), arma el video y su portada en una carpeta temporal del sistema y sube
   los dos archivos. La portada se sube primero: el sitio da un video por hecho cuando existe su `.mp4`.
3. Lo que ya existe no se rehace. Si un producto falla, sigue con los demás y **termina con código 1**; si
   todo salió bien, o no había nada que hacer, con código 0.

Cada video queda en el almacén `reels` como dos archivos con el mismo nombre:
`{fecha}/{producto}-{precio}-{plantilla}-{huella}.mp4` y `.jpg` (la portada).

**La huella** son 8 signos (del 0 al 9 y de la a a la f) que resumen la versión del aspecto de los videos
(`VIDEO_LOOK_VERSION`, hoy 2) y lo que el video dice además del precio: el nombre corto, la marca, la cifra
tachada (`precio_lista`), el descuento, la baja del historial, "Envío gratis" y "Full". Así, si cambia
cualquiera de esas cosas sin que cambie el precio, el nombre es otro: el video anterior deja de ofrecerse y
se arma uno nuevo. Lo mismo cuando cambia cómo lo dicen los videos con los mismos datos: se sube la versión
(la 2 cambió "por debajo del precio de lista" por "de descuento" y el rótulo de la cifra tachada por "sin
descuento"). **La calcula solo el sitio** (`src/lib/social/videos.ts`). El generador no
la recalcula: usa el nombre tal como llega en `archivo` y solo revisa que el producto, el precio y la
plantilla del nombre sean los de ese elemento, que la huella tenga su forma y que las dos direcciones de
subida terminen en ese mismo nombre. Si el nombre llega sin huella, el sitio que respondió es de la versión
anterior: ese producto falla con "el sitio y el generador no son de la misma versión" y no se sube nada con
el nombre antiguo. Se arregla publicando la última versión del sitio.

**El secreto** (`CRON_SECRET`) se toma de las variables de entorno (así llega en GitHub Actions) y, si no
está, de `.env.local` (así corre en el PC). Solo se manda al sitio publicado, cuya dirección está escrita en
`generar.mjs`, o a un servidor local con `--sitio http://localhost:3000`. Nunca a la foto ni a las subidas.
Un `--sitio` vacío (por ejemplo `--sitio "$VARIABLE"` con la variable sin definir) es un error: no se toma
como "entonces el sitio publicado".

**Si el sitio redirige** (el día en que el dominio propio quede de principal y el anterior mande para allá),
el pedido del plan no sigue la redirección, porque el secreto iría a parar a otra dirección. Termina al tiro
con código 1 y lo dice: "el sitio redirige a otro dominio (…): hay que actualizar la dirección de producción
(PRODUCTION) en scripts/reels/generar.mjs". La misma dirección está en `scripts/redes.mjs`.

**Lo que imprime es público** (los registros de GitHub Actions de este repositorio lo son): por cada video, el
nombre, el precio, la plantilla, cuánto demoró y cuánto pesa. Todo pasa por un filtro que tapa el secreto,
las direcciones firmadas y sus tokens, también en los mensajes de error. Los textos que vienen de afuera (el
nombre de un producto, el mensaje de error de otro servidor) salen en un solo renglón, sin signos de control
ni signos que no se ven, y con las órdenes de GitHub Actions rotas con un espacio: `##[error]` sale como
`# #[error]`, y un `::error::` al comienzo del renglón, como `: :error::`. Así un nombre no puede anotar un
error falso ni tapar texto en el registro.

**Si se corta a la mitad** (Ctrl+C, la consola que se cierra, Actions cancelando la corrida), antes de salir
corta a ffmpeg y borra la carpeta temporal del video que estaba armando. Lo que ya se había subido queda
arriba, y la corrida siguiente completa lo que falte.

Corre en GitHub Actions con `.github/workflows/reels.yml`, cerca de las 08:10, 13:10 y 18:10 de Chile, y se
puede lanzar a mano desde la pestaña Actions.

## Un video a mano

```
node scripts/reels/hacer.mjs <productos.json> <número> <salida.mp4> [opciones]
```

| Opción | Qué hace |
|---|---|
| `--plantilla estudio` | Cómo se ve el video: `estudio` o `bloques`. Por defecto, `estudio`. |
| `--cta "texto"` | Cambia la llamada del cierre (por defecto, "Más ofertas en el perfil"). Si es larga se parte en dos renglones y se achica; si ni así cabe, se corta con puntos suspensivos y avisa. No acepta direcciones web ni frases como "solo hoy" o "mejor precio". |
| `--portada foto.jpg` | Guarda además la escena del precio completa como imagen, para subirla de portada. |
| `--hoja hoja.jpg` | Guarda además una hoja con 8 cuadros del video ya armado, para revisarlo de un vistazo. |
| `--zonas` | Pinta en rojo lo que tapan las apps. Es para revisar: ese video no se publica. |
| `--musica archivo` | Usa ese audio en vez del silencio: lo recorta al largo del video (si es más corto, lo repite), con entrada y salida suaves. |
| `--volumen 0.6` | Volumen de la música, de 0 a 1. |
| `--hilos N` | Cuántos hilos pintan (por defecto, la mitad de los núcleos, hasta 6). |

El archivo de productos es `{ "productos": [ { "n": 1, "nombre", "nombre_corto", "marca", "precio",
"precio_lista", "descuento", "baja_historial", "precio_revisado", "envio_gratis", "full", "foto_local" } ] }`;
`foto_local` se busca al lado del propio archivo.

Una opción que no conoce es un error. Antes de armar escribe una línea `En pantalla: ...` con todo el texto
que va a salir escrito, para revisarlo. **Si falta la foto, el nombre o el precio, o la foto no se puede
leer, termina con código 1 y no arma nada.** El video se escribe con otro nombre y solo al terminar bien toma
el definitivo: nunca queda uno a medias.

Sale 1080x1920, 30 cuadros por segundo, H.264 (yuv420p, un cuadro clave cada 2 segundos, arranque rápido)
con una pista AAC en silencio, que es lo que piden Reels, TikTok y Shorts.

## Plantillas

Una plantilla es cómo se ve el video. Cada una vive en su carpeta dentro de `plantillas/` y le entrega al
armador siempre lo mismo (ver `plantillas/estudio/index.mjs`): cuántos cuadros por segundo, cómo preparar la
escena de un producto, en qué segundo pasa cada cosa y cómo pintar un cuadro.

**Para agregar una**: una carpeta nueva al lado de `estudio/` con su `index.mjs`, y una línea con su nombre en
`plantillas/index.mjs`. El nombre va en el nombre del archivo que se sube, así que solo lleva letras
minúsculas y números. Lo demás (leer los datos, medir y dibujar texto, preparar la foto, el lienzo, ffmpeg)
es común y está fuera de las carpetas de las plantillas. El sitio dice en el plan con qué plantilla va cada
producto.

Hay dos: `estudio` (la primera, más tranquila) y `bloques` (más enérgica, ver más abajo). El sitio decide cuál
usa cada video del día (`VIDEO_TEMPLATES` en `src/lib/social/videos.ts`): hoy solo `estudio`. `bloques` ya se
puede armar a mano con `--plantilla bloques`, y se agrega a esa lista cuando el dueño apruebe cómo se ve.

`estudio` se acomoda sola de dos maneras según la forma de la foto:

- **Foto alta o cuadrada** (un celular): la foto ocupa todo lo que deja la hoja.
- **Foto apaisada** (un televisor, una tablet): la foto vive entera en la mitad de arriba de la pantalla,
  donde no hay botones, y la hoja sube hasta ella; el texto va más grande.

## Qué se ve en "estudio"

La foto real, grande, sobre un fondo claro de estudio, y una hoja azul noche que sube desde abajo y va
diciendo el dato del descuento, el nombre y el precio. Con descuento dura 10,2 segundos (305 cuadros):

| Segundos | Qué pasa |
|---|---|
| 0 – 1,4 | Desde el primer cuadro: la foto, el logo en su pastilla y el gancho completo y enorme: "45%" (216 px; 248 con foto apaisada) y debajo, en un renglón, "de descuento" (108 px; 120 con foto apaisada). El número late una vez y lo cruza un brillo. |
| 1,4 – 2,9 | El gancho se va y entran la marca y el nombre; la foto queda en su tamaño más grande. |
| 2,9 – 7,9 | La hoja sube y el precio (hasta 170 px) cae desde más grande y pega a los 3,3 s con un golpe de luz. Después entran "−45%" (90 px), "sin descuento" sobre la cifra tachada "$399.990" (se tacha sola), "Envío gratis" / "Full" y "Precio revisado 13/10 09:30" / "Precios en Mercado Libre" (34 px). A los 6,3 s pasa un brillo por el descuento y el precio. La portada es el cuadro de los 7,5 s. |
| 7,9 – 10,2 | La hoja sube del todo: logo grande, ComparaTech, la llamada y otra vez "Precio revisado" y "Precios en Mercado Libre". |

- Sin descuento pero con baja de historial, el gancho es "Bajó N%" (152 a 200 px) / "según nuestro
  historial" (80 px, dos renglones). Una baja del historial no es un descuento: ahí nunca dice "descuento".
- Con descuento el gancho ocupa menos alto que con la baja (un renglón en vez de dos), así que la hoja queda
  más baja y la foto del gancho se ve más grande (un celular a 657x801 px, antes 622x758).
- Sin ninguno de los dos no hay gancho: el video parte con el nombre, el precio pega a los 2,6 s y dura 9,8 s
  (293 cuadros).
- El precio nunca se cuenta: en ningún cuadro hay un número que no sea el real.
- Zonas seguras: nada en los 220 px de arriba, ni en los 420 de abajo, ni a la derecha de x=924 bajo la mitad
  de la pantalla (ahí las apps ponen sus botones).
- La foto nunca se deforma. Una foto de origen chica no se agranda más de 1,6 veces (y avisa). Una foto que no
  viene sobre blanco se muestra entera, como una lámina con sombra.

## Qué se ve en "bloques"

Enérgica y directa: la pantalla parte en bloques de color de la marca, con el producto ya a la vista; el precio
se estampa como una etiqueta de tienda y los cortes son marcados. El precio pega medio segundo antes que en
"estudio". Con descuento dura 9,6 segundos (288 cuadros):

| Segundos | Qué pasa |
|---|---|
| 0 – 1,25 | Desde el primer cuadro: arriba una franja de noche; un bloque cian con la pastilla del logo y el número enorme en tinta oscura ("45%", de 330 a 470 px); un bloque azul con "de descuento" en blanco (120 px, en un renglón) y, debajo a la derecha, la tarjeta blanca con la foto real. Así el primer cuadro, que muchas apps usan de miniatura, ya muestra el producto. Los bordes entre bloques van inclinados. El número llega apenas más grande, se asienta y a los 0,6 s late una vez. |
| 1,25 – 1,65 | Los bloques suben de un empujón y entra la noche, con un bloque azul inclinado arriba. La tarjeta no se va: crece desde su sitio hasta su tamaño grande. El logo queda quieto. Entran la marca y el nombre en negrita (hasta 68 px). |
| 1,65 – 2,6 | La tarjeta grande (un celular a 681x830 px), con la marca y el nombre debajo. Desde los 2,24 s el nombre se va y la tarjeta se encoge (en 0,34 s) a su tamaño de la escena del precio. |
| 2,6 – 2,76 | La etiqueta del precio (cian, con su punta, su agujero y un poco chueca) se estampa desde un 25% más grande y pega a los 2,76 s, con un eco de luz y una sacudida. Su borde de arriba no se mueve, así que nunca pisa el producto, y el precio se ve entero en todos los cuadros (al empezar, solo la punta queda fuera de la pantalla). |
| 2,8 – 4,1 | Entran el nombre chico, el bloque blanco "−45%" (o "Bajó 12%"), "sin descuento" sobre la cifra tachada "$399.990" (se tacha en cian), "Envío gratis" / "Full" y, pegado debajo, "Precio revisado 13/10 09:30" / "Precios en Mercado Libre" (34 px): la aclaración va junto al precio. |
| 4,1 – 7,25 | Todo quieto para leer, con la foto acercándose despacio. A los 5,16 s un brillo cruza la etiqueta y el descuento late. La portada es el cuadro de los 6,9 s. |
| 7,25 – 9,6 | Tres barras (cian, azul y noche) suben una tras otra y tapan todo: logo grande, ComparaTech, la llamada en una losa cian con letra oscura (de 80 a 40 px, dos renglones como máximo; si ni así cabe, se corta y avisa) y otra vez "Precio revisado" y "Precios en Mercado Libre". |

- Sin descuento pero con baja de historial, el gancho es "Bajó" / "12%" / "según nuestro historial" (94 px,
  dos renglones) y en la fila va el bloque "Bajó 12%". Ahí nunca dice "descuento": una baja del historial no
  lo es.
- Sin ninguno de los dos no hay gancho: el primer cuadro ya trae la tarjeta grande, la marca y el nombre; la
  etiqueta pega a los 1,41 s y dura 9,35 s (281 cuadros).
- **El número del gancho** va lo más grande que quepa a lo ancho (hasta 470 px; "45%" llega a 390 y "28%" a
  410), pero baja (hasta 330) si así la tarjeta de abajo quedara de menos de 400 px de alto.
- **Foto alta o cuadrada**: tarjeta de x=72 a x=924. Un celular se ve a 402x490 px en el gancho (275x335 con
  "Bajó", que lleva una palabra sobre el número y la frase en dos renglones), 681x830 con el nombre y 470x573
  con el precio.
- **Foto apaisada**: tarjeta casi de lado a lado (x=48 a x=1032), con el producto entero sobre la mitad de la
  pantalla. Un televisor se ve a 728x490 en el gancho, 918x618 con el nombre y 844x568 con el precio.
- **Producto bajo** (una barra de sonido, una foto chica): la tarjeta mide lo que pide el producto más aire
  (nunca menos de 440 px de alto) y el grupo baja hasta 130 px para no dejar una tarjeta medio vacía.
- La etiqueta nunca pasa de x=924, ni siquiera mientras se estampa; el precio va en 156 px (160 con foto
  apaisada) o lo que quepa, y nunca se cuenta.
- **La portada** lleva el bloque azul detrás de la tarjeta: en la grilla del perfil se distingue de "estudio".
- Zonas seguras: las mismas que "estudio". En la columna de botones solo entran el borde de la tarjeta y su
  sombra cian (no dicen nada) y, por 0,3 s, el eco de luz del golpe de la etiqueta.

## De dónde sale lo que se dice

Todo sale del dato del producto; no hay frases de venta escritas a mano.

- **Descuento**: solo si vienen la cifra tachada (`precio_lista`) y el porcentaje, y calzan entre sí. Se dice
  "45% de descuento" y, sobre la cifra tachada, "sin descuento": esa cifra la pone el vendedor en Mercado
  Libre y no se sabe si de verdad lo vendía a ese precio, así que nunca se dice "precio normal", "antes" ni
  "precio de lista" (la llamada del cierre tampoco acepta esas frases).
- **"Envío gratis" y "Full"**: en los videos del día salen solo de los campos `envio_gratis` y `full` del
  plan. En un archivo de productos a mano, si esos campos no vienen, cuentan solo cuando el motivo o los
  textos lo dicen a secas ("envío gratis", "llega con Full"); "Full HD", "Full Frame" o "envío gratis sobre
  $30.000" no cuentan.
- **Fecha y hora**: de `precio_revisado`, en hora de Chile y siempre con dos cifras (04/07 09:05). Nunca del
  reloj del equipo.
- **Números**: se aceptan como número o como texto ("579990", "579.990", "27.5").
- **Nombre**: dos renglones como máximo, medidos con los anchos reales de la fuente; si no cabe, puntos
  suspensivos. Los signos que la fuente no tiene (emojis, otros alfabetos) se quitan.

## Peso, calidad y tiempo

- El video no debe pasar de unos 4 MB (se baja y se comparte desde el teléfono). Con la calidad normal
  (crf 17) los de muestra pesan entre 2,1 y 3,8 MB. Si alguno pasa de 4 MB, se arma de nuevo con un poco
  menos de calidad (crf 20, después 23 y 26) hasta que quepa, y lo dice.
- En el PC del proyecto (6 hilos) cada video demora entre 10 y 17 segundos, según qué más esté corriendo.
- Con "bloques" los de muestra pesan entre 2,0 y 3,6 MB y demoran de 8 a 12 segundos. Con 1 hilo o con 6 sale
  el mismo archivo.

## Los archivos

- `generar.mjs`: el proceso del día. `plan.mjs`: revisa cada elemento del plan y lo convierte en la entrada
  del reel.
- `hacer.mjs`: el comando para un video a mano.
- `armar.mjs`: el armador (reparte los cuadros entre hilos y se los pasa a ffmpeg). `obrero.mjs`: cada hilo.
- `datos.mjs`: lee el producto y decide qué se puede decir. `foto.mjs`: prepara la foto. `capas.mjs`: dibuja
  cada texto una vez (colores, logo e íconos de la marca). `pintar.mjs`: el lienzo. `fuente.mjs`: mide el
  texto con la letra Inter del sitio (`src/lib/content/fonts`). `video.mjs`: ffmpeg (lo busca en la consola,
  en la variable `FFMPEG` o donde lo deja WinGet).
- `plantillas/`: las plantillas. `plantillas/estudio/`: su escena (medidas, tiempos y el dibujo de cada
  cuadro) y sus fondos. `plantillas/bloques/`: lo mismo, más `piezas.mjs` (la etiqueta del precio, el bloque
  del descuento y la losa de la llamada).
- `*.test.ts` y `pruebas/`: las pruebas (`npx vitest run scripts/reels`). El proceso del día se prueba contra
  un sitio de mentira en 127.0.0.1 (`pruebas/sitio-de-mentira.mjs`, que entrega los nombres con su huella
  igual que el sitio de verdad), sin salir a la red: cuando una prueba lanza el comando en otro proceso, lo
  hace con `pruebas/sin-red.mjs`, que deja pasar solo lo que va a ese sitio de mentira. La prueba que arma un
  video de verdad se salta si no hay ffmpeg.

Solo necesita `sharp` y `next`, que ya están en el proyecto, y ffmpeg instalado.

## Lo que quedó flojo

- **"Precio revisado …" y "Precios en Mercado Libre" van en dos renglones**, no en uno: en 34 px no caben
  entre el margen y la columna de botones.
- **Televisor y tablet no llegan a 1000 px de ancho** (945 y 879 en las muestras): es lo que cabe arriba de
  la mitad de la pantalla dejando 30 px bajo la pastilla del logo.
- **Con descuento y baja de historial a la vez**, la baja no se muestra (el gancho y la fila son del
  descuento).
- **"−45%" y "sin descuento" van uno al lado del otro** en la fila del precio: el rótulo es chico y va sobre
  la cifra tachada, así que se lee como la cifra sin descuento, no como una contradicción. No se probó con
  gente.
- **La foto manda**: una foto chica se ve chica, y los letreros que traiga pegados salen tal cual.
- **Revisado cuadro a cuadro, no en un teléfono** ni dentro de las apps. La música se probó con tonos de prueba.
- **El corte a la mitad se probó avisando la señal desde dentro del proceso**, no con un Ctrl+C de consola ni
  con una cancelación de Actions de verdad. En Windows, un proceso que otro programa mata (no Ctrl+C) no
  alcanza a enterarse, y ahí la carpeta temporal queda.
- **Las órdenes de Actions quedan rotas, los "detectores de errores" no**: `setup-node` deja activos unos
  detectores que anotan como error cualquier renglón con la forma de un error de tsc o de eslint. Un nombre de
  producto escrito a propósito con esa forma podría dejar una anotación falsa en la corrida (no expone nada).
  Si alguna vez pasa, se apagan en `reels.yml` con `echo "::remove-matcher owner=tsc::"` (y lo mismo con
  `eslint-compact` y `eslint-stylish`) antes de correr el generador. Nada de esto se pudo probar dentro de
  Actions: que las órdenes rotas ya no se obedecen sale de cómo las lee el programa de GitHub, no de una
  corrida.
- **En "bloques", el producto de la escena del precio queda más chico que en "estudio"** (un celular a 470x573
  contra 536x654; un televisor a 844x568 contra 945x636): la tarjeta deja aire blanco bajo el producto para la
  etiqueta y la letra chica va bajo el descuento. En el gancho la tarjeta es chica: unos 540 px de alto con
  descuento ("de descuento" va en un renglón) y unos 380 con "Bajó" (lleva la frase en dos renglones y el
  número baja a 330 px para dejarle sitio).
- **En "bloques", algunos movimientos de menos de 0,3 s cruzan las zonas de las apps**: el empujón de los
  bloques y el eco de luz del golpe de la etiqueta (asoma unos 40 px en la columna de botones mientras se
  apaga). En reposo no entra nada escrito ni el producto.
