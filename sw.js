/* ============================================================
   Service Worker — Différentiel (aide au diagnostic)
   Objectif : installabilité PWA + fonctionnement 100 % hors ligne.

   Stratégies :
   - App shell (index.html, manifest, icônes) : pré-caché à l'install,
     servi en cache-first → démarrage instantané et hors ligne fiable.
   - Navigations : network-first avec repli sur l'index caché (mises à
     jour appliquées en ligne, appli toujours disponible hors ligne).
   - Polices Google (cross-origin, best-effort) : stale-while-revalidate,
     jamais bloquant si le réseau est absent.
   Incrémentez CACHE_VERSION à chaque déploiement pour purger l'ancien cache.
   ============================================================ */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `differentiel-${CACHE_VERSION}`;

// App shell — chemins relatifs à la portée (scope) du service worker.
// NB : './' et './index.html' renvoient le même document (2,3 Mo) ; on ne
// pré-cache que './index.html' pour éviter un double téléchargement, et la
// navigation ci-dessous s'appuie sur cette entrée pour le repli hors ligne.
const CORE_ASSETS = [
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll échoue en bloc si une ressource manque : on ajoute donc en
      // tolérant les échecs unitaires (une icône absente ne doit pas casser
      // l'installation de l'app shell essentiel).
      await Promise.all(
        CORE_ASSETS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'reload' });
            if (res && (res.ok || res.type === 'opaque')) {
              await cache.put(url, res.clone());
            }
          } catch (err) {
            /* ressource optionnelle indisponible : on continue */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('differentiel-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch (e) {}
      }
      await self.clients.claim();
    })()
  );
});

// Permet à la page de forcer l'activation d'un SW en attente.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isFontRequest(url) {
  return (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) Navigations (chargement de la page) : network-first + repli hors ligne.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) {
            const cache = await caches.open(CACHE_NAME);
            cache.put('./index.html', preload.clone()).catch(() => {});
            return preload;
          }
          const net = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put('./index.html', net.clone()).catch(() => {});
          return net;
        } catch (err) {
          const cache = await caches.open(CACHE_NAME);
          return (
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  // 2) Polices Google (cross-origin) : stale-while-revalidate best-effort.
  if (isFontRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              cache.put(request, res.clone()).catch(() => {});
            }
            return res;
          })
          .catch(() => null);
        return cached || (await network) || Response.error();
      })()
    );
    return;
  }

  // 3) Ressources same-origin (icônes, manifest, assets) : cache-first.
  if (sameOrigin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const net = await fetch(request);
          if (net && net.ok) cache.put(request, net.clone()).catch(() => {});
          return net;
        } catch (err) {
          return Response.error();
        }
      })()
    );
  }
});
