"use strict";
const CACHE_NAME="patrick-workspace-static-v3";
const STATIC=["./","./index.html","./style.css?v=3","./app.js?v=3","./manifest.webmanifest","./icon.svg"];
self.addEventListener("install",event=>{event.waitUntil((async()=>{
  const cache=await caches.open(CACHE_NAME);
  for(const file of STATIC){try{await cache.add(new Request(file,{cache:"reload"}))}catch(e){}}
  await self.skipWaiting();
})())});
self.addEventListener("activate",event=>{event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(n=>n.startsWith("patrick-workspace-static-")&&n!==CACHE_NAME).map(n=>caches.delete(n)));
  await self.clients.claim();
})())});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  const scope=new URL("./",self.location.href);
  if(!url.pathname.startsWith(scope.pathname))return;
  const isStatic=event.request.mode==="navigate"||["script","style","image","manifest"].includes(event.request.destination);
  if(!isStatic)return;
  event.respondWith((async()=>{
    try{const res=await fetch(new Request(event.request,{cache:"no-store"}));if(res.ok){const cache=await caches.open(CACHE_NAME);cache.put(event.request,res.clone()).catch(()=>{});return res}}catch(e){}
    const cached=await caches.match(event.request);
    if(cached)return cached;
    if(event.request.mode==="navigate"){const shell=await caches.match(new URL("./index.html",scope).href);if(shell)return shell}
    return Response.error();
  })());
});