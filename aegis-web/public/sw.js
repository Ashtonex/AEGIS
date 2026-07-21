const CACHE_NAME = "aegis-portal-shell-v3";
const PRECACHE_URLS = [
  "/",
  "/login",
  "/setup-password",
  "/offline",
  "/manifest.webmanifest",
  "/project_portal_dashboard.png",
  "/version.json",
];
const OUTBOX_DB = "aegis-pwa";
const OUTBOX_STORE = "outbox";
const OUTBOX_SYNC_TAG = "aegis-outbox-sync";

function openOutboxDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OUTBOX_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putOutboxItem(item) {
  const db = await openOutboxDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    tx.objectStore(OUTBOX_STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function listOutboxItems() {
  const db = await openOutboxDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readonly");
    const request = tx.objectStore(OUTBOX_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function deleteOutboxItem(id) {
  const db = await openOutboxDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    tx.objectStore(OUTBOX_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage(message);
  }
}

function buildOfflineUrl(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  const moduleName = segments[0] === "dashboard" ? segments[1] || "dashboard" : segments[0] || "dashboard";
  return `/offline?module=${encodeURIComponent(moduleName)}&from=${encodeURIComponent(pathname)}`;
}

function isQueueableRequest(request) {
  if (request.method === "GET" || request.method === "HEAD") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (!url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/api/v1/auth/")) return false;
  if (url.pathname.startsWith("/api/v1/pwa/")) return false;

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) return false;
  if (contentType.includes("application/octet-stream")) return false;
  return true;
}

async function serializeRequest(request) {
  const headers = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key] = value;
  }

  let body = null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      body = await request.clone().text();
    } catch {
      body = null;
    }
  }

  return {
    id: crypto.randomUUID(),
    url: request.url,
    method: request.method,
    headers,
    body,
    mode: request.mode,
    credentials: request.credentials,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
}

async function queueRequest(request) {
  const record = await serializeRequest(request);
  await putOutboxItem(record);
  if (self.registration.sync) {
    try {
      await self.registration.sync.register(OUTBOX_SYNC_TAG);
    } catch {
      // Best effort. The page can also flush the queue when it comes online.
    }
  }
  await notifyClients({ type: "PWA_QUEUE_ADDED", requestUrl: request.url });
}

async function replayQueuedRequests() {
  const items = await listOutboxItems();
  for (const item of items) {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body && item.method !== "GET" && item.method !== "HEAD" ? item.body : undefined,
        credentials: item.credentials || "same-origin",
        mode: item.mode || "same-origin",
        cache: "no-store",
      });

      if (response.ok) {
        await deleteOutboxItem(item.id);
        continue;
      }

      if (response.status >= 400 && response.status < 500) {
        await deleteOutboxItem(item.id);
        await notifyClients({
          type: "PWA_QUEUE_FAILED",
          requestUrl: item.url,
          status: response.status,
        });
        continue;
      }

      break;
    } catch {
      break;
    }
  }
  await notifyClients({ type: "PWA_QUEUE_FLUSHED" });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === OUTBOX_SYNC_TAG) {
    event.waitUntil(replayQueuedRequests());
  }
});

self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "FLUSH_PWA_QUEUE") {
    event.waitUntil(replayQueuedRequests());
    return;
  }

  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "AEGIS alert", message: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "AEGIS alert";
  const body = payload.message || payload.body || "";
  const url = payload.action_url || payload.url || "/dashboard";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url, payload },
      tag: payload.id || payload.tag || "aegis-alert",
      renotify: true,
      icon: "/project_portal_dashboard.png",
      badge: "/project_portal_dashboard.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await client.navigate(url);
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    if (isQueueableRequest(request)) {
      event.respondWith(
        fetch(request).catch(async () => {
          await queueRequest(request);
          return new Response(
            JSON.stringify({
              success: true,
              data: { queued: true },
              message: "Saved offline and will sync when the connection returns.",
              meta: { queued: true },
            }),
            {
              status: 202,
              headers: { "Content-Type": "application/json" },
            }
          );
        })
      );
    }
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === "/version.json") {
    event.respondWith(fetch(request).catch(() => caches.match("/version.json")));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const offlineUrl = buildOfflineUrl(url.pathname);
        return (await caches.match("/offline")) || (await caches.match(offlineUrl)) || (await caches.match("/login"));
      })
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match("/offline"));
    })
  );
});

