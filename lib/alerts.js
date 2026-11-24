// Pixépolis · avisos al administrador (notificaciones push), adaptado de NOX.
// Web Push estándar (RFC 8030/8291/8292) con WebCrypto, sin librerías: iPhone (app agregada al inicio, iOS 16.4+), Android y PC.
// Las claves VAPID se crean solas la primera vez y quedan en la base (pushkv): no hace falta ningún secreto.

export const ALERT_TYPES = [
  { id: 'venta', g: 'Plata', name: 'Venta de Pixel Coins (pago de Xsolla)' },
  { id: 'compra', g: 'Plata', name: 'Compra de ropa con Pixel Coins' },
  { id: 'reclamo', g: 'Comunidad', name: 'Nuevo fundador (pixelito reclamado)' },
  { id: 'cuenta', g: 'Comunidad', name: 'Contraseña creada por primera vez' },
  { id: 'meta', g: 'Comunidad', name: 'Seguidores: cada 100 nuevos y metas' },
  { id: 'borrar', g: 'Pedidos', name: 'Pedido de BORRAR datos por DM' },
  { id: 'restablecer', g: 'Pedidos', name: 'Pedido de RESTABLECER contraseña' },
  { id: 'problema', g: 'Problemas', name: 'Instagram desconectado o pago con firma inválida' },
];
const TYPE_IDS = new Set(ALERT_TYPES.map(x => x.id));

export const ALERT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pushsub(ep TEXT PRIMARY KEY, uid TEXT NOT NULL, p256 TEXT NOT NULL, auth TEXT NOT NULL, prefs TEXT NOT NULL DEFAULT '{}', ua TEXT, t INTEGER, last INTEGER, fails INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS pushkv(k TEXT PRIMARY KEY, v TEXT, t INTEGER)`,
  `CREATE TABLE IF NOT EXISTS alertlog(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, title TEXT, body TEXT, url TEXT, t INTEGER, sent INTEGER)`,
];
let schemaOk = false;
export async function alertSchema(db) { if (schemaOk) return; await db.batch(ALERT_SCHEMA.map(q => db.prepare(q))); schemaOk = true; }

/* ---------- utilidades ---------- */
const enc = new TextEncoder();
export const pyDay = (t = Date.now()) => new Date(t - 3 * 3600e3).toISOString().slice(0, 10); // día de Paraguay (UTC-3)
export const pyDayStart = day => Date.parse(day + 'T00:00:00-03:00');
export const gsTxt = n => String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' Gs';
export const nTxt = n => String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const b64u = u8 => { let s = ''; const a = new Uint8Array(u8); for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const cat = (...l) => { const out = new Uint8Array(l.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of l) { out.set(x, o); o += x.length; } return out; };
const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bytes * 8));

/* ---------- claves VAPID (se crean una vez y quedan en la base) ---------- */
let VAPID = null;
export async function vapid(db) {
  if (VAPID) return VAPID;
  let r = await db.prepare("SELECT v FROM pushkv WHERE k='vapid'").first();
  if (!r) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    await db.prepare("INSERT OR IGNORE INTO pushkv(k,v,t) VALUES('vapid',?,?)").bind(JSON.stringify({ pub, jwk }), Date.now()).run();
    r = await db.prepare("SELECT v FROM pushkv WHERE k='vapid'").first(); // si otro pedido la creó al mismo tiempo, vale la suya
  }
  const v = JSON.parse(r.v);
  VAPID = { pub: v.pub, key: await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']), jwts: new Map() };
  return VAPID;
}
async function vapidAuth(db, endpoint) {
  const V = await vapid(db), aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000);
  const c = V.jwts.get(aud); if (c && c.exp - now > 3600) return 'vapid t=' + c.jwt + ', k=' + V.pub;
  const exp = now + 12 * 3600;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))), body = b64u(enc.encode(JSON.stringify({ aud, exp, sub: 'mailto:admin@pixepolis.com' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, V.key, enc.encode(head + '.' + body)); // WebCrypto ya da r||s (el formato de JWS)
  const jwt = head + '.' + body + '.' + b64u(sig); V.jwts.set(aud, { jwt, exp });
  return 'vapid t=' + jwt + ', k=' + V.pub;
}

/* ---------- cifrado del mensaje (RFC 8291, aes128gcm, un solo registro) ---------- */
export async function encryptPush(p256dh, authSecret, plain, _test) {
  const uaPub = unb64u(p256dh), auth = unb64u(authSecret);
  const eph = _test ? _test.eph : await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = _test ? _test.salt : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(typeof plain === 'string' ? enc.encode(plain) : plain, new Uint8Array([2]))));
  const head = new Uint8Array(21); head.set(salt, 0); new DataView(head.buffer).setUint32(16, 4096); head[20] = asPub.length;
  return cat(head, asPub, ct);
}

async function pushOne(db, s, payload) {
  const body = await encryptPush(s.p256, s.auth, payload);
  const r = await fetch(s.ep, { method: 'POST', headers: { TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: await vapidAuth(db, s.ep) }, body });
  return r.status;
}

/* ---------- mandar un aviso ----------
   type: uno de ALERT_TYPES. opt.url: a dónde lleva al tocarlo. opt.key + opt.every (ms): no repetir el mismo aviso antes de ese tiempo.
   Nunca tira error: un aviso que falla no puede romper un pago ni el servidor. */
export async function alert(db, type, title, body, opt = {}) {
  try {
    if (!TYPE_IDS.has(type)) return 0;
    await alertSchema(db);
    if (opt.key && !(await once(db, 'a:' + opt.key, opt.every || 3600e3))) return 0;
    title = String(title || '').slice(0, 80); body = String(body || '').slice(0, 300);
    const url = String(opt.url || '/admin/');
    const subs = ((await db.prepare('SELECT * FROM pushsub').all()).results || []).filter(s => { try { return JSON.parse(s.prefs || '{}')[type] !== false; } catch { return true; } });
    const payload = JSON.stringify({ title, body, url, tag: opt.tag || type + ':' + Date.now().toString(36), type });
    let sent = 0;
    await Promise.all(subs.map(async s => {
      let st = 0; try { st = await pushOne(db, s, payload); } catch { st = 0; }
      if (st >= 200 && st < 300) { sent++; await db.prepare('UPDATE pushsub SET last=?, fails=0 WHERE ep=?').bind(Date.now(), s.ep).run(); }
      else if (st === 404 || st === 410) await db.prepare('DELETE FROM pushsub WHERE ep=?').bind(s.ep).run(); // el dispositivo ya no la quiere
      else await db.prepare('UPDATE pushsub SET fails=fails+1 WHERE ep=?').bind(s.ep).run();
    }));
    await db.prepare('DELETE FROM pushsub WHERE fails>30').run();
    const ins = await db.prepare('INSERT INTO alertlog(type,title,body,url,t,sent) VALUES(?,?,?,?,?,?)').bind(type, title, body, url, Date.now(), sent).run();
    if (ins.meta && ins.meta.last_row_id % 50 === 0) await db.prepare('DELETE FROM alertlog WHERE id<?').bind(ins.meta.last_row_id - 300).run();
    return sent;
  } catch (e) { try { console.log('alert', type, e && e.message); } catch {} return 0; }
}
// true solo la primera vez dentro de `every` ms (una sola sentencia: dos pedidos a la vez no avisan dos veces)
export async function once(db, k, every) {
  const now = Date.now();
  const r = await db.prepare('INSERT INTO pushkv(k,v,t) VALUES(?,\'\',?) ON CONFLICT(k) DO UPDATE SET t=excluded.t WHERE pushkv.t<? RETURNING k').bind(k, now, now - every).first();
  return !!r;
}
