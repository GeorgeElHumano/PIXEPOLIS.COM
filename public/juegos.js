/* Pixépolis · Minijuegos: Memoria de pixelitos y Copiá el baile.
   Solo por diversión: no dan coins ni premios, y no hay azar pagando.
   Todos juegan el mismo tablero / la misma secuencia del día (semilla = fecha de Paraguay, la da el servidor).
   Usa lo de index.html: drawHD, sky, islandBase, nameTag, curMe, P_.me, P_.token, esFundador, $, esc, API, P_.DEMO. */
(function () {
  const { $, esc, drawHD, sky, islandBase, nameTag, curMe, F, txt, INK, HOME_LOOKS } = window.PX;
  const P_ = window.PX;
  const JX = {};                       // estado de los juegos
  let info = null;                     // { dia, pixelitos, mios, top }
  const hoyPY = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  function semilla(str) { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => { h = (h + 0x6D2B79F5) | 0; let x = Math.imul(h ^ (h >>> 15), 1 | h); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
  const mezclar = (arr, rnd) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const tiempo = ms => { const s = ms / 1000, m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };
  const fmtVal = (j, v) => v == null ? '—' : j === 'baile' ? `${v} paso${v === 1 ? '' : 's'}` : tiempo(v);

  /* ---------- servidor ---------- */
  async function cargar() {
    try {
      if (P_.DEMO) throw 0;
      const r = await fetch('/api/juegos?t=' + encodeURIComponent(P_.token || ''), { cache: 'no-store' });
      const d = await r.json(); if (d.error) throw 0; info = d;
    } catch (e) { info = info || { dia: hoyPY(), pixelitos: [], mios: {}, top: {} }; }
    pintarCard();
    return info;
  }
  // partida terminada sin marca (se tropezó en el primer paso): solo suma al contador de partidas
  function contar(juego) { if (P_.DEMO || !P_.token) return; fetch('/api/juegos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: P_.token, juego, valor: 0 }) }).catch(() => {}); }
  async function guardar(juego, valor) {
    if (P_.DEMO || !P_.token || !(valor > 0)) { const o = info.mios[juego] || (info.mios[juego] = {}); const mx = juego === 'baile'; if (o.hoy == null || (mx ? valor > o.hoy : valor < o.hoy)) o.hoy = valor; if (o.siempre == null || (mx ? valor > o.siempre : valor < o.siempre)) o.siempre = valor; return; }
    try { const r = await fetch('/api/juegos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: P_.token, juego, valor }) }); const d = await r.json(); if (!d.error) info = d; } catch (e) {}
    pintarCard();
  }

  /* ---------- tarjeta en "Mi pixelito" ---------- */
  function pintarCard() {
    const card = $('juegosCard'); if (!card || !P_.me) return;
    const ok = !!P_.me.claim;
    card.classList.toggle('lock', !ok);
    $('jLock').hidden = ok;
    const m = (info && info.mios) || {};
    $('jrBaile').textContent = ok ? `Récord: ${fmtVal('baile', (m.baile || {}).siempre)}` : '🔒';
    const mem = ['memoria6', 'memoria8', 'memoria12'].map(k => (m[k] || {}).siempre).filter(v => v != null);
    $('jrMem').textContent = ok ? (mem.length ? `Mejor: ${tiempo(Math.min(...mem))}` : 'Récord: —') : '🔒';
  }
  window.juegosRender = function () { pintarCard(); if (P_.me && P_.me.claim && !info) cargar(); };

  /* ---------- pantalla de juego ---------- */
  const ov = $('juego');
  function abrir(tit) { $('jTit').textContent = tit; $('jBody').innerHTML = ''; ov.hidden = false; document.body.classList.add('jugando'); return $('jBody'); }
  function cerrar() { ov.hidden = true; document.body.classList.remove('jugando'); JX.run = null; if (JX.timer) clearInterval(JX.timer); pintarCard(); }
  $('jX').onclick = cerrar;
  document.querySelectorAll('#juegosCard [data-juego]').forEach(b => b.onclick = async () => {
    if (!P_.me || !P_.me.claim) { $('jLock').animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], 300); return; }
    if (!info) await cargar();
    b.dataset.juego === 'baile' ? baile() : memoria();
  });
  function topHtml(j) {
    const t = (info.top || {})[j] || [];
    if (!t.length) return '<p class="muted" style="margin:6px 0 0">Nadie jugó todavía hoy. ¡Sé el primero!</p>';
    return '<ol class="jtop5">' + t.map(r => `<li${P_.me && r.handle === P_.me.pixelito.handle ? ' class="yo"' : ''}><span>${esc(r.handle)}</span><b>${fmtVal(j, r.valor)}</b></li>`).join('') + '</ol>';
  }

  /* ---------- sonido (8 bits) ---------- */
  let AC = null;
  const audio = () => { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) {} };
  function nota(f, dur = 0.18, tipo = 'square', vol = 0.07) {
    if (!AC) return; const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
    o.type = tipo; o.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const fanfarria = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => nota(f, 0.14), i * 90));
  const buzz = () => { nota(140, 0.35, 'sawtooth', 0.08); setTimeout(() => nota(98, 0.4, 'sawtooth', 0.08), 160); };

  /* ---------- compartir en historia ---------- */
  async function compartir(linea1, linea2, pose) {
    const W = 1080, H = 1920, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
    sky(c, W, H, 0);
    const T = (s, x, y, sz, col, st = Math.max(4, sz / 7)) => { c.font = `${sz}px "Press Start 2P", monospace`; while (c.measureText(s).width > 980 && sz > 18) { sz -= 2; c.font = `${sz}px "Press Start 2P", monospace`; } c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineWidth = st * 2; c.strokeStyle = INK; c.strokeText(s, x, y); c.fillStyle = col; c.fillText(s, x, y); };
    T('PIXÉPOLIS CLUB', 540, 200, 64, '#FFE14D', 9);
    T(linea1, 540, 330, 58, '#FFFFFF', 8);
    T(linea2, 540, 430, 46, '#FF3D7F', 7);
    islandBase(c, 190, 1360, 700, 110);
    const m = curMe(true);
    drawHD(c, m.L, 540 - 8 * 26, 1360 - 28 * 26 + 4, 26, { acc: m.acc, arms: pose === 'up' ? 'up' : '' });
    nameTag(c, m.name, 540, 560, 52, 0, !!m.founder, 960, 7);
    T('¿ME SUPERÁS?', 540, 1620, 48, '#FFE14D', 7);
    T('@somoslospixelitos', 540, 1740, 36, '#FFFFFF', 6);
    T('pixepolis.com', 540, 1820, 30, '#FFE14D', 5);
    const blob = await new Promise(ok => cv.toBlob(ok, 'image/png'));
    const file = new File([blob], 'pixepolis-juego.png', { type: 'image/png' });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: `${linea1} ${linea2} en Pixépolis 🎮 pixepolis.com @somoslospixelitos` }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    const v = document.createElement('div'); v.className = 'jfoto';
    v.innerHTML = `<img alt="Tu resultado para compartir"><p>Mantené apretada la imagen y tocá “Guardar en Fotos”.</p><button class="btn">Cerrar</button>`;
    v.querySelector('img').src = URL.createObjectURL(blob); v.querySelector('button').onclick = () => v.remove(); ov.appendChild(v);
  }

  /* =================== COPIÁ EL BAILE =================== */
  const PASOS = { up: ['👐', 'ARRIBA', '#FF3D7F', 784], down: ['⬇️', 'ABAJO', '#2F80ED', 392], left: ['⬅️', 'IZQUIERDA', '#27AE60', 523], right: ['➡️', 'DERECHA', '#FF9F1C', 659] };
  const KEYS = Object.keys(PASOS);
  function secuenciaNueva() { // cada partida, un baile distinto al azar (sin repetir 3 veces seguidas el mismo paso)
    const rnd = Math.random, s = [];
    while (s.length < 200) { const k = KEYS[Math.floor(rnd() * 4)]; if (s.length >= 2 && s[s.length - 1] === k && s[s.length - 2] === k) continue; s.push(k); }
    return s;
  }
  function baile() {
    const body = abrir('🕺 COPIÁ EL BAILE');
    body.innerHTML = `
      <div class="jstage"><canvas id="bCv" width="720" height="720"></canvas><div class="jmsg" id="bMsg"></div></div>
      <div class="jpad" id="bPad">${KEYS.map(k => `<button data-p="${k}" style="--c:${PASOS[k][2]}"><i>${PASOS[k][0]}</i>${PASOS[k][1]}</button>`).join('')}</div>
      <div class="jpanel" id="bPanel"></div>`;
    const cv = $('bCv'), c = cv.getContext('2d'), m = curMe(true); let seq = secuenciaNueva();
    const S = { fase: 'listo', n: 3, i: 0, mov: null, movT: 0, movD: 400, show: [], t0: 0, cae: 0, msgT: 0 };
    JX.run = S;
    const msg = (s, ms = 1100) => { $('bMsg').textContent = s; $('bMsg').classList.add('on'); S.msgT = performance.now() + ms; };
    const luz = (k, on) => { const b = document.querySelector(`#bPad [data-p="${k}"]`); if (b) b.classList.toggle('on', on); };
    const mover = (k, d) => { S.mov = k; S.movT = performance.now(); S.movD = d; nota(PASOS[k][3], Math.min(0.25, d / 1000)); luz(k, true); setTimeout(() => luz(k, false), d * 0.8); };
    const vel = () => Math.max(300, 620 - S.n * 14);
    function panel() {
      const mio = info.mios.baile || {};
      $('bPanel').innerHTML = `
        <p class="jrec">Tu récord: <b>${fmtVal('baile', mio.siempre)}</b> · Hoy: <b>${fmtVal('baile', mio.hoy)}</b></p>
        <button class="btn pink" id="bGo">${S.fase === 'fin' ? 'Otra vez' : '¡EMPEZAR!'}</button>
        ${S.fase === 'fin' && S.score ? '<button class="btn" id="bShare" style="margin-top:10px">Compartir en historia</button>' : ''}
        <div class="lbl">RÉCORDS DE HOY</div>${topHtml('baile')}
        <p class="note">Mirá el baile de tu pixelito y repetilo tocando los botones. Cada ronda suma un paso. Cada partida es un baile nuevo.</p>`;
      $('bGo').onclick = empezar;
      if ($('bShare')) $('bShare').onclick = () => compartir(`BAILÉ ${S.score} PASOS`, 'EN COPIÁ EL BAILE', 'up');
      $('bPanel').hidden = false;
    }
    function empezar() { audio(); seq = secuenciaNueva(); S.cae = 0; S.fase = 'listo'; S.n = 3; S.score = 0; $('bPanel').hidden = true; msg('¡Mirá bien!', 900); setTimeout(() => mostrar(), 900); }
    function mostrar() {
      if (JX.run !== S) return;
      S.fase = 'muestra'; S.i = 0; const d = vel();
      seq.slice(0, S.n).forEach((k, j) => setTimeout(() => { if (JX.run === S) mover(k, d * 0.85); }, j * d));
      setTimeout(() => { if (JX.run !== S) return; S.fase = 'turno'; msg('¡Tu turno!', 800); }, S.n * d + 150);
    }
    function tocar(k) {
      if (S.fase !== 'turno') return;
      if (k === seq[S.i]) {
        mover(k, 320); S.i++;
        if (S.i === S.n) { S.score = S.n; S.fase = 'bien'; setTimeout(fanfarria, 250); msg(`¡Bien! ${S.n} pasos`, 900); S.n++; setTimeout(mostrar, 1300); }
      } else {
        S.fase = 'cae'; S.cae = performance.now(); buzz(); luz(k, true); setTimeout(() => luz(k, false), 300);
        msg(S.score ? `¡Uy! Bailaste ${S.score} pasos` : '¡Uy! Se tropezó', 2200);
        setTimeout(async () => { if (JX.run !== S) return; S.fase = 'fin'; if (S.score) await guardar('baile', S.score); else contar('baile'); panel(); }, 1600);
      }
    }
    document.querySelectorAll('#bPad [data-p]').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); tocar(b.dataset.p); }));
    function dibujar(now) {
      if (JX.run !== S) return;
      const t = now / 33; c.setTransform(2, 0, 0, 2, 0, 0); c.imageSmoothingEnabled = false;
      sky(c, 360, 360, t); islandBase(c, 80, 292, 200, 26);
      if (now > S.msgT) $('bMsg').classList.remove('on');
      const u = 7, X = 180 - 8 * u, Y = 292 - 28 * u + 2, fx = 180, fy = 292;
      let k = 0, dx = 0, dy = 0, rot = 0, sx = 1, sy = 1, arms = '';
      if (S.mov) { k = (now - S.movT) / S.movD; if (k >= 1) { S.mov = null; k = 0; } }
      const s = Math.sin(Math.PI * Math.min(1, k));
      if (S.mov === 'up') { dy = -s * 26; arms = k > 0.08 && k < 0.92 ? 'up' : ''; }
      else if (S.mov === 'down') { sx = 1 + 0.14 * s; sy = 1 - 0.26 * s; }
      else if (S.mov === 'left') { dx = -s * 46; rot = -0.16 * s; }
      else if (S.mov === 'right') { dx = s * 46; rot = 0.16 * s; }
      else if (S.fase !== 'cae' && S.fase !== 'fin') dy = -Math.abs(Math.sin(now / 227)) * 3; // espera al ritmo
      if (S.fase === 'cae' || (S.fase === 'fin' && S.cae)) { const q = Math.min(1, (now - S.cae) / 350); rot = q * Math.PI / 2; dx = -q * 95; dy = -q * 4; }
      c.save(); c.translate(fx + dx, fy + dy); c.rotate(rot); c.scale(sx, sy); c.translate(-fx, -fy);
      drawHD(c, m.L, X, Y, u, { acc: m.acc, arms, blink: Math.floor(now / 2400) % 5 === 0 && (now % 2400) < 140 });
      c.restore();
      if (S.fase === 'cae' || (S.fase === 'fin' && S.cae)) for (let q = 0; q < 3; q++) { const a = now / 200 + q * 2.1; F(c, 230 + Math.cos(a) * 26, 250 + Math.sin(a) * 8, 6, 6, '#FFE14D'); }
      nameTag(c, m.name, 180, 24, 12, t, !!m.founder, 330, 3);
      c.fillStyle = 'rgba(20,18,31,.55)'; c.fillRect(0, 334, 360, 26);
      txt(c, S.fase === 'listo' || (S.fase === 'fin' && !S.cae) ? 'LISTO PARA BAILAR' : `RONDA ${S.n - 2} · ${S.n} PASOS`, 180, 347, 9, '#FFFFFF');
      requestAnimationFrame(dibujar);
    }
    panel(); requestAnimationFrame(dibujar);
  }

  /* =================== MEMORIA DE PIXELITOS =================== */
  function memoria() {
    const body = abrir('🃏 MEMORIA');
    const NIV = [[6, 'FÁCIL', 4], [8, 'NORMAL', 4], [12, 'DIFÍCIL', 4]];
    const m = info.mios || {};
    body.innerHTML = `
      <div class="card jcard">
        <p style="margin:0 0 12px">Encontrá los pares de pixelitos. Son pixelitos <b>reales</b> de otros que ya reclamaron: cuando encontrás un par, aparece su @. El tablero del día es el mismo para todos.</p>
        ${NIV.map(([p, n]) => `<button class="btn jniv" data-p="${p}"><b>${n}</b> · ${p} pares <small>Récord: ${fmtVal('m', (m['memoria' + p] || {}).siempre)}</small></button>`).join('')}
      </div>
      <div class="card jcard"><div class="lbl" style="margin-top:0">RÉCORDS DE HOY · NORMAL</div>${topHtml('memoria8')}</div>`;
    body.querySelectorAll('.jniv').forEach(b => b.onclick = () => { audio(); tablero(+b.dataset.p, NIV.find(x => x[0] === +b.dataset.p)); });
  }
  function relleno(n) { // si todavía hay pocos reclamados, completamos con pixelitos del pueblo
    return Array.from({ length: n }, (_, i) => { const h = HOME_LOOKS[i % HOME_LOOKS.length]; return { handle: '', L: { s: h.s, pa: h.pa, h: h.h, k: h.k, style: ['corto', 'largo', 'afro', 'colitas', 'rastas', 'cresta'][i % 6], outfit: ['remera', 'buzo', 'camisa', 'campera'][i % 4] }, acc: '' }; });
  }
  function tablero(P, niv) {
    const juego = 'memoria' + P, cols = niv[2];
    const base = (info.pixelitos || []).slice(0, P);
    const pix = base.concat(relleno(P - base.length));
    const mazo = mezclar(pix.flatMap((x, i) => [i, i]), semilla(`memoria-${info.dia}-${P}`));
    const body = abrir(`🃏 MEMORIA · ${niv[1]}`);
    body.innerHTML = `
      <div class="jbar"><span>⏱ <b id="mT">0:00.0</b></span><span>Pares <b id="mP">0/${P}</b></span><span>Intentos <b id="mI">0</b></span></div>
      <div class="jgrid" style="--cols:${cols}">${mazo.map((id, i) => `<button class="mcard" data-i="${i}" aria-label="Carta"><div class="in"><div class="back"></div><div class="front"><canvas width="96" height="132"></canvas><span></span></div></div></button>`).join('')}</div>
      <div class="jmsg2" id="mMsg"></div>
      <div class="jpanel" id="mPanel" hidden></div>`;
    const S = { abiertas: [], pares: 0, intentos: 0, t0: 0, fin: 0, lock: false };
    JX.run = S;
    const cards = [...body.querySelectorAll('.mcard')];
    cards.forEach((b, i) => {
      const p = pix[mazo[i]], cv = b.querySelector('canvas'), c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
      drawHD(c, p.L, 48 - 8 * 4, 128 - 28 * 4, 4, { acc: p.acc });
      b.querySelector('span').textContent = p.handle || '';
      b.onclick = () => voltear(b, i);
    });
    const reloj = () => { if (S.t0) $('mT').textContent = tiempo((S.fin || performance.now()) - S.t0); };
    JX.timer = setInterval(reloj, 100);
    const aviso = s => { const e = $('mMsg'); e.textContent = s; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); };
    function voltear(b, i) {
      if (S.lock || S.fin || b.classList.contains('up')) return;
      if (!S.t0) S.t0 = performance.now();
      b.classList.add('up'); nota(600 + S.abiertas.length * 200, 0.08); S.abiertas.push(i);
      if (S.abiertas.length < 2) return;
      S.intentos++; $('mI').textContent = S.intentos;
      const [a, z] = S.abiertas; S.abiertas = [];
      if (mazo[a] === mazo[z]) {
        S.pares++; $('mP').textContent = `${S.pares}/${P}`;
        [a, z].forEach(k => cards[k].classList.add('ok'));
        const h = pix[mazo[a]].handle; aviso(h ? `¡${h}!` : '¡Par!'); setTimeout(() => nota(880, 0.12), 80);
        if (S.pares === P) terminar();
      } else {
        S.lock = true;
        setTimeout(() => { cards[a].classList.remove('up'); cards[z].classList.remove('up'); S.lock = false; }, 850);
      }
    }
    async function terminar() {
      S.fin = performance.now(); reloj(); fanfarria();
      const ms = Math.round(S.fin - S.t0), antes = (info.mios[juego] || {}).siempre;
      await guardar(juego, ms);
      const nuevo = antes == null || ms < antes;
      const pnl = $('mPanel');
      pnl.innerHTML = `
        <h2 class="jfin">${nuevo ? '¡NUEVO RÉCORD!' : '¡COMPLETADO!'}</h2>
        <p class="jrec">Tiempo: <b>${tiempo(ms)}</b> · ${S.intentos} intentos<br>Tu récord: <b>${fmtVal('m', (info.mios[juego] || {}).siempre)}</b></p>
        <button class="btn pink" id="mShare">Compartir en historia</button>
        <button class="btn" id="mOtra" style="margin-top:10px">Elegir nivel</button>
        <div class="lbl">RÉCORDS DE HOY · ${niv[1]}</div>${topHtml(juego)}`;
      pnl.hidden = false; pnl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('mShare').onclick = () => compartir(`MEMORIA ${niv[1]}`, `EN ${tiempo(ms)}`, 'up');
      $('mOtra').onclick = () => { clearInterval(JX.timer); memoria(); };
    }
  }
  if (P_.me) window.juegosRender(); // por si la página ya cargó el pixelito antes que este archivo
})();
