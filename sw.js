const CACHE = "tablenest-core-v1";
const FILES = [
  "/",
  "/css/workbench/app.css?v=1",
  "/js/workbench/app.js?v=1",
  "/js/workbench/data.js",
  "/js/workbench/worker.js",
  "/js/workbench/theme.js?v=1",
  "/js/sqlite/db.js",
  "/js/sqlite/sqlite3.js",
  "/js/sqlite/sqlite3.wasm",
  "/vendor/sql-formatter.js",
  "/fonts/inter-latin.woff2",
  "/fonts/jetbrains-mono-latin.woff2",
  "/img/mark.svg",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("tablenest-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && url.pathname === "/") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() =>
          url.pathname === "/" ? caches.match("/") : Response.error(),
        ),
    );
    return;
  }
  if (FILES.some((file) => new URL(file, location.origin).href === url.href))
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
});
