// Pixépolis Admin · solo recibe avisos push y abre el panel al tocarlos (no guarda nada en caché).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Pixépolis', {
    body: d.body || '', tag: d.tag, icon: '/icono-192.png', badge: '/icono-192.png',
    data: { url: d.url || '/admin/' }, timestamp: Date.now(),
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/admin/', self.location.origin).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) if (c.url.includes('/admin/')) { try { await c.focus(); c.postMessage({ nav: url }); return; } catch (x) {} }
    await self.clients.openWindow(url);
  })());
});
