import 'dotenv/config';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Server} from 'socket.io';
import {makeSeed} from '../shared/domain.js';
import {createApp} from './app.js';
import express from 'express';
import {migrate} from './workflows.js';
import {passwordHash} from './security.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const projectDataFile=path.join(root,'data','state.json');
let dataFile=process.env.RAKSHA_GRID_DATA_FILE||projectDataFile;
let state,collection,mongo;
if(process.env.MONGODB_URI){
 const {MongoClient}=await import('mongodb');mongo=new MongoClient(process.env.MONGODB_URI);await mongo.connect();
 collection=mongo.db(process.env.MONGODB_DB||'raksha_grid').collection('simulation');
 state=(await collection.findOne({_id:'state'}))?.value||makeSeed();
}else{
 await mkdir(path.dirname(dataFile),{recursive:true});
 if(!process.env.RAKSHA_GRID_DATA_FILE){
  const probe=path.join(path.dirname(dataFile),'.write-check-'+process.pid);
  try{await writeFile(probe,'ok');await unlink(probe);}
  catch(error){
   try{await unlink(probe);}catch{}
   if(process.platform!=='win32')throw error;
   dataFile=path.join('C:\\Windows\\TEMP','raksha-grid-state.json');
   console.warn('Project data folder is not writable; using '+dataFile+' for this local demo.');
  }
 }
 try{state=JSON.parse(await readFile(dataFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state=makeSeed();}
 // Keep any existing project scenario when the fallback is first used.
 if(dataFile!==projectDataFile&&!process.env.RAKSHA_GRID_DATA_FILE){
  try{await readFile(dataFile,'utf8');}
  catch(e){if(e.code!=='ENOENT')throw e;try{state=JSON.parse(await readFile(projectDataFile,'utf8'));}catch(inner){if(inner.code!=='ENOENT')throw inner;}}
 }
}
const store={kind:collection?'mongodb':'local-json',get:()=>state,save:async(next)=>{
 if(collection)await collection.updateOne({_id:'state'},{$set:{value:next}},{upsert:true});
 else {await writeFile(dataFile+'.tmp',JSON.stringify(next,null,2));await rename(dataFile+'.tmp',dataFile);}
 state=next;
}};
state=migrate(state);
if(!state.users.some(u=>u.role==='operator')&&process.env.BOOTSTRAP_OPERATOR_EMAIL&&process.env.BOOTSTRAP_OPERATOR_PASSWORD){
 state.users.push({id:crypto.randomUUID(),name:process.env.BOOTSTRAP_OPERATOR_NAME||'HQ Operator',email:process.env.BOOTSTRAP_OPERATOR_EMAIL.toLowerCase(),passwordHash:passwordHash(process.env.BOOTSTRAP_OPERATOR_PASSWORD),role:'operator',verified:true});
}
await store.save(state);
let io;
const gateways=Object.fromEntries(['local','rf','satellite'].map(name=>[name,{url:process.env[name.toUpperCase()+'_GATEWAY_URL'],key:process.env[name.toUpperCase()+'_GATEWAY_KEY']}]));
const app=createApp(store,()=>io?.emit('state:changed'),{gateways,ticketSecret:process.env.DELIVERY_TICKET_SECRET,secureCookies:process.env.SECURE_COOKIES==='true',origins:process.env.APP_ORIGINS?.split(',').map(v=>v.trim()),mode:process.env.APP_MODE||'training'});
app.use(express.static(path.join(root,'release'),{setHeaders:res=>res.setHeader('Cache-Control','no-cache')}));
app.get('/',(_,res)=>res.sendFile(path.join(root,'release','index.html')));
const server=createServer(app);io=new Server(server);
io.use((socket,next)=>{const session=app.locals.security.sessionFrom(socket.request);const user=state.users.find(u=>u.id===session?.userId);if(!user||user.role!=='citizen'&&!user.verified)return next(new Error('Sign in required'));next();});
const port=Number(process.env.PORT||4000);
server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log('RAKSHA GRID shared API: http://127.0.0.1:'+port+' ('+store.kind+')'));
async function shutdown(){io.close();server.close();await mongo?.close();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
