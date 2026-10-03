const CACHE_NAME = "colligo-ore-shell-20261003-1050";
const CORE = [
  "./",
  "./index.html",
  "./style.css?v=20261003-1050",
  "./layout.css?v=20261003-1050",
  "./app.js?v=20261003-1050",
  "./aggiornamento.js?v=20261003-1050",
  "./version.json",
  "../assets/icon-192.png",
  "../js/vendor/firebase-app-compat.js",
  "../js/vendor/firebase-firestore-compat.js",
  "../js/vendor/firebase-auth-compat.js"
];

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(CORE))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k.startsWith("colligo-ore-shell-")&&k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET") return;
  const url=new URL(req.url);
  if(url.origin!==location.origin) return;

  if(url.pathname.endsWith("/ore-produttivita/version.json")){
    event.respondWith(fetch(req,{cache:"no-store"}));
    return;
  }

  if(req.mode==="navigate"){
    event.respondWith(
      fetch(req).then(res=>{
        const copy=res.clone();
        caches.open(CACHE_NAME).then(c=>c.put("./index.html",copy));
        return res;
      }).catch(()=>caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>{
      const fresh=fetch(req).then(res=>{
        if(res&&res.ok){
          const copy=res.clone();
          caches.open(CACHE_NAME).then(c=>c.put(req,copy));
        }
        return res;
      }).catch(()=>cached);
      return cached||fresh;
    })
  );
});
