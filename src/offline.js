import {deliver} from '../shared/delivery.js';
let database;
function db(){return database ||= new Promise((resolve,reject)=>{const request=indexedDB.open('raksha-grid-outbox-v2',1);request.onupgradeneeded=()=>request.result.createObjectStore('outbox',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function queueItems(ownerId){const database=await db();return new Promise((resolve,reject)=>{const req=database.transaction('outbox').objectStore('outbox').getAll();req.onsuccess=()=>resolve(req.result.filter(i=>i.ownerId===ownerId));req.onerror=()=>reject(req.error);});}
export async function put(item){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('outbox','readwrite');tx.objectStore('outbox').put(item);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
export async function updateItem(id,patch){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('outbox','readwrite'),store=tx.objectStore('outbox'),read=store.get(id);read.onsuccess=()=>{if(read.result)store.put({...read.result,...patch});};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
export async function verifyReceipt(receipt,jwk,requestId,ownerId){
 try{if(!receipt?.encoded||!receipt.signature||!jwk)return false;const bytes=v=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));const payload=JSON.parse(new TextDecoder().decode(bytes(receipt.encoded)));if(payload.requestId!==requestId||payload.ownerId!==ownerId||payload.status!=='HQ received'||!payload.incidentId||!payload.receivedAt)return false;const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,bytes(receipt.signature),new TextEncoder().encode(receipt.encoded))&&JSON.stringify(payload)===JSON.stringify(receipt.payload);}catch{return false;}
}
let running=false;
export async function flush(session,config,request,notify){
 if(running||!session?.user||!config)return;running=true;
 try{for(const item of (await queueItems(session.user.id)).sort((a,b)=>(a.kind==='sos'?0:1)-(b.kind==='sos'?0:1))){
  if(item.kind==='sos'&&!item.receipt&&!item.needsReview){
   const result=await deliver({report:{...item.report,ownerId:item.ownerId},ownerId:item.ownerId,ticket:session.ticket,config,verify:verifyReceipt,send:async(url,body,name)=>{
    if(name==='internet')return request(url,'POST',body);
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('Gateway unavailable ('+response.status+')');return response.json();
   }});Object.assign(item,result);item.lastAttempt=new Date().toISOString();await updateItem(item.id,{...result,lastAttempt:item.lastAttempt});notify(item);
  }
  if(item.kind==='sos'&&item.receipt&&item.media&&!item.mediaSent){
   try{await request(`/api/incidents/${item.receipt.payload.incidentId}/media/${item.media.id}`,'PUT',item.media);item.mediaSent=true;delete item.media;await put(item);notify(item);}catch(e){item.mediaError=e.message;await put(item);}
  }
  if(item.kind==='action'&&!item.sent){try{await request(item.url,'POST',item.body);item.sent=true;await put(item);notify(item);}catch(e){item.error=e.message;await put(item);}}
 }}finally{running=false;}
}
