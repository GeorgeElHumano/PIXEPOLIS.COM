// Los Pixelitos · Pixépolis · servidor (Cloudflare Pages Functions + D1), armado igual que NOX.
// "Reclamá tu pixelito": la persona manda RECLAMAR por DM, el bot le responde con un link único,
// y con ese link arma SU pixelito, elige su isla y lo reclama (gana el @ de Fundador: su nombre con los colores del logo, animado).
//
// Los pixelitos y las islas salen de public/data.json (lo genera scripts/exportar.py con el estado
// de cada Reel). Al subir un data.json nuevo al repo, Cloudflare publica y la web queda al día sola.
// En D1 solo se guardan los links únicos y los reclamos.
//
// Rutas:
//   GET  /api/stats            pixelitos, reclamados e islas
//   GET  /api/yo?t=TOKEN       el pixelito del dueño del link, con las islas
//   POST /api/reclamar         {t, look}  reclama o cambia el look (pelo, piel, ropa, accesorio, isla)
//   POST /api/dev/dm           {from, text}  simula el DM (solo con la variable DEV=1, para probar en local)
//   GET  /api/ig               verificación del webhook de Instagram (Meta)
//   POST /api/ig               mensajes de Instagram: responde a RECLAMAR con el link
//   GET  /api/admin/...        panel de administración (solo @georgeelhumano): resumen, reclamos, ventas y avisos push
//
// Variables (wrangler secret put / panel de Cloudflare):
//   DEV=1            habilita /api/dev/dm (NO ponerla en producción)
//   IG_VERIFY        palabra secreta que se carga en Meta para verificar el webhook
//   IG_APP_SECRET    secreto de la app de Meta (firma de los avisos)
//   IG_TOKEN         token de la cuenta @somoslospixelitos para responder mensajes

import { ALERT_TYPES, alertSchema, alert, once, vapid, pyDay, pyDayStart } from '../../lib/alerts.js';

const LINK_HOURS = 24;
const ADMIN = env => handleOf(env.ADMIN || 'georgeelhumano'); // cuenta de administrador (panel /admin/)
// Tienda: 15 trajes (los mismos ids que en public/index.html). Los primeros META_REGALO en reclamar reciben REGALO_COINS Pixel Coins.
const TRAJES = ['cowboy', 'astronauta', 'pirata', 'chef', 'bombero', 'mago', 'caballero', 'ninja', 'rockero', 'surfista', 'explorador', 'heroe', 'navidad', 'vampiro', 'robot'];
const META_REGALO = 1000;
const WORD = /\breclamar\b/i;
const RESET = /\b(restablecer|recuperar|reset)\b/i; // restablecer contraseña
const RESET_MIN = 60;

/* ---------- Pixel Coins ----------
   Afuera (Xsolla) solo se venden paquetes de coins. Adentro, las coins compran piezas:
   100 cada una; el traje completo cuesta 300 (o 100 por cada pieza que te falte, si ya tenés alguna). */
const PACKS = { 'monedas-300': [300, 3], 'monedas-500': [500, 5], 'monedas-1100': [1100, 10], 'monedas-3000': [3000, 25], 'monedas-6500': [6500, 50], 'monedas-14000': [14000, 100] };
const REGALO_COINS = 300, PIEZA_COINS = 100, TRAJE_COINS = 300, SLOTS = 'ctpf';
const piezaId = (traje, k) => `${traje}-${k}`;
// Opciones de personalización (las mismas que en public/index.html)
const OPC = {
  shirt: ['#FF3D3D', '#2F80ED', '#27AE60', '#FF9F1C', '#9B51E0', '#FF4FA3', '#00C2A8', '#FFD23F', '#FFFFFF', '#14121F'],
  pants: ['#1F3A93', '#2C2C2A', '#5D4037', '#37474F', '#FFFFFF', '#E53935', '#90CAF9'],
  hair: ['#2C2C2A', '#633806', '#BA7517', '#E8C35A', '#412402', '#D9480F', '#FF4FA3', '#2F80ED', '#BDBDBD'],
  skin: ['#FFD3A5', '#F0A878', '#B97A4B', '#FCE1C8', '#8D5A3B', '#6B4226'],
  style: ['corto', 'largo', 'rastas', 'rapado', 'cresta', 'colitas', 'afro'],
  outfit: ['remera', 'buzo', 'camisa', 'vestido', 'musculosa', 'campera'],
  acc: ['', 'gorra', 'lentes', 'mono', 'auris'],
};
const COL = { shirt: OPC.shirt.slice(0, 8), hair: OPC.hair.slice(0, 6), skin: OPC.skin.slice(0, 5), pants: OPC.pants.slice(0, 4) };
function cleanLook(b, dias) {
  const L = {};
  for (const k of ['shirt', 'pants', 'hair', 'skin']) L[k] = OPC[k].includes(b[k]) ? b[k] : null; // null = el color del video
  L.style = OPC.style.includes(b.style) ? b.style : 'corto';
  L.outfit = OPC.outfit.includes(b.outfit) ? b.outfit : 'remera';
  L.acc = OPC.acc.includes(b.acc) ? b.acc : '';
  L.isla = dias.includes(+b.isla) ? +b.isla : null; // null = la isla del día en que llegó
  return L;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS links(th TEXT PRIMARY KEY, handle TEXT NOT NULL, created INTEGER NOT NULL, exp INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS links_handle ON links(handle)`,
  `CREATE TABLE IF NOT EXISTS nuevos(handle TEXT PRIMARY KEY, t INTEGER NOT NULL, shirt TEXT, hair TEXT, skin TEXT, pants TEXT)`,
  `CREATE TABLE IF NOT EXISTS reclamos(handle TEXT PRIMARY KEY, num INTEGER NOT NULL, ord INTEGER NOT NULL, look TEXT NOT NULL, t INTEGER NOT NULL, upd INTEGER)`,
  `CREATE TABLE IF NOT EXISTS cuentas(handle TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, t INTEGER NOT NULL, upd INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sesiones(th TEXT PRIMARY KEY, handle TEXT NOT NULL, created INTEGER NOT NULL, exp INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sesiones_handle ON sesiones(handle)`,
  `CREATE TABLE IF NOT EXISTS intentos(k TEXT PRIMARY KEY, n INTEGER NOT NULL, t INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS billetera(handle TEXT PRIMARY KEY, coins INTEGER NOT NULL DEFAULT 0, upd INTEGER)`,
  `CREATE TABLE IF NOT EXISTS armario(handle TEXT NOT NULL, pieza TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY(handle, pieza))`,
  `CREATE TABLE IF NOT EXISTS pedidos(id INTEGER PRIMARY KEY AUTOINCREMENT, handle TEXT NOT NULL, tipo TEXT NOT NULL, texto TEXT, t INTEGER NOT NULL, hecho INTEGER)`,
  `CREATE TABLE IF NOT EXISTS movimientos(id INTEGER PRIMARY KEY AUTOINCREMENT, handle TEXT NOT NULL, tipo TEXT NOT NULL, coins INTEGER NOT NULL, detalle TEXT, ref TEXT UNIQUE, t INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS movimientos_handle ON movimientos(handle)`,
];
let ready = false;
async function init(db) {
  if (ready) return;
  await db.batch(SCHEMA.map(q => db.prepare(q)));
  ready = true;
}

/* ---------- datos de los Reels (public/data.json) ---------- */
let DATA = null, DATA_T = 0;
async function loadData(ctx) {
  if (DATA && Date.now() - DATA_T < 60e3) return DATA; // se relee cada minuto
  const r = await ctx.env.ASSETS.fetch(new URL('/data.json', ctx.request.url));
  const j = await r.json();
  const P = new Map(), byDay = {};
  for (const [num, handle, day, act, shirt, hair, skin, pants, out] of j.p) {
    const p = { num, handle, day, act, shirt, hair, skin, pants, out };
    P.set(handle, p);
    if (!out) (byDay[day] = byDay[day] || []).push(p);
  }
  DATA = { P, byDay, islas: j.islas || [], day: j.day }; DATA_T = Date.now();
  return DATA;
}

/* ---------- utilidades ---------- */
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (msg, status = 400) => json({ error: msg }, status);
const now = () => Date.now();
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const b64url = u => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const handleOf = s => '@' + String(s || '').trim().replace(/^@+/, '').toLowerCase();
const HANDLE_RE = /^@[a-z0-9._]{1,30}$/;
const BAD_LINK = 'El link no es válido o ya venció. Mandá RECLAMAR por DM y te llega uno nuevo.';

// Seguidores en vivo: el número de la cuenta de Instagram (se pide como mucho una vez por minuto)
let IGF = null, IGF_T = 0, IGERR = '';
const LOG = [];
function log(x) { LOG.unshift({ t: new Date().toISOString(), ...x }); LOG.length = Math.min(LOG.length, 12); }
async function seguidores(env) {
  if (!env.IG_TOKEN) return null;
  if (IGF !== null && Date.now() - IGF_T < 60e3) return IGF;
  try {
    const { base, me } = api(env);
    const r = await fetch(`${base}/${me}?fields=followers_count&access_token=${encodeURIComponent(env.IG_TOKEN)}`);
    const j = await r.json();
    if (typeof j.followers_count === 'number') { IGF = j.followers_count; IGF_T = Date.now(); IGERR = ''; }
    else IGERR = (j.error && (j.error.message || j.error.type)) || 'sin followers_count';
  } catch (e) { IGERR = String(e && e.message || e); }
  return IGF;
}
async function stats(db, D, env) {
  let enReel = 0; D.P.forEach(p => { if (!p.out) enReel++; });
  const nu = await db.prepare('SELECT handle FROM nuevos').all();
  const nuevos = nu.results.filter(r => { const p = D.P.get(r.handle); return !p || p.out; }).length;
  const { results } = await db.prepare('SELECT handle FROM reclamos').all();
  const claimed = results.filter(r => { const p = D.P.get(r.handle); return p ? !p.out : true; }).length;
  const ig = await seguidores(env);
  // total = seguidores de Instagram en vivo; sin conexión a Instagram, los pixelitos conocidos
  return { total: ig ?? enReel + nuevos, claimed, reclamos: results.length, day: D.day, enVivo: ig !== null };
}
// Avisos de seguidores (cada 100 y las metas) y de Instagram desconectado
async function metaCheck(db, st, env) {
  try {
    if (env.IG_TOKEN && IGERR) await alert(db, 'problema', 'Instagram no responde', 'No pudimos leer los seguidores: ' + IGERR.slice(0, 120), { key: 'igerr', every: 6 * 3600e3, url: '/admin/' });
    if (!st.enVivo) return;
    const c = Math.floor(st.total / 100) * 100;
    if (c >= 100 && await once(db, 'meta:' + c, 3650 * 864e5)) {
      const META = { 1000: '¡1.000 seguidores!', 2500: '¡2.500 seguidores! Toca el evento especial en los Reels.', 5000: '¡5.000 seguidores! Abre Pixépolis.' };
      await alert(db, 'meta', META[c] ? 'Meta cumplida' : `${c.toLocaleString('es')} seguidores`, META[c] || `Llegamos a ${c.toLocaleString('es')} seguidores (${st.claimed} pixelitos reclamados).`, { url: '/admin/' });
    }
  } catch (e) {}
}
const pickC = arr => arr[Math.floor(Math.random() * arr.length)];
// Pixelito de alguien que nos sigue pero todavía no salió en un Reel
async function nuevoDe(db, D, handle) {
  const n = await db.prepare('SELECT shirt, hair, skin, pants FROM nuevos WHERE handle=?').bind(handle).first();
  return n ? { num: null, handle, day: D.day + 1, act: 'llega en el próximo Reel', ...n, out: 0, nuevo: true } : null;
}
async function pixelito(db, D, handle) { const p = D.P.get(handle); return p && !p.out ? p : (await nuevoDe(db, D, handle)) || p || null; }
const pick = (arr, n) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
const islasCon = D => D.islas.map(i => ({ ...i, vecinos: pick(D.byDay[i.day] || [], 4).map(({ shirt, hair, skin, pants }) => ({ shirt, hair, skin, pants })) }));

// Arma la respuesta del bot para un @ (crea el link único si corresponde)
async function botReply(db, D, env, handle, origin, sigue, modo) {
  if (modo === 'reset') return resetReply(db, D, handle, origin);
  // sigue: true/false según Instagram (is_user_follow_business); undefined si no se pudo saber
  if (sigue === false) return { kind: 'nofollow', text: `¡Hola! Para tener tu pixelito primero seguí a @somoslospixelitos 👾 Después mandá RECLAMAR de nuevo.` };
  let p = await pixelito(db, D, handle);
  if (sigue === true && (!p || p.out)) {
    await db.prepare('INSERT OR IGNORE INTO nuevos(handle, t, shirt, hair, skin, pants) VALUES(?,?,?,?,?,?)').bind(handle, now(), pickC(COL.shirt), pickC(COL.hair), pickC(COL.skin), pickC(COL.pants)).run();
    p = await nuevoDe(db, D, handle);
  }
  if (!p) return { kind: 'none', text: `¡Hola! Todavía no encontramos tu pixelito 👀 Si recién nos seguiste, aparecés en el próximo Reel. Después mandá RECLAMAR de nuevo.` };
  if (p.out) return { kind: 'out', text: `Tu pixelito salió volando en cohete 🚀 porque dejaste de seguirnos. ¡Volvé a seguirnos y su lugar te espera!` };
  const raw = b64url(crypto.getRandomValues(new Uint8Array(18)));
  const t = now();
  await db.batch([
    db.prepare('DELETE FROM links WHERE handle=? OR exp<?').bind(handle, t),
    db.prepare('INSERT INTO links(th, handle, created, exp) VALUES(?,?,?,?)').bind(await sha(raw), handle, t, t + LINK_HOURS * 3600e3),
  ]);
  const url = `${origin}/?t=${raw}`;
  const hola = p.nuevo ? `¡Hola! Ya sos parte de Los Pixelitos 👾 Tu pixelito llega en el próximo Reel, pero ya podés reclamarlo y armarlo:` : `¡Hola! Tu pixelito #${p.num} te está esperando 👾`;
  return { kind: 'link', url, text: `${hola}\n${url}\nEl link es solo tuyo y vence en ${LINK_HOURS} horas.` };
}

// RESTABLECER por DM: link de 1 hora que abre directo la pantalla de contraseña nueva
async function resetReply(db, D, handle, origin) {
  const cu = await db.prepare('SELECT 1 FROM cuentas WHERE handle=?').bind(handle).first();
  if (!cu) return { kind: 'noclave', text: `Todavía no tenés contraseña 🔒 Mandá RECLAMAR y la creás en tu primer ingreso.` };
  const p = await pixelito(db, D, handle);
  if (p && p.out) return { kind: 'out', text: `Tu pixelito salió volando en cohete 🚀 porque dejaste de seguirnos. ¡Volvé a seguirnos y su lugar te espera!` };
  const raw = b64url(crypto.getRandomValues(new Uint8Array(18))), t = now();
  await db.batch([
    db.prepare('DELETE FROM links WHERE handle=? OR exp<?').bind(handle, t),
    db.prepare('INSERT INTO links(th, handle, created, exp) VALUES(?,?,?,?)').bind(await sha(raw), handle, t, t + RESET_MIN * 60e3),
  ]);
  const url = `${origin}/?t=${raw}&clave=1`;
  return { kind: 'reset', url, text: `🔑 Para restablecer tu contraseña entrá acá y elegí una nueva:\n${url}\nEl link es solo tuyo y vence en ${RESET_MIN} minutos. Si no lo pediste, ignoralo: tu contraseña sigue igual.` };
}

// Un token es un link del DM (24 h, prueba que sos dueño del @) o una sesión iniciada con contraseña (30 días)
async function byToken(db, raw) { const r = await tokenInfo(db, raw); return r ? r.handle : null; }
async function tokenInfo(db, raw) {
  if (!raw || raw.length > 64) return null;
  const th = await sha(raw);
  const l = await db.prepare('SELECT handle, exp FROM links WHERE th=?').bind(th).first();
  if (l && l.exp >= now()) return { handle: l.handle, dm: true };
  const s = await db.prepare('SELECT handle, exp FROM sesiones WHERE th=?').bind(th).first();
  if (s && s.exp >= now()) return { handle: s.handle, dm: false };
  return null;
}

/* ---------- contraseñas ---------- */
const SES_DIAS = 30;
async function pbkdf2(pw, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256));
}
async function nuevaSesion(db, handle) {
  const raw = b64url(crypto.getRandomValues(new Uint8Array(24))), t = now();
  await db.batch([
    db.prepare('DELETE FROM sesiones WHERE exp<?').bind(t),
    db.prepare('INSERT INTO sesiones(th, handle, created, exp) VALUES(?,?,?,?)').bind(await sha(raw), handle, t, t + SES_DIAS * 864e5),
  ]);
  return raw;
}
// Como mucho 8 intentos fallidos cada 15 minutos por @ y por conexión
async function frenado(db, keys) {
  const t = now();
  for (const k of keys) {
    const r = await db.prepare('SELECT n, t FROM intentos WHERE k=?').bind(k).first();
    if (r && t - r.t < 15 * 60e3 && r.n >= 8) return true;
  }
  return false;
}
async function fallo(db, keys) {
  const t = now();
  for (const k of keys) await db.prepare(`INSERT INTO intentos(k, n, t) VALUES(?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN ?2 - t > 900000 THEN 1 ELSE n + 1 END, t = CASE WHEN ?2 - t > 900000 THEN ?2 ELSE t END`).bind(k, t).run();
}
const claveOk = p => typeof p === 'string' && p.length >= 6 && p.length <= 72;

async function mine(db, D, env, handle) {
  const p = await pixelito(db, D, handle);
  if (!p) return null;
  const c = await db.prepare('SELECT ord, look, t FROM reclamos WHERE handle=?').bind(handle).first();
  const cu = await db.prepare('SELECT 1 FROM cuentas WHERE handle=?').bind(handle).first();
  if (c) { const L = JSON.parse(c.look); if (L.regaloOk && !L.regalo) await acreditar(db, handle, REGALO_COINS, 'regalo', 'Regalo de fundador', 'regalo-' + handle); }
  return { pixelito: p, claim: c ? { ord: c.ord, t: c.t, look: JSON.parse(c.look) } : null, tieneClave: !!cu, ...(await bolsillo(db, handle)), pagos: pagosModo(env), islas: islasCon(D), stats: await stats(db, D, env) };
}
async function bolsillo(db, handle) {
  const b = await db.prepare('SELECT coins FROM billetera WHERE handle=?').bind(handle).first();
  const a = await db.prepare('SELECT pieza FROM armario WHERE handle=?').bind(handle).all();
  return { coins: b ? b.coins : 0, armario: a.results.map(r => r.pieza) };
}
// 'xsolla' cuando están las claves; 'prueba' solo con DEV=1 (acredita sin cobrar); si no, 'pronto'
const pagosModo = env => env.XSOLLA_API_KEY && env.XSOLLA_PROJECT && env.XSOLLA_MERCHANT ? 'xsolla' : env.DEV === '1' ? 'prueba' : 'pronto';
async function acreditar(db, handle, coins, tipo, detalle, ref) {
  const t = now();
  const r = await db.prepare('INSERT OR IGNORE INTO movimientos(handle, tipo, coins, detalle, ref, t) VALUES(?,?,?,?,?,?)').bind(handle, tipo, coins, detalle, ref, t).run();
  if (!r.meta.changes) return false; // ese pago ya se acreditó
  await db.prepare('INSERT INTO billetera(handle, coins, upd) VALUES(?1, ?2, ?3) ON CONFLICT(handle) DO UPDATE SET coins = coins + ?2, upd = ?3').bind(handle, coins, t).run();
  return true;
}
// Firma de los avisos de Xsolla: Authorization: Signature sha1(cuerpo + clave secreta del proyecto)
async function xsollaValido(req, body, secret) {
  if (!secret) return false;
  const got = (req.headers.get('authorization') || '').replace(/^Signature\s+/i, '').trim();
  const want = hex(await crypto.subtle.digest('SHA-1', enc.encode(body + secret)));
  if (got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
async function xsollaToken(env, handle, sku, origin, t) {
  const sandbox = env.XSOLLA_SANDBOX !== '0';
  const r = await fetch(`https://store.xsolla.com/api/v3/project/${env.XSOLLA_PROJECT}/admin/payment/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Basic ' + btoa(`${env.XSOLLA_MERCHANT}:${env.XSOLLA_API_KEY}`) },
    body: JSON.stringify({
      sandbox,
      user: { id: { value: handle }, name: { value: handle }, country: { value: 'PY', allow_modify: true } },
      purchase: { items: [{ sku, quantity: 1 }] },
      settings: { language: 'es', currency: 'USD', return_url: `${origin}/?t=${encodeURIComponent(t)}&pago=ok` },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error((j.errorMessage || j.message || 'Xsolla ' + r.status));
  return `https://${sandbox ? 'sandbox-' : ''}secure.xsolla.com/paystation4/?token=${encodeURIComponent(j.token)}`;
}

/* ---------- Instagram (Meta) ---------- */
async function igValid(req, body, secret) {
  if (!secret) return false;
  const sig = (req.headers.get('x-hub-signature-256') || '').replace(/^sha256=/, '');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  if (mac.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < mac.length; i++) d |= mac.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}
// Token de Instagram Login (empieza con IG) -> graph.instagram.com y "me";
// token de Facebook / usuario del sistema (EAA...) -> graph.facebook.com y el id de la cuenta de Instagram.
const IG_ID = '17841413502664396';
function api(env) {
  const t = String(env.IG_TOKEN || '');
  return t.startsWith('IG')
    ? { base: 'https://graph.instagram.com/v21.0', me: 'me' }
    : { base: 'https://graph.facebook.com/v21.0', me: env.IG_USER_ID || IG_ID };
}
async function igPerfil(env, id) {
  const r = await fetch(`${api(env).base}/${id}?fields=username,is_user_follow_business&access_token=${encodeURIComponent(env.IG_TOKEN)}`);
  const j = await r.json();
  if (!r.ok) { log({ ev: 'perfil error', msg: (j.error && j.error.message) || r.status }); return null; }
  return j.username ? { handle: handleOf(j.username), sigue: typeof j.is_user_follow_business === 'boolean' ? j.is_user_follow_business : undefined } : null;
}
async function igSend(env, id, text) {
  const { base, me } = api(env);
  const r = await fetch(`${base}/${me}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.IG_TOKEN}` },
    body: JSON.stringify({ recipient: { id }, message: { text } }),
  });
  const j = await r.json().catch(() => ({}));
  log({ ev: r.ok ? 'respuesta enviada' : 'respuesta error', msg: r.ok ? undefined : (j.error && j.error.message) || r.status });
}
const BORRAR = /\bborrar\b/i;
async function igHandle(env, db, D, payload, origin, av) {
  for (const e of payload.entry || []) {
    for (const m of e.messaging || []) {
      const text = m.message && !m.message.is_echo ? m.message.text || '' : '';
      const modo = RESET.test(text) ? 'reset' : WORD.test(text) ? 'reclamar' : BORRAR.test(text) ? 'borrar' : null;
      log({ ev: 'mensaje', modo });
      if (!modo) continue;
      const u = await igPerfil(env, m.sender.id);
      if (!u) continue;
      if (modo === 'borrar') {
        await db.prepare('INSERT INTO pedidos(handle, tipo, texto, t) VALUES(?,?,?,?)').bind(u.handle, 'borrar', text.slice(0, 300), now()).run();
        av('borrar', 'Pedido de BORRAR datos', `${u.handle} pidió borrar sus datos. Revisalo en el panel.`, { url: '/admin/#pedidos' });
        await igSend(env, m.sender.id, 'Recibimos tu pedido para borrar tus datos de Pixépolis. Lo hacemos a mano en los próximos días y te avisamos por acá.');
        continue;
      }
      if (modo === 'reset') av('restablecer', 'Pedido de contraseña', `${u.handle} pidió restablecer su contraseña por DM.`, { url: '/admin/#fundadores' });
      const r = await botReply(db, D, env, u.handle, origin, u.sigue, modo);
      await igSend(env, m.sender.id, r.text);
    }
  }
}

/* ---------- rutas ---------- */
export async function onRequest(ctx) {
  const { request: req, env, params } = ctx;
  const db = env.DB;
  const url = new URL(req.url);
  const path = (params.path || []).join('/');
  const M = req.method;
  try {
    await init(db);
    const D = await loadData(ctx);
    // avisos push al admin: se mandan después de responder, así no demoran nada
    const av = (type, title, body, opt) => ctx.waitUntil(alert(db, type, title, body, opt));

    if (path === 'stats' && M === 'GET') {
      const st = await stats(db, D, env);
      ctx.waitUntil(metaCheck(db, st, env));
      return json({ ...st, islas: D.islas });
    }
    if (path === 'ig-estado' && M === 'GET') {
      const n = await seguidores(env);
      return json({ conectado: n !== null, seguidores: n, tipo: env.IG_TOKEN ? (String(env.IG_TOKEN).startsWith('IG') ? 'instagram' : 'facebook') : 'sin token', error: IGERR || null, ultimos: LOG });
    }

    if (path === 'yo' && M === 'GET') {
      const h = await byToken(db, url.searchParams.get('t'));
      if (!h) return fail(BAD_LINK, 404);
      const r = await mine(db, D, env, h);
      return r ? json(r) : fail('No encontramos tu pixelito.', 404);
    }

    // Crear o cambiar la contraseña. Con el link del DM siempre se puede (sirve para recuperarla);
    // con una sesión, solo si todavía no tenía.
    if (path === 'clave' && M === 'POST') {
      const b = await req.json().catch(() => ({}));
      const ti = await tokenInfo(db, b.t);
      if (!ti) return fail(BAD_LINK, 404);
      if (!claveOk(b.clave)) return fail('La contraseña tiene que tener entre 6 y 72 caracteres.');
      const ya = await db.prepare('SELECT 1 FROM cuentas WHERE handle=?').bind(ti.handle).first();
      if (ya && !ti.dm) return fail('Para cambiar la contraseña, mandá RESTABLECER por DM y entrá con el link que te llega.', 403);
      if (!ya) av('cuenta', 'Contraseña nueva', `${ti.handle} creó su contraseña y ya entra directo en pixepolis.com.`, { url: '/admin/#fundadores' });
      const salt = hex(crypto.getRandomValues(new Uint8Array(16))), h = await pbkdf2(b.clave, salt), t = now();
      await db.batch([
        db.prepare('INSERT INTO cuentas(handle, salt, hash, t, upd) VALUES(?1,?2,?3,?4,?4) ON CONFLICT(handle) DO UPDATE SET salt=excluded.salt, hash=excluded.hash, upd=excluded.upd').bind(ti.handle, salt, h, t),
        db.prepare('DELETE FROM sesiones WHERE handle=?').bind(ti.handle),
      ]);
      return json({ ok: true, sesion: await nuevaSesion(db, ti.handle) });
    }

    if (path === 'entrar' && M === 'POST') {
      const b = await req.json().catch(() => ({}));
      const h = handleOf(b.usuario);
      if (!HANDLE_RE.test(h) || typeof b.clave !== 'string') return fail('Usuario o contraseña incorrectos.', 401);
      const ip = req.headers.get('cf-connecting-ip') || 'x', keys = ['u:' + h, 'ip:' + ip];
      if (await frenado(db, keys)) return fail('Demasiados intentos. Probá de nuevo en 15 minutos.', 429);
      const cu = await db.prepare('SELECT salt, hash FROM cuentas WHERE handle=?').bind(h).first();
      if (!cu) { await fallo(db, keys); return fail('Ese @ todavía no tiene contraseña. Mandá RECLAMAR por DM a @somoslospixelitos y la creás en tu primer ingreso.', 401); }
      const calc = await pbkdf2(b.clave.slice(0, 72), cu.salt);
      let d = calc.length ^ cu.hash.length; for (let i = 0; i < calc.length; i++) d |= calc.charCodeAt(i) ^ cu.hash.charCodeAt(i);
      if (d) { await fallo(db, keys); return fail('Usuario o contraseña incorrectos.', 401); }
      await db.prepare('DELETE FROM intentos WHERE k=?').bind('u:' + h).run();
      return json({ sesion: await nuevaSesion(db, h) });
    }

    if (path === 'salir' && M === 'POST') {
      const b = await req.json().catch(() => ({}));
      if (b.t && b.t.length <= 64) await db.prepare('DELETE FROM sesiones WHERE th=?').bind(await sha(b.t)).run();
      return json({ ok: true });
    }

    // Comprar un paquete de Pixel Coins: devuelve la página de pago de Xsolla
    if (path === 'pack' && M === 'POST') {
      const b = await req.json().catch(() => ({}));
      const h = await byToken(db, b.t);
      if (!h) return fail(BAD_LINK, 404);
      const pk = PACKS[b.sku]; if (!pk) return fail('Ese paquete no existe.');
      const modo = pagosModo(env);
      if (modo === 'pronto') return fail('La compra de Pixel Coins abre muy pronto.', 409);
      if (modo === 'prueba') { await acreditar(db, h, pk[0], 'pack', b.sku + ' (prueba)', 'prueba-' + crypto.randomUUID()); return json({ prueba: true, ...(await bolsillo(db, h)) }); }
      try { return json({ url: await xsollaToken(env, h, b.sku, url.origin, b.t) }); }
      catch (e) { log({ ev: 'xsolla token', msg: String(e.message || e) }); return fail('No pudimos abrir el pago. Probá de nuevo en un rato.', 502); }
    }

    // Comprar piezas con Pixel Coins (adentro del juego)
    if (path === 'comprar' && M === 'POST') {
      const b = await req.json().catch(() => ({}));
      const h = await byToken(db, b.t);
      if (!h) return fail(BAD_LINK, 404);
      if (!TRAJES.includes(b.traje)) return fail('Ese traje no existe.');
      const pedidas = [...new Set(String(b.piezas || '').replace(/[^ctpf]/g, ''))];
      if (!pedidas.length) return fail('Elegí al menos una pieza.');
      const yo = await bolsillo(db, h);
      const rc = await db.prepare('SELECT look FROM reclamos WHERE handle=?').bind(h).first();
      const regalo = rc ? (JSON.parse(rc.look).regalo || '') : '';
      const tiene = k => yo.armario.includes(piezaId(b.traje, k)) || regalo === b.traje;
      const faltan = pedidas.filter(k => !tiene(k));
      if (!faltan.length) return fail('Ya tenés esas piezas.');
      const precio = faltan.length === 4 ? TRAJE_COINS : faltan.length * PIEZA_COINS;
      if (yo.coins < precio) return fail(`Te faltan ${precio - yo.coins} Pixel Coins.`, 402);
      const t = now();
      const r = await db.prepare('UPDATE billetera SET coins = coins - ?1, upd = ?2 WHERE handle = ?3 AND coins >= ?1').bind(precio, t, h).run();
      if (!r.meta.changes) return fail('No te alcanzan las Pixel Coins.', 402);
      await db.batch([
        ...faltan.map(k => db.prepare('INSERT OR IGNORE INTO armario(handle, pieza, t) VALUES(?,?,?)').bind(h, piezaId(b.traje, k), t)),
        db.prepare('INSERT INTO movimientos(handle, tipo, coins, detalle, t) VALUES(?,?,?,?,?)').bind(h, 'compra', -precio, `${b.traje}:${faltan.join('')}`, t),
      ]);
      const NOM = { c: 'gorra', t: 'remera', p: 'pantalón', f: 'zapatos' };
      av('compra', `Compra · ${precio} coins`, `${h} compró ${faltan.length === 4 ? 'el traje ' + b.traje + ' completo' : faltan.map(k => NOM[k]).join(', ') + ' de ' + b.traje}.`, { url: '/admin/#ventas' });
      return json({ ok: true, precio, compradas: faltan, ...(await bolsillo(db, h)) });
    }

    // Avisos de Xsolla: validar usuario y acreditar coins cuando el pago se confirma
    if (path === 'xsolla' && M === 'POST') {
      const body = await req.text();
      if (!(await xsollaValido(req, body, env.XSOLLA_WEBHOOK_SECRET))) { av('problema', 'Aviso de pago rechazado', 'Llegó un aviso a /api/xsolla con firma inválida (puede ser la clave del webhook mal cargada).', { key: 'xsfirma', every: 3600e3, url: '/admin/' }); return json({ error: { code: 'INVALID_SIGNATURE' } }, 400); }
      let n = {}; try { n = JSON.parse(body); } catch (e) {}
      const h = handleOf(n.user && (n.user.external_id || n.user.id));
      log({ ev: 'xsolla', tipo: n.notification_type });
      if (n.notification_type === 'user_validation') {
        const p = HANDLE_RE.test(h) ? await pixelito(db, D, h) : null;
        return p ? new Response(null, { status: 204 }) : json({ error: { code: 'INVALID_USER' } }, 400);
      }
      if (n.notification_type === 'order_paid' || n.notification_type === 'payment') {
        const items = (n.items || (n.purchase && n.purchase.virtual_items && n.purchase.virtual_items.items) || []);
        const ref = 'xs-' + ((n.order && n.order.id) || (n.transaction && n.transaction.id) || '');
        let coins = 0; for (const it of items) { const pk = PACKS[it.sku]; if (pk) coins += pk[0] * (+it.quantity || 1); }
        if (HANDLE_RE.test(h) && coins > 0 && ref !== 'xs-' && await acreditar(db, h, coins, 'pack', items.map(i => i.sku).join(','), ref)) {
          const usd = items.reduce((a, it) => a + ((PACKS[it.sku] || [0, 0])[1] * (+it.quantity || 1)), 0);
          av('venta', `Venta · US$ ${usd}`, `${h} compró ${coins.toLocaleString('es')} Pixel Coins.`, { url: '/admin/#ventas' });
        }
        return new Response(null, { status: 204 });
      }
      if (n.notification_type === 'refund' || n.notification_type === 'order_canceled') log({ ev: 'xsolla devolución', ref: n.order && n.order.id });
      return new Response(null, { status: 204 });
    }

    if (path === 'reclamar' && M === 'POST') {
      const b = await req.json().catch(() => ({}));
      const h = await byToken(db, b.t);
      if (!h) return fail(BAD_LINK, 404);
      const p = await pixelito(db, D, h);
      if (!p) return fail('No encontramos tu pixelito.', 404);
      if (p.out) return fail('Tu pixelito se fue en cohete. Volvé a seguirnos para recuperarlo.', 409);
      const prevRow = await db.prepare('SELECT look FROM reclamos WHERE handle=?').bind(h).first();
      const prev = prevRow ? JSON.parse(prevRow.look) : null, bl = b.look || {};
      const L = cleanLook(bl, D.islas.map(i => i.day));
      // El regalo se gana al reclamar antes de los 1.000 y, una vez elegido, no se cambia
      L.regaloOk = prev ? !!prev.regaloOk : ((await db.prepare('SELECT COUNT(*) n FROM reclamos').first()).n || 0) < META_REGALO; // primeros 1.000 en reclamar
      // Antes el regalo era un traje (quien lo eligió lo conserva); ahora son REGALO_COINS Pixel Coins
      L.regalo = prev && prev.regalo ? prev.regalo : '';
      // Ropa puesta por lugar (gorra, remera, pantalón, zapatos): solo piezas tuyas; hoy, las del traje de regalo
      const ropa = bl.ropa && typeof bl.ropa === 'object' ? bl.ropa : null;
      L.ropa = {};
      const arm = (await bolsillo(db, h)).armario;
      for (const k of 'ctpf') {
        const v = ropa ? ropa[k] : (L.regalo && String(bl.piezas || '').includes(k) ? L.regalo : '');
        L.ropa[k] = v && (v === L.regalo || arm.includes(piezaId(v, k))) ? v : '';
      }
      L.piezas = 'ctpf'.split('').filter(k => L.regalo && L.ropa[k] === L.regalo).join('');
      const look = JSON.stringify(L);
      const t = now();
      if (!prevRow) av('reclamo', 'Nuevo fundador', `${h} reclamó su pixelito${L.regaloOk ? ' (Fundador, con 300 Pixel Coins)' : ' (ya no entra entre los 1.000 Fundadores)'}.`, { url: '/admin/#fundadores' });
      await db.prepare(`INSERT INTO reclamos(handle, num, ord, look, t, upd) VALUES(?1, ?2, (SELECT COALESCE(MAX(ord),0)+1 FROM reclamos), ?3, ?4, ?4)
        ON CONFLICT(handle) DO UPDATE SET look=excluded.look, upd=excluded.upd`).bind(h, p.num || 0, look, t).run();
      return json(await mine(db, D, env, h));
    }

    /* ---------- panel de administración (/admin/) · solo la cuenta ADMIN ---------- */
    if (path.startsWith('admin/')) {
      const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('t');
      const ti = await tokenInfo(db, tok);
      if (!ti) return fail('Entrá con tu @ y tu contraseña.', 401);
      if (ti.handle !== ADMIN(env)) return fail('Esta cuenta no es administradora.', 403);
      await alertSchema(db);
      const sub = path.slice(6), all = async (q, ...b) => (await db.prepare(q).bind(...b).all()).results || [], one = async (q, ...b) => (await db.prepare(q).bind(...b).first()) || {};
      const usdDe = det => String(det || '').split(',').reduce((a, sku) => a + ((PACKS[sku.trim()] || [0, 0])[1]), 0);
      const REAL = "tipo='pack' AND ref NOT LIKE 'prueba-%'";

      if (sub === 'resumen' && M === 'GET') {
        const st = await stats(db, D, env), hoy = pyDayStart(pyDay()), sem = now() - 7 * 864e5, d14 = pyDayStart(pyDay(now() - 13 * 864e5));
        const rc = await one('SELECT COUNT(*) n, SUM(t>=?) hoy, SUM(t>=?) sem FROM reclamos', hoy, sem);
        const cl = await one('SELECT COUNT(*) n FROM cuentas');
        const bil = await one('SELECT COALESCE(SUM(coins),0) n FROM billetera');
        const mv = await one(`SELECT COALESCE(SUM(CASE WHEN tipo='regalo' THEN coins END),0) regaladas, COALESCE(SUM(CASE WHEN ${REAL} THEN coins END),0) vendidas, COALESCE(-SUM(CASE WHEN tipo='compra' THEN coins END),0) gastadas, COUNT(CASE WHEN tipo='compra' THEN 1 END) compras, COUNT(DISTINCT CASE WHEN tipo='compra' THEN handle END) compradores, COUNT(CASE WHEN tipo='pack' AND ref LIKE 'prueba-%' THEN 1 END) prueba FROM movimientos`);
        const packs = await all(`SELECT detalle, t FROM movimientos WHERE ${REAL}`);
        let usd = 0, usdHoy = 0, usdSem = 0; for (const x of packs) { const u = usdDe(x.detalle); usd += u; if (x.t >= hoy) usdHoy += u; if (x.t >= sem) usdSem += u; }
        // últimos 14 días: reclamos, compras con coins y US$ vendidos
        const dias = []; for (let i = 13; i >= 0; i--) dias.push({ day: pyDay(now() - i * 864e5), reclamos: 0, compras: 0, usd: 0 });
        const idx = t => dias.findIndex(d => d.day === pyDay(t));
        for (const r of await all('SELECT t FROM reclamos WHERE t>=?', d14)) { const i = idx(r.t); if (i >= 0) dias[i].reclamos++; }
        for (const r of await all("SELECT t FROM movimientos WHERE tipo='compra' AND t>=?", d14)) { const i = idx(r.t); if (i >= 0) dias[i].compras++; }
        for (const r of packs) if (r.t >= d14) { const i = idx(r.t); if (i >= 0) dias[i].usd += usdDe(r.detalle); }
        const top = await all("SELECT substr(pieza,1,instr(pieza,'-')-1) traje, COUNT(*) piezas FROM armario GROUP BY traje ORDER BY piezas DESC LIMIT 8");
        const pend = await one('SELECT COUNT(*) n FROM pedidos WHERE hecho IS NULL');
        return json({ seguidores: st.total, enVivo: st.enVivo, dia: D.day, pixelitos: D.P.size, reclamos: { total: rc.n || 0, hoy: rc.hoy || 0, semana: rc.sem || 0 }, conClave: cl.n || 0,
          coins: { enBilleteras: bil.n, regaladas: mv.regaladas, vendidas: mv.vendidas, gastadas: mv.gastadas }, compras: { n: mv.compras, personas: mv.compradores },
          ventas: { usd, hoy: usdHoy, semana: usdSem, n: packs.length, prueba: mv.prueba }, dias, top, pedidos: pend.n || 0, pagos: pagosModo(env), meta: META_REGALO });
      }
      if (sub === 'fundadores' && M === 'GET') {
        const q = '%' + String(url.searchParams.get('q') || '').toLowerCase().replace(/[%_]/g, '') + '%';
        const rows = await all(`SELECT r.handle, r.ord, r.num, r.t, r.look, COALESCE(b.coins,0) coins, (SELECT COUNT(*) FROM armario a WHERE a.handle=r.handle) piezas, (SELECT COUNT(*) FROM cuentas c WHERE c.handle=r.handle) clave
          FROM reclamos r LEFT JOIN billetera b ON b.handle=r.handle WHERE r.handle LIKE ? ORDER BY r.ord DESC LIMIT 300`, q);
        return json({ fundadores: rows.map(r => { let L = {}; try { L = JSON.parse(r.look); } catch (e) {} return { handle: r.handle, ord: r.ord, num: r.num, t: r.t, coins: r.coins, piezas: r.piezas, clave: !!r.clave, regaloOk: !!L.regaloOk, traje: L.regalo || '' }; }) });
      }
      if (sub === 'ventas' && M === 'GET') {
        const tipo = url.searchParams.get('tipo');
        const w = tipo === 'pack' ? `WHERE ${REAL}` : tipo === 'compra' ? "WHERE tipo='compra'" : tipo === 'regalo' ? "WHERE tipo='regalo'" : tipo === 'prueba' ? "WHERE tipo='pack' AND ref LIKE 'prueba-%'" : '';
        const rows = await all(`SELECT id, handle, tipo, coins, detalle, ref, t FROM movimientos ${w} ORDER BY id DESC LIMIT 200`);
        return json({ movimientos: rows.map(r => ({ ...r, usd: r.tipo === 'pack' && !String(r.ref || '').startsWith('prueba-') ? usdDe(r.detalle) : 0, prueba: String(r.ref || '').startsWith('prueba-') })) });
      }
      if (sub === 'pedidos' && M === 'GET') return json({ pedidos: await all('SELECT * FROM pedidos ORDER BY (hecho IS NOT NULL), id DESC LIMIT 200') });
      if (sub === 'pedidos/hecho' && M === 'POST') { const b = await req.json().catch(() => ({})); await db.prepare('UPDATE pedidos SET hecho=? WHERE id=?').bind(b.deshacer ? null : now(), +b.id || 0).run(); return json({ ok: true }); }
      if (sub === 'avisos' && M === 'GET') {
        const ep = url.searchParams.get('ep'), V = await vapid(db);
        const s1 = ep ? await db.prepare('SELECT prefs FROM pushsub WHERE ep=?').bind(ep).first() : null;
        const n = await one('SELECT COUNT(*) n FROM pushsub');
        return json({ pub: V.pub, types: ALERT_TYPES, sub: s1 ? { prefs: JSON.parse(s1.prefs || '{}') } : null, dispositivos: n.n || 0, log: await all('SELECT type, title, body, t, sent FROM alertlog ORDER BY id DESC LIMIT 40') });
      }
      if (sub === 'push' && M === 'POST') {
        const b = await req.json().catch(() => ({})), x = b.sub || {};
        if (!/^https:\/\//.test(x.endpoint || '') || !x.keys || !x.keys.p256dh || !x.keys.auth) return fail('Suscripción inválida.');
        await db.prepare("INSERT INTO pushsub(ep, uid, p256, auth, prefs, ua, t) VALUES(?,?,?,?,'{}',?,?) ON CONFLICT(ep) DO UPDATE SET p256=excluded.p256, auth=excluded.auth, uid=excluded.uid, fails=0").bind(x.endpoint, ti.handle, x.keys.p256dh, x.keys.auth, (req.headers.get('user-agent') || '').slice(0, 160), now()).run();
        return json({ ok: true });
      }
      if (sub === 'push/off' && M === 'POST') { const b = await req.json().catch(() => ({})); await db.prepare('DELETE FROM pushsub WHERE ep=?').bind(String(b.ep || '')).run(); return json({ ok: true }); }
      if (sub === 'push/prefs' && M === 'POST') { const b = await req.json().catch(() => ({})); await db.prepare('UPDATE pushsub SET prefs=? WHERE ep=?').bind(JSON.stringify(b.prefs || {}), String(b.ep || '')).run(); return json({ ok: true }); }
      if (sub === 'push/test' && M === 'POST') {
        const sent = await alert(db, 'meta', 'Prueba de avisos ✅', 'Así te van a llegar los avisos de Pixépolis.', { url: '/admin/' });
        return json({ sent });
      }
      return fail('No existe', 404);
    }

    if (path === 'dev/dm' && M === 'POST') {
      if (env.DEV !== '1') return fail('No disponible', 404);
      const b = await req.json().catch(() => ({}));
      const h = handleOf(b.from);
      if (!HANDLE_RE.test(h)) return fail('Usuario no válido');
      const modo = RESET.test(b.text || '') ? 'reset' : WORD.test(b.text || '') ? 'reclamar' : null;
      if (!modo && BORRAR.test(b.text || '')) { await db.prepare('INSERT INTO pedidos(handle, tipo, texto, t) VALUES(?,?,?,?)').bind(h, 'borrar', String(b.text).slice(0, 300), now()).run(); av('borrar', 'Pedido de BORRAR datos', `${h} pidió borrar sus datos.`, { url: '/admin/#pedidos' }); return json({ kind: 'ok', text: 'Recibimos tu pedido para borrar tus datos.' }); }
      if (modo === 'reset') av('restablecer', 'Pedido de contraseña', `${h} pidió restablecer su contraseña por DM.`, { url: '/admin/#fundadores' });
      if (!modo) return json({ kind: 'ignore', text: '(El bot responde a RECLAMAR y a RESTABLECER)' });
      return json(await botReply(db, D, env, h, url.origin, typeof b.sigue === 'boolean' ? b.sigue : undefined, modo));
    }

    if (path === 'ig' && M === 'GET') {
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && env.IG_VERIFY && url.searchParams.get('hub.verify_token') === env.IG_VERIFY;
      return ok ? new Response(url.searchParams.get('hub.challenge') || '') : new Response('no', { status: 403 });
    }

    if (path === 'ig' && M === 'POST') {
      const body = await req.text();
      if (!(await igValid(req, body, env.IG_APP_SECRET))) { log({ ev: 'firma inválida' }); return new Response('firma', { status: 401 }); }
      let pl = {}; try { pl = JSON.parse(body); } catch (e) {}
      log({ ev: 'webhook', obj: pl.object, campos: (pl.entry || []).map(e => Object.keys(e).join('+')).join(',') });
      ctx.waitUntil(igHandle(env, db, D, pl, url.origin, av).catch(e => log({ ev: 'error', msg: String(e && e.message || e) })));
      return new Response('ok');
    }

    return fail('No encontrado', 404);
  } catch (e) {
    return fail('Error del servidor', 500);
  }
}
