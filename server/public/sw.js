const CACHE = 'riego-v3';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Nunca interceptar: API, WebSocket, JS, CSS, íconos, manifiestos
  if (url.includes('/api/') || url.includes('/ws/') ||
      url.includes('.js') || url.includes('.css') ||
      url.includes('.png') || url.includes('.svg') ||
      url.includes('manifest.json')) return;

  // Solo páginas HTML: red primero, caché de respaldo offline
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copia));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
