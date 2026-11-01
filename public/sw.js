const CACHE='raksha-shell-v2';
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE),response=await fetch('/index.html',{cache:'reload'});
 if(!response.ok)throw new Error('App shell unavailable');
 const html=await response.clone().text();await cache.put('/index.html',response);
 const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match=>match[1]);
 await cache.addAll(assets);await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api')||url.pathname.startsWith('/socket.io'))return;
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match('/index.html')));return;}
 if(url.pathname.startsWith('/assets/'))event.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(event.request);if(cached)return cached;const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;}));
});
