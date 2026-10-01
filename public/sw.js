// Service worker mínimo: guarda a "casca" do app para abrir rápido.
// Dados (Supabase) nunca são cacheados — sempre vêm da rede.
const CACHE = "contas-v2";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

/** Depois de baixar um index.html novo, tira do cache os arquivos de builds antigos. */
async function podarAssets(cache, html) {
  const atuais = new Set([...html.matchAll(/assets\/[^"'\s)]+/g)].map((m) => m[0]));
  for (const req of await cache.keys()) {
    const caminho = new URL(req.url).pathname;
    const i = caminho.indexOf("assets/");
    if (i >= 0 && !atuais.has(caminho.slice(i))) await cache.delete(req);
  }
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  const navegacao = e.request.mode === "navigate";
  // rede primeiro; se estiver sem internet, usa o cache
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        // só guarda respostas boas do próprio site (nunca erros)
        if (r.ok && r.type === "basic") {
          const copia = r.clone();
          e.waitUntil(
            caches.open(CACHE).then(async (c) => {
              await c.put(e.request, copia.clone());
              if (navegacao) await podarAssets(c, await copia.text());
            }),
          );
        }
        return r;
      })
      .catch(() =>
        caches.match(e.request).then((r) => r || (navegacao ? caches.match("./index.html") : Response.error())),
      ),
  );
});
