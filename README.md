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

- **15 trajes** (cowboy, astronauta, pirata, chef, bombero, mago, caballero, ninja, rockero, surfista, explorador, superhéroe, navideño, vampiro y robot), cada uno con 4 piezas: cabeza, torso, piernas y pies. Se pueden probar gratis y comprar con Pixel Coins (las coins del regalo ya se pueden gastar; los paquetes figuran "muy pronto" hasta activar Xsolla).
- **Pixel Coins:** la moneda del juego. Pieza 100, traje completo 300 (se compran adentro del juego). Afuera solo se venden paquetes de Pixel Coins: 300 ($3), 500 ($5), 1.100 ($10), 3.000 ($25), 6.500 ($50) y 14.000 ($100), por **Xsolla** (comerciante 951393, proyecto 324051; catálogo en `public/tienda/catalogo-xsolla.json`). Lemon Squeezy cerró, Fungies no acepta vendedores nuevos y Dodo no acepta juegos.
- **Metas:** 1.000 seguidores (300 Pixel Coins de regalo para los que reclamaron antes), 2.500 (evento en los Reels), 5.000 (abre Pixépolis).
- **Regalo de fundador:** quien reclama su pixelito antes de los 1.000 seguidores recibe **300 Pixel Coins** (un traje completo o 3 piezas sueltas). El servidor lo decide al reclamar (`regaloOk`) y las acredita una sola vez (movimiento `regalo-<@>`). Quien ya había elegido un traje gratis con el sistema anterior lo conserva.
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

## Cuentas y contraseñas

- **Primer ingreso:** con el link del DM (RECLAMAR) la web pide crear una contraseña (mínimo 6). Después se entra en pixepolis.com con el @ y la contraseña; la sesión dura 30 días en ese dispositivo.
- **Restablecer:** mandar **RESTABLECER** por DM. El bot responde con un link de 60 minutos que abre directo la pantalla de contraseña nueva; al guardarla se cierran las otras sesiones.
- Contraseñas guardadas con PBKDF2 (100.000 vueltas, sal propia). Máximo 8 intentos fallidos cada 15 minutos por @ y por conexión.
- Rutas: `POST /api/clave`, `POST /api/entrar`, `POST /api/salir`. Tablas D1: `cuentas`, `sesiones`, `intentos`.


## Tienda con Pixel Coins (cómo funciona)

- Cada traje tiene 4 piezas (gorra, remera, pantalón, zapatos): **100 coins por pieza** o **300 el traje completo**. Se pueden probar gratis y combinar piezas de trajes distintos.
- Lo comprado queda en `armario` (D1) y se puede poner/sacar; el servidor solo acepta ropa del traje de regalo o del armario.
- Paquetes (únicos productos en Xsolla): 300/$3, 500/$5, 1.100/$10, 3.000/$25, 6.500/$50, 14.000/$100.
- Modos (`pagos` en `/api/yo`): `pronto` (producción sin claves: los paquetes dicen "muy pronto", pero las coins que ya tenés se gastan igual), `prueba` (DEV=1: los paquetes se acreditan gratis), `xsolla` (con XSOLLA_API_KEY, XSOLLA_PROJECT, XSOLLA_MERCHANT y XSOLLA_WEBHOOK_SECRET: abre la página de pago y las coins entran por el webhook `/api/xsolla`). Vuelve a `/?t=…&pago=ok` y la web espera la confirmación.
- `XSOLLA_SANDBOX` = sandbox por defecto; poner `0` para cobrar de verdad.

## Panel de administración (/admin/)

- `https://pixepolis.com/admin/`: solo entra **@georgeelhumano** (variable opcional `ADMIN` para cambiarlo), con la misma contraseña de pixepolis.com.
- **Resumen:** seguidores en vivo, fundadores (hoy / 7 días), ventas en US$ (solo pagos reales de Xsolla), compras de ropa, Pixel Coins (en billeteras, regaladas, vendidas, gastadas), gráfico de 14 días y trajes más comprados.
- **Fundadores:** lista con buscador (coins, piezas, si tiene contraseña y regalo). **Ventas:** todos los movimientos, con filtros. **Pedidos:** los BORRAR que llegan por DM, para marcarlos como hechos.
- **Avisos push** (igual que NOX, Web Push con claves VAPID guardadas en D1, sin secretos): venta, compra, fundador nuevo, contraseña creada, cada 100 seguidores y metas, BORRAR, RESTABLECER y problemas (Instagram caído o aviso de pago con firma inválida). En iPhone hay que agregar "Pixépolis Admin" a inicio (iOS 16.4+) y activar desde la pestaña Avisos.
- Archivos: `public/admin/` (página, `sw.js`, manifest), `lib/alerts.js`. Tablas: `pedidos`, `pushsub`, `pushkv`, `alertlog`.
