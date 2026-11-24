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
//
// Variables (wrangler secret put / panel de Cloudflare):
//   DEV=1            habilita /api/dev/dm (NO ponerla en producción)
//   IG_VERIFY        palabra secreta que se carga en Meta para verificar el webhook
//   IG_APP_SECRET    secreto de la app de Meta (firma de los avisos)
//   IG_TOKEN         token de la cuenta @somoslospixelitos para responder mensajes

const LINK_HOURS = 24;
// Tienda: 15 trajes (los mismos ids que en public/index.html). Los que reclaman antes de META_REGALO seguidores eligen uno gratis.
const TRAJES = ['cowboy', 'astronauta', 'pirata', 'chef', 'bombero', 'mago', 'caballero', 'ninja', 'rockero', 'surfista', 'explorador', 'heroe', 'navidad', 'vampiro', 'robot'];
const META_REGALO = 1000;
const WORD = /\breclamar\b/i;
const RESET = /\b(restablecer|recuperar|reset)\b/i; // restablecer contraseña
const RESET_MIN = 60;
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
  return { total: ig ?? enReel + nuevos, claimed, day: D.day, enVivo: ig !== null };
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
  return { pixelito: p, claim: c ? { ord: c.ord, t: c.t, look: JSON.parse(c.look) } : null, tieneClave: !!cu, islas: islasCon(D), stats: await stats(db, D, env) };
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
async function igHandle(env, db, D, payload, origin) {
  for (const e of payload.entry || []) {
    for (const m of e.messaging || []) {
      const text = m.message && !m.message.is_echo ? m.message.text || '' : '';
      const modo = RESET.test(text) ? 'reset' : WORD.test(text) ? 'reclamar' : null;
      log({ ev: 'mensaje', modo });
      if (!modo) continue;
      const u = await igPerfil(env, m.sender.id);
      if (!u) continue;
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

    if (path === 'stats' && M === 'GET') return json({ ...(await stats(db, D, env)), islas: D.islas });
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
      L.regaloOk = prev ? !!prev.regaloOk : (await stats(db, D, env)).total < META_REGALO;
      L.regalo = prev && prev.regalo ? prev.regalo : (L.regaloOk && TRAJES.includes(bl.regalo) ? bl.regalo : '');
      // Ropa puesta por lugar (gorra, remera, pantalón, zapatos): solo piezas tuyas; hoy, las del traje de regalo
      const ropa = bl.ropa && typeof bl.ropa === 'object' ? bl.ropa : null;
      L.ropa = {};
      for (const k of 'ctpf') { const v = ropa ? ropa[k] : (L.regalo && String(bl.piezas || '').includes(k) ? L.regalo : ''); L.ropa[k] = L.regalo && v === L.regalo ? L.regalo : ''; }
      L.piezas = 'ctpf'.split('').filter(k => L.ropa[k]).join('');
      const look = JSON.stringify(L);
      const t = now();
      await db.prepare(`INSERT INTO reclamos(handle, num, ord, look, t, upd) VALUES(?1, ?2, (SELECT COALESCE(MAX(ord),0)+1 FROM reclamos), ?3, ?4, ?4)
        ON CONFLICT(handle) DO UPDATE SET look=excluded.look, upd=excluded.upd`).bind(h, p.num || 0, look, t).run();
      return json(await mine(db, D, env, h));
    }

    if (path === 'dev/dm' && M === 'POST') {
      if (env.DEV !== '1') return fail('No disponible', 404);
      const b = await req.json().catch(() => ({}));
      const h = handleOf(b.from);
      if (!HANDLE_RE.test(h)) return fail('Usuario no válido');
      const modo = RESET.test(b.text || '') ? 'reset' : WORD.test(b.text || '') ? 'reclamar' : null;
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
      ctx.waitUntil(igHandle(env, db, D, pl, url.origin).catch(e => log({ ev: 'error', msg: String(e && e.message || e) })));
      return new Response('ok');
    }

    return fail('No encontrado', 404);
  } catch (e) {
    return fail('Error del servidor', 500);
  }
}
