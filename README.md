# Pixépolis Club · Reclamá tu pixelito

Lista de espera de **Pixépolis Club** (dominio: pixepolis.com). La persona manda **RECLAMAR** por DM, el bot le responde con un link único, y con ese link primero arma su pixelito (piel, peinado, pelo, ropa, pantalón y accesorio) viéndolo siempre arriba, después elige su isla (una por cada Reel) y lo reclama. Al reclamarlo gana la **@ de Fundador** (su nombre con los colores y el salto del logo, arriba de la cabeza) y puede compartirlo en historias como imagen o como video de 6 segundos con la música de los Reels.

En la web el pixelito se dibuja en versión detallada (16×28 píxeles, mismas proporciones que el de los Reels, sin contorno) para que la ropa de la tienda se note; los Reels siguen con el de 6×11. Incluye de muestra el set cowboy (sombrero, chaleco con estrella, jeans y botas con espuelas), una pieza por lugar del cuerpo.

Está armado igual que NOX: Cloudflare Pages + Functions (`functions/api/[[path]].js`) + base de datos D1.

## Archivos

- `public/index.html`: la página (portada, simulador del bot, mi pixelito, imagen para historias).
- `functions/api/[[path]].js`: el servidor (links únicos, reclamo, contador y webhook de Instagram).
- `public/data.json`: pixelitos e islas del último Reel (lo genera exportar.py).
- `scripts/exportar.py`: pasa el `estado.json` de los Reels a `public/data.json`, con los mismos colores del video.
- `scripts/estado.json`: estado de los pixelitos (día 7).

## Seguidores en vivo

- El contador y las metas usan los **seguidores de Instagram en vivo** (`followers_count` de la cuenta, pedido como mucho una vez por minuto). Sin `IG_TOKEN`, usa los pixelitos conocidos.
- Cuando alguien manda RECLAMAR, el bot pregunta a Instagram si sigue la cuenta (`is_user_follow_business`):
  - si no sigue: le pide que siga primero;
  - si sigue y todavía no salió en un Reel (o volvió después de irse): se le crea el pixelito al instante (tabla `nuevos`, marcado "NUEVO") y ya lo puede reclamar y armar. En el Reel siguiente recibe su número y su isla.
- Instagram no da la lista completa de seguidores por API: los nuevos se verifican de a uno, cuando escriben.

## Tienda y metas

- **15 trajes** (cowboy, astronauta, pirata, chef, bombero, mago, caballero, ninja, rockero, surfista, explorador, superhéroe, navideño, vampiro y robot), cada uno con 4 piezas: cabeza, torso, piernas y pies. Se pueden probar; la venta figura como "muy pronto".
- **Precios:** pieza 100 monedas ($1), traje 300 ($3). Paquetes: 300 ($3), 500 ($5), 1.100 ($10), 3.000 ($25), 6.500 ($50) y 14.000 ($100). Pasarela pendiente (Lemon Squeezy, o Paddle vendiendo trajes sin monedas).
- **Metas:** 1.000 seguidores (traje gratis), 2.500 (evento en los Reels), 5.000 (abre Pixépolis).
- **Regalo de fundador:** quien reclama su pixelito antes de los 1.000 seguidores elige un traje gratis. El servidor lo decide al reclamar (`regaloOk`) y, una vez elegido, no se puede cambiar.
- Aviso en la tienda: lo comprado se ve en la web y en el video diario; si sos menor, pedile a un adulto.

## Cómo se actualiza con cada Reel (automático)

Los pixelitos y las islas están en `public/data.json`. La web lo lee de ahí, así que para ponerla al día alcanza con cambiar ese archivo en el repo:

1. La rutina diaria guarda el `estado.json` nuevo cuando George confirma que subió el Reel.
2. En ese mismo momento corre `python3 scripts/exportar.py estado.json`, que reescribe `public/data.json` con el día nuevo y su isla.
3. Hace commit y push a `main` del repo de Pixépolis.
4. Cloudflare Pages publica solo, en uno o dos minutos. La web ya muestra la isla nueva y los pixelitos nuevos pueden reclamar.

Los reclamos están en D1 y no se tocan.

## Probar en la compu (solo vos)

```
npm install -g wrangler
python3 scripts/exportar.py scripts/estado.json
npx wrangler pages dev public --d1 DB --binding DEV=1
```

Abrí `http://localhost:8788/?sim=1`. Abajo aparece el **simulador del bot**: escribís un @, tocás "Enviar RECLAMAR" y te responde con el link, como si fuera el DM.

## Subirlo a internet (una sola vez, en el panel de Cloudflare)

La configuración se hace en el panel (no hay `wrangler.toml` en el repo).

1. **Base de datos:** Storage & Databases → D1 → Create → nombre `pixepolis-db`.
2. **Web:** Workers & Pages → Create → Pages → conectar este repo. Rama `main`, sin comando de build, carpeta de salida `public`.
3. **Unir la base:** en el proyecto de Pages → Settings → Bindings → D1 database: nombre de variable `DB`, base `pixepolis-db`. Volver a desplegar.
4. **Dominio:** Custom domains → `pixepolis.com` (y `www.pixepolis.com`).
5. **No** poner la variable `DEV` en producción: sin ella el simulador no funciona.

## Conectar Instagram (último paso)

Variables secretas en Cloudflare: `IG_VERIFY` (una palabra que inventás), `IG_APP_SECRET` y `IG_TOKEN` (salen de la app de Meta). En developers.facebook.com, el webhook va a `https://pixepolis.com/api/ig`, con el campo `messages`.

## Estado en producción (24/11/2026)

- **Web:** pixepolis.com en Cloudflare Pages (proyecto `pixepolis-com`, repo `GeorgeElHumano/PIXEPOLIS.COM`, se publica solo con cada push a `main`). Base D1 `pixepolis-db` unida como `DB`.
- **Instagram conectado y app publicada:** app de Meta **Pixepolis Club** (id 985016004283134), en el portfolio *Jorge Duarte*, caso de uso "Administrar mensajes y contenido en Instagram" con inicio de sesión unificado. Está en modo activo: el bot contesta a cualquier seguidor (probado con @caballerogrossling).
- **Token:** `IG_TOKEN` es un token de usuario del sistema que no vence. La web usa `graph.facebook.com` con el id de Instagram `17841413502664396`; si algún día se usa un token que empieza con `IG`, cambia sola a `graph.instagram.com`.
- **Webhook:** `https://pixepolis.com/api/ig`, campo `messages`, suscripción activa en la cuenta.
- **Revisar la conexión:** `https://pixepolis.com/api/ig-estado` muestra si está conectado, los seguidores y los últimos eventos del webhook.
- **Páginas para Meta:** `/privacidad/` y `/borrar-datos/` (pedidos de borrado: DM con "BORRAR", se hacen a mano).
- **Vista previa del link:** `/og.png`. **App instalable:** `manifest.webmanifest`, `sw.js`, íconos `icono-*.png` y botón "Agregar a inicio" con guía para iPhone, Android y compu.
- **Página de Facebook:** "Los Pixelitos" (categoría Creador digital).
- Los textos dicen "el próximo Reel", sin horario fijo.
