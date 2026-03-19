const CACHE_NAME = 'bili-fav-v2';
const STATIC_ASSETS = [
  './',                // 改為相對路徑
  './index.html',      // 加個點
  './style.css',       // 加個點
  './app.js',          // 加個點
  './manifest.json'    // 加個點
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
