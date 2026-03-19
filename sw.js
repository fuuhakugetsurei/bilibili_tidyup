const CACHE_NAME = 'bili-fav-v2';
const STATIC_ASSETS = [
  [span_2](start_span)'./',                // 改為相對路徑[span_2](end_span)
  [span_3](start_span)'./index.html',      // 加個點[span_3](end_span)
  [span_4](start_span)'./style.css',       // 加個點[span_4](end_span)
  [span_5](start_span)'./app.js',          // 加個點[span_5](end_span)
  [span_6](start_span)'./manifest.json'    // 加個點[span_6](end_span)
];


self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 封面圖片：網路優先，失敗用快取
  if (url.hostname.includes('hdslb.com') || url.hostname.includes('bilibili.com')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 靜態資源：快取優先
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
