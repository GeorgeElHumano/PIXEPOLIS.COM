// Service worker mínimo: permite instalar la app; siempre pide la versión nueva y usa la guardada solo sin conexión.
const C = 'pixepolis-v1';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(C).then(c => c.addAll(['/', '/icono-192.png']).catch(() => {}))); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).pathname.startsWith('/api/')) return;
  if (r.mode === 'navigate') e.respondWith(fetch(r).catch(() => caches.match('/')));
});

// Avisos (notificaciones push): Reel nuevo, tienda y metas
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Pixépolis Club', { body: d.body || '', tag: d.tag, icon: '/icono-192.png', badge: '/icono-192.png', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    if (url.startsWith('/')) { const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); for (const c of list) { try { await c.focus(); return; } catch (x) {} } }
    await self.clients.openWindow(url);
  })());
});
