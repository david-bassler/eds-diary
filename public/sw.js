const CACHE_NAME = 'eds-diary-shell-v12'
const APP_SHELL = [
  './',
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/app-icon-192.png',
  './icons/app-icon-512.png',
  './icons/app-icon-maskable-192.png',
  './icons/app-icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './body-map/front-gray.png',
  './body-map/front-hitmap.png',
  './body-map/back-gray.png',
  './body-map/back-hitmap.png',
  './body-map/details/hand-top-hitmap.png',
  './body-map/details/hand-palm-hitmap.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (cacheName) =>
                cacheName.startsWith('eds-diary-shell-') &&
                cacheName !== CACHE_NAME,
            )
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  const requestUrl = new URL(request.url)
  if (requestUrl.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (networkResponse) => {
          if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME)
            await cache.put('./', networkResponse.clone())
            return networkResponse
          }

          const cachedPage = await caches.match('./')
          return cachedPage ?? networkResponse
        })
        .catch(async () => {
          const cachedPage = await caches.match(request)
          return cachedPage ?? caches.match('./')
        }),
    )
    return
  }

  const cacheableDestinations = new Set([
    'font',
    'image',
    'script',
    'style',
    'manifest',
  ])

  if (!cacheableDestinations.has(request.destination)) return

  event.respondWith(
    caches.match(request).then(async (cachedResponse) => {
      if (cachedResponse) return cachedResponse

      const networkResponse = await fetch(request)
      if (!networkResponse.ok) return networkResponse

      const cache = await caches.open(CACHE_NAME)
      await cache.put(request, networkResponse.clone())

      return networkResponse
    }),
  )
})
