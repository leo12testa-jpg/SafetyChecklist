const CACHE_NAME = "colligo-ore-shell-20261006-121622";
const CORE = [
  "./",
  "./index.html",
  "./style.css?v=20261006-121622",
  "./layout.css?v=20261006-121622",
  "./app.js?v=20261006-121622",
  "./crm-links.js?v=20261006-121622",
  "./internal-activities.js?v=20261006-121622",
  "./work-schedules.js?v=20261006-121622",
  "./work-phases.js?v=20261006-121622",
  "./identities.js?v=20261006-121622",
  "./job-closure.js?v=20261006-121622",
  "./job-complexity.js?v=20261006-121622",
  "./company-periods.js?v=20261006-121622",
  "./month-closures.js?v=20261006-121622",
  "./access-roles.js?v=20261006-121622",
  "./data-quality.js?v=20261006-121622",
  "./day-unlocks.js?v=20261006-121622",
  "./session-history.js?v=20261006-121622",
  "./missing-days.js?v=20261006-121622",
  "./aggiornamento.js?v=20261006-121622",
  "./version.json",
  "./manifest.json",
  "../assets/icon-192.png",
  "../assets/icon-512.png",
  "../assets/icon-512-maskable.png",
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
