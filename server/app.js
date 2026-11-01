import express from 'express';
import {timingSafeEqual,createHash,randomBytes} from 'node:crypto';
import {createSecurity,fail,passwordHash,passwordMatches,publicUser} from './security.js';
import {migrate,view,createSOS,act,getIncident,audit,text,coords,CATEGORIES,CLOSED} from './workflows.js';

export function createApp(store,onChange=()=>{},options={}) {
 const app=express(),security=createSecurity(options);app.locals.security=security;
 app.disable('x-powered-by');app.use(express.json({limit:'3mb'}));
 app.use((req,res,next)=>{
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin){
   const allowed=options.origins||['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:4000','http://localhost:4000'];
   if(!allowed.includes(req.headers.origin))return res.status(403).json({error:'Origin not allowed.'});
  }next();
 });
 let queue=Promise.resolve(),lastSaved=null,lastError=null,pairing={code:randomBytes(8).toString('hex'),expires:Date.now()+15*60_000},pairAttempts=new Map();
 const liveStreams=new Map();
 const closeLive=session=>{session.state='ended';session.endedAt=new Date().toISOString();session.frame=null;session.audio=[];};
 const transports=['internet','local','rf','satellite'].map(name=>({name,mode:name==='internet'?'configured':options.gateways?.[name]?.url&&options.gateways?.[name]?.key?'configured':'simulation',url:options.gateways?.[name]?.url||null}));
 function mutate(res,operation){
  const task=queue.then(async()=>{const next=migrate(structuredClone(store.get()));const result=await operation(next);try{await store.save(next);lastSaved=new Date().toISOString();lastError=null;}catch{lastError='Storage write failed';throw fail('Storage unavailable. Delivery is not confirmed. Retry with the same request ID.',503);}onChange();res.json(typeof result==='function'?result():result);});
  queue=task.catch(error=>{if(!res.headersSent)res.status(error.status||400).json({error:error.message});});
 }
 function auth(req,res,next){
  const session=security.sessionFrom(req),user=store.get().users?.find(u=>u.id===session?.userId);
  if(!user)return res.status(401).json({error:'Sign in to continue.'});
  if(user.role!=='citizen'&&!user.verified)return res.status(403).json({error:'Your operational account needs verification.'});
  if(!['GET','HEAD'].includes(req.method)&&req.headers['x-csrf-token']!==session.csrf)return res.status(403).json({error:'Session protection failed. Sign in again.'});
  req.user=user;req.session=session;next();
 }
 function operator(req,res,next){if(req.user.role!=='operator')return res.status(403).json({error:'Operator access required.'});next();}
 const hashToken=value=>createHash('sha256').update(String(value)).digest('hex');
 const sameHash=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);};
 function fieldDevice(req,res,next){const token=/^Bearer (\S+)$/.exec(req.headers.authorization||'')?.[1],device=store.get().devices?.find(d=>!d.revoked&&sameHash(d.tokenHash,hashToken(token)));if(!token||!device)return res.status(401).json({error:'Pair this phone with headquarters again.'});req.fieldDevice=device;next();}
 const pairedStatuses=i=>{const output=[];for(const h of i.history||[]){const s=h.status==='HQ received'?'Received':h.status==='Acknowledged'?'Acknowledged':['Assigned','Accepted','En route','Arrived','Assistance underway'].includes(h.status)?'Responding':['Resolved','Safe','Cancelled'].includes(h.status)?'Resolved':null;if(s&&output.at(-1)?.status!==s)output.push({status:s,at:h.at});}return output;};
 const fieldAlert=i=>({id:i.id,requestId:i.clientRequestId,type:i.type==='Other'&&i.title==='SOS assistance requested'?'SOS':i.type,message:i.description,location:i.location,coordinates:i.lat==null?null:{lat:i.lat,lng:i.lng},createdAt:i.createdAt,updatedAt:i.updatedAt,status:pairedStatuses(i).at(-1)?.status||'Received',updates:pairedStatuses(i).slice(1)});
 app.get('/api/health',(_,res)=>res.json({ok:!lastError,service:'Raksha-Grid',storage:store.kind,lastSaved,lastError,mode:options.mode||'training',transports}));
 app.post('/api/auth/register',(req,res)=>{
  try{security.throttle('register:'+req.ip);const email=text(req.body.email,200,true).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail('Enter a valid email.');const hash=passwordHash(req.body.password);
   mutate(res,s=>{if(s.users.some(u=>u.email===email))throw fail('Email is already registered.',409);const user={id:crypto.randomUUID(),name:text(req.body.name,80,true),email,passwordHash:hash,role:'citizen',verified:true,phone:'',language:'en'};s.users.push(user);audit(s,user,'Citizen account created');return ()=>security.login(req,res,user);});
  }catch(e){res.status(e.status||400).json({error:e.message});}
 });
 app.post('/api/auth/login',(req,res)=>{
  try{security.throttle('login:'+req.ip);const user=store.get().users?.find(u=>u.email===String(req.body.email||'').toLowerCase());if(!user||!passwordMatches(req.body.password,user.passwordHash))throw fail('Email or password is incorrect.',401);if(user.role!=='citizen'&&!user.verified)throw fail('An operator must verify this account.',403);res.json(security.login(req,res,user));}catch(e){res.status(e.status||400).json({error:e.message});}
 });
 app.post('/api/gateway/ingest',(req,res)=>{
  try{const transport=req.body.transport,configured=options.gateways?.[transport],key=req.headers['x-gateway-key'];
   if(!['local','rf','satellite'].includes(transport)||!configured?.key||typeof key!=='string'||Buffer.byteLength(key)!==Buffer.byteLength(configured.key)||!timingSafeEqual(Buffer.from(key),Buffer.from(configured.key)))throw fail('Gateway authentication failed.',401);
   const ticket=security.readTicket(req.body.ticket),user=store.get().users?.find(u=>u.id===ticket.userId);
   if(!user||user.role!=='citizen'&&!user.verified)throw fail('Reporter is not authorized.',403);
   mutate(res,s=>{const incident=createSOS(s,user,req.body.report||{});return ()=>({receipt:security.receipt(incident,transport),incidentId:incident.id});});
  }catch(e){res.status(e.status||400).json({error:e.message});}
 });
 // Backward-compatible endpoints used by the existing Raksha Field Android APK.
 app.post('/api/field/pair',(req,res)=>{
  try{
   const key=req.ip||'unknown',stamp=Date.now(),bucket=pairAttempts.get(key)||{start:stamp,count:0};if(stamp-bucket.start>60_000){bucket.start=stamp;bucket.count=0;}if(++bucket.count>20)throw fail('Too many pairing attempts. Wait one minute.',429);pairAttempts.set(key,bucket);
   if(stamp>pairing.expires||typeof req.body.code!=='string'||!sameHash(req.body.code,pairing.code))throw fail('Pairing code is invalid or expired. Ask headquarters for a new code.',401);
   const name=text(req.body.name,60,true),installationId=text(req.body.installationId,80,true);if(installationId.length<16)throw fail('Invalid installation ID.');const token=randomBytes(32).toString('hex');
   mutate(res,s=>{let device=s.devices.find(d=>d.installationId===installationId);if(!device){if(s.devices.filter(d=>!d.revoked).length>=100)throw fail('Device limit reached. Revoke an old device first.',409);device={id:crypto.randomUUID(),installationId,name,createdAt:new Date().toISOString(),revoked:false};s.devices.push(device);}device.name=name;device.tokenHash=hashToken(token);device.revoked=false;device.pairedAt=new Date().toISOString();audit(s,{id:'device:'+device.id,name},'Raksha Field APK paired');return {id:device.id,name,token};});
  }catch(e){res.status(e.status||400).json({error:e.message});}
 });
 app.post('/api/field/alerts',fieldDevice,(req,res)=>{
  try{const requestId=text(req.body.requestId,80,true);if(!/^[\w-]+$/.test(requestId)||requestId.length<16)throw fail('Invalid request ID.');const types=['SOS','Medical','Fire','Flood','Trapped','Other'];if(!types.includes(req.body.type))throw fail('Choose a valid alert type.');const message=text(req.body.message,1000,true),location=text(req.body.location,200,true);let coordinates=null;if(req.body.coordinates!=null)coordinates=coords(req.body.coordinates);
   mutate(res,s=>{const device=s.devices.find(d=>d.id===req.fieldDevice.id&&!d.revoked);if(!device)throw fail('Device access was revoked.',401);const owner={id:'field:'+device.id,name:device.name,role:'citizen',verified:true};const report=createSOS(s,owner,{clientRequestId:requestId,type:req.body.type==='SOS'?'Other':req.body.type,title:req.body.type==='SOS'?'SOS assistance requested':req.body.type+' assistance requested',description:message,location,people:null,immediateDanger:req.body.type==='SOS',lat:coordinates?.lat??null,lng:coordinates?.lng??null});if(!report.reporterName){report.reporterName=device.name;report.updatedAt=report.createdAt;}return fieldAlert(report);});
  }catch(e){res.status(e.status||400).json({error:e.message});}
 });
 app.get('/api/field/alerts',fieldDevice,(req,res)=>{const owner='field:'+req.fieldDevice.id;res.json({alerts:store.get().incidents.filter(i=>i.ownerId===owner).slice(0,100).map(fieldAlert)});});
 app.get('/api/field/live/requests',fieldDevice,(req,res)=>{const requests=[];for(const session of liveStreams.values()){if(session.deviceId!==req.fieldDevice.id)continue;if(session.state==='waiting'&&Date.now()>session.approvalExpiresAt)session.state='expired';if(['waiting','active','ended','declined','expired'].includes(session.state))requests.push({sessionId:session.id,incidentId:session.incidentId,state:session.state,requestedAt:session.requestedAt});}res.json({requests});});
 app.post('/api/field/live/accept',fieldDevice,(req,res)=>{const session=liveStreams.get(String(req.body.sessionId||''));if(!session||session.deviceId!==req.fieldDevice.id||session.incidentId!==req.body.incidentId)return res.status(404).json({error:'Live request not found.'});if(session.state!=='waiting'||Date.now()>session.approvalExpiresAt)return res.status(409).json({error:'Live request is no longer waiting.'});if(req.body.accepted!==true){session.state='declined';session.endedAt=new Date().toISOString();return res.json({ok:true,state:session.state});}const incident=store.get().incidents.find(i=>i.id===session.incidentId);if(!incident||CLOSED.includes(incident.status)){session.state='expired';session.endedAt=new Date().toISOString();return res.status(409).json({error:'This SOS is closed. Live view cannot start.'});}session.state='active';session.startedAt=new Date().toISOString();session.expiresAt=Date.now()+5*60_000;res.json({ok:true,state:session.state});});
 app.post('/api/field/live/frame',fieldDevice,(req,res)=>{const session=liveStreams.get(String(req.body.sessionId||''));if(!session||session.deviceId!==req.fieldDevice.id||session.state!=='active')return res.status(404).json({error:'Live session is not active.'});const incident=store.get().incidents.find(i=>i.id===session.incidentId);if(!incident||CLOSED.includes(incident.status)){closeLive(session);return res.status(410).json({error:'The SOS is closed.'});}const frame=req.body.frame;if(typeof frame!=='string'||frame.length>350000||!/^[A-Za-z0-9+/]*={0,2}$/.test(frame))return res.status(400).json({error:'Invalid camera frame.'});if(Date.now()>session.expiresAt){closeLive(session);return res.status(410).json({error:'Live session expired.'});}session.frame={seq:++session.frameSeq,data:frame,at:Date.now()};res.json({ok:true,seq:session.frameSeq});});
 app.post('/api/field/live/audio',fieldDevice,(req,res)=>{const session=liveStreams.get(String(req.body.sessionId||''));if(!session||session.deviceId!==req.fieldDevice.id||session.state!=='active')return res.status(404).json({error:'Live session is not active.'});const incident=store.get().incidents.find(i=>i.id===session.incidentId);if(!incident||CLOSED.includes(incident.status)){closeLive(session);return res.status(410).json({error:'The SOS is closed.'});}const chunk=req.body.chunk;if(typeof chunk!=='string'||chunk.length>30000||!/^[A-Za-z0-9+/]*={0,2}$/.test(chunk))return res.status(400).json({error:'Invalid microphone chunk.'});if(Date.now()>session.expiresAt){closeLive(session);return res.status(410).json({error:'Live session expired.'});}session.audioSeq++;session.audio.push({seq:session.audioSeq,data:chunk,at:Date.now()});if(session.audio.length>40)session.audio.splice(0,session.audio.length-40);res.json({ok:true,seq:session.audioSeq});});
 app.post('/api/field/live/stop',fieldDevice,(req,res)=>{const session=liveStreams.get(String(req.body.sessionId||''));if(!session||session.deviceId!==req.fieldDevice.id)return res.status(404).json({error:'Live session not found.'});session.state='ended';session.endedAt=new Date().toISOString();session.frame=null;session.audio=[];res.json({ok:true,state:'ended'});});
 app.use('/api',auth);
 app.get('/api/auth/me',(req,res)=>res.json({user:publicUser(req.user),csrf:req.session.csrf,ticket:security.issueTicket(req.user)}));
 app.post('/api/auth/logout',(req,res)=>{security.logout(req,res);res.json({ok:true});});
 app.get('/api/config',(req,res)=>res.json({transports,receiptPublicKey:security.publicKey,mode:options.mode||'training'}));
 app.get('/api/hq/connection',operator,(req,res)=>res.json({pairing:Date.now()<pairing.expires?{code:pairing.code,expiresAt:new Date(pairing.expires).toISOString()}:null,devices:store.get().devices.map(({id,name,createdAt,pairedAt,revoked})=>({id,name,createdAt,pairedAt,revoked:!!revoked}))}));
 app.post('/api/hq/pairing',operator,(req,res)=>{pairing={code:randomBytes(8).toString('hex'),expires:Date.now()+15*60_000};res.json({code:pairing.code,expiresAt:new Date(pairing.expires).toISOString()});});
 app.post('/api/hq/devices/:id/revoke',operator,(req,res)=>mutate(res,s=>{const device=s.devices.find(d=>d.id===req.params.id);if(!device)throw fail('Device not found.',404);device.revoked=true;audit(s,req.user,'Raksha Field device revoked: '+device.name);return {id:device.id,revoked:true};}));
 app.get('/api/state',(req,res)=>res.json(view(migrate(structuredClone(store.get())),req.user)));
 app.patch('/api/profile',(req,res)=>mutate(res,s=>{const user=s.users.find(u=>u.id===req.user.id);user.name=text(req.body.name,80,true);user.phone=text(req.body.phone,40);user.language=req.body.language==='hi'?'hi':'en';return publicUser(user);}));
 app.post('/api/incidents',(req,res)=>mutate(res,s=>{const incident=createSOS(s,req.user,req.body);return ()=>({incidentId:incident.id,receipt:security.receipt(incident,'internet')});}));
 app.get('/api/receipts/:requestId',(req,res)=>{const i=store.get().incidents.find(i=>i.ownerId===req.user.id&&i.clientRequestId===req.params.requestId);if(!i)return res.status(404).json({error:'No HQ receipt yet.'});res.json({receipt:security.receipt(i,'internet')});});
 app.post('/api/incidents/:id/live/request',operator,(req,res)=>mutate(res,s=>{
  const incident=s.incidents.find(i=>i.id===req.params.id);if(!incident)throw fail('Incident not found.',404);
  if(!incident.ownerId?.startsWith('field:'))throw fail('Live view is available only for a paired Raksha Field SOS.',409);
  if(CLOSED.includes(incident.status))throw fail('This SOS is closed.',409);
  const deviceId=incident.ownerId.slice(6),existing=[...liveStreams.values()].find(v=>v.deviceId===deviceId&&['waiting','active'].includes(v.state));
  if(existing&&existing.incidentId!==incident.id)throw fail('This phone already has a live-view request. Stop that session first.',409);
  let session=existing;if(!session){session={id:crypto.randomUUID(),incidentId:incident.id,deviceId,state:'waiting',requestedAt:new Date().toISOString(),approvalExpiresAt:Date.now()+60_000,expiresAt:0,frame:null,frameSeq:0,audioSeq:0,audio:[]};liveStreams.set(session.id,session);}
  audit(s,req.user,'Live camera/microphone view requested; waiting for phone approval',incident.id);return {sessionId:session.id,incidentId:incident.id,state:session.state,requestedAt:session.requestedAt};
 }));
 app.get('/api/incidents/:id/live',operator,(req,res)=>{
  const incident=store.get().incidents.find(i=>i.id===req.params.id);if(!incident)return res.status(404).json({error:'Incident not found.'});
  let session=[...liveStreams.values()].find(v=>v.incidentId===incident.id);
  if(!session)return res.json({state:'idle'});
  if(session.state==='waiting'&&Date.now()>session.approvalExpiresAt)session.state='expired';
  if(session.state==='active'&&(Date.now()>session.expiresAt||CLOSED.includes(incident.status)))closeLive(session);
  const afterFrame=Number(req.query.afterFrame||0),afterAudio=Number(req.query.afterAudio||0);
  const frame=session.state==='active'&&session.frame&&session.frame.seq>afterFrame?session.frame:null;
  const audio=session.state==='active'?session.audio.filter(c=>c.seq>afterAudio).slice(-12):[];
  res.json({sessionId:session.id,incidentId:session.incidentId,state:session.state,requestedAt:session.requestedAt,startedAt:session.startedAt||null,frame,audio,audioSeq:session.audioSeq,endedAt:session.endedAt||null});
 });
 app.post('/api/incidents/:id/live/stop',operator,(req,res)=>mutate(res,s=>{
  const incident=s.incidents.find(i=>i.id===req.params.id);if(!incident)throw fail('Incident not found.',404);
  const session=[...liveStreams.values()].find(v=>v.incidentId===incident.id);if(!session)return {ok:true,state:'idle'};
  session.state='ended';session.endedAt=new Date().toISOString();session.frame=null;session.audio=[];audit(s,req.user,'Live camera/microphone view stopped by operator',incident.id);return {ok:true,state:'ended'};
 }));
 app.post('/api/incidents/:id/:action',(req,res)=>mutate(res,s=>{act(s,req.user,req.params.id,req.params.action,req.body);return {ok:true};}));
 app.post('/api/requests/:requestId/:action',(req,res)=>mutate(res,s=>{if(!['safe','cancel'].includes(req.params.action))throw fail('Invalid action.');const incident=s.incidents.find(i=>i.ownerId===req.user.id&&i.clientRequestId===req.params.requestId);if(!incident)throw fail('SOS has not reached HQ yet.',404);act(s,req.user,incident.id,req.params.action,{});return {ok:true};}));
 app.patch('/api/incidents/:id/status',(req,res)=>mutate(res,s=>{act(s,req.user,req.params.id,'status',req.body);return {ok:true};}));
 app.put('/api/incidents/:id/media/:mediaId',(req,res)=>mutate(res,s=>{
  const i=getIncident(s,req.user,req.params.id);if(i.ownerId!==req.user.id)throw fail('Only the reporter can attach media.',403);
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(req.params.mediaId))throw fail('Invalid attachment ID.');if(i.media.some(m=>m.id===req.params.mediaId))return {ok:true};if(i.media.length>=3)throw fail('Maximum three attachments per incident.');
  const {mime,data}=req.body;if(!['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mpeg','audio/mp4'].includes(mime)||typeof data!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(data)||data.length>2800000)throw fail('Use an image or audio file up to 2 MB.');
  i.media.push({id:req.params.mediaId,name:text(req.body.name,100,true),mime,data});audit(s,req.user,'Attachment received',i.id);return {ok:true};
 }));
 app.get('/api/incidents/:id/media/:mediaId',(req,res,next)=>{try{const i=getIncident(store.get(),req.user,req.params.id),m=i.media.find(m=>m.id===req.params.mediaId);if(!m)throw fail('Attachment not found.',404);res.set({'Content-Type':m.mime,'Content-Disposition':'attachment; filename="attachment"','Content-Security-Policy':"default-src 'none'"}).send(Buffer.from(m.data,'base64'));}catch(e){next(e);}});
 app.patch('/api/team',(req,res)=>mutate(res,s=>{
  if(req.user.role!=='responder')throw fail('Responder access required.',403);const t=s.teams.find(t=>t.id===req.user.teamId);if(!t)throw fail('No team assigned.');
  if(req.body.status){if(t.incidentId)throw fail('Complete or decline the assignment first.',409);if(!['Available','Busy','Off duty'].includes(req.body.status))throw fail('Invalid availability.');t.status=req.body.status;}
  if(typeof req.body.locationSharing==='boolean'){t.locationSharing=req.body.locationSharing;if(!t.locationSharing)delete t.liveLocation;}
  if(t.status==='Off duty'){t.locationSharing=false;delete t.liveLocation;}
  if(req.body.lat!=null){if(!t.locationSharing||t.status==='Off duty')throw fail('Enable on-duty location sharing first.');t.liveLocation={...coords(req.body),at:new Date().toISOString()};}
  audit(s,req.user,'Team availability/location updated');return t;
 }));
 app.post('/api/users',operator,(req,res)=>mutate(res,s=>{
  const email=text(req.body.email,200,true).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail('Invalid email.');if(s.users.some(u=>u.email===email))throw fail('Email exists.',409);
  const team=s.teams.find(t=>t.id===req.body.teamId);if(!team)throw fail('Choose a team.');const user={id:crypto.randomUUID(),name:text(req.body.name,80,true),email,passwordHash:passwordHash(req.body.password),role:'responder',verified:true,teamId:team.id};s.users.push(user);audit(s,req.user,'Verified responder provisioned: '+user.name);return publicUser(user);
 }));
 app.post('/api/teams',operator,(req,res)=>mutate(res,s=>{const capabilities=req.body.capabilities;if(!Array.isArray(capabilities)||!capabilities.length||capabilities.some(c=>!CATEGORIES.includes(c)))throw fail('Select valid capabilities.');const team={id:'T-'+crypto.randomUUID().slice(0,8),name:text(req.body.name,80,true),capabilities,status:'Available',incidentId:null,members:1,...coords(req.body),locationSharing:false};s.teams.push(team);audit(s,req.user,'Team created: '+team.name);return team;}));
 app.post('/api/alerts',operator,(req,res)=>mutate(res,s=>{const alert={id:crypto.randomUUID(),title:text(req.body.title,100,true),text:text(req.body.text,1000,true),area:text(req.body.area,120,true),verified:true,by:req.user.name,at:new Date().toISOString()};s.alerts.unshift(alert);audit(s,req.user,'Verified broadcast published: '+alert.title);return alert;}));
 app.post('/api/inventory',operator,(req,res)=>mutate(res,s=>{const item={id:crypto.randomUUID(),name:text(req.body.name,100,true),status:'Available',incidentId:null};s.inventory.push(item);audit(s,req.user,'Inventory added: '+item.name);return item;}));
 app.patch('/api/inventory/:id',operator,(req,res)=>mutate(res,s=>{const item=s.inventory.find(v=>v.id===req.params.id);if(!item)throw fail('Resource not found.',404);if(req.body.incidentId){const i=s.incidents.find(i=>i.id===req.body.incidentId);if(!i||CLOSED.includes(i.status))throw fail('Select an active incident.');if(item.incidentId&&item.incidentId!==i.id)throw fail('Resource already allocated.',409);item.incidentId=i.id;item.status='Allocated';}else{item.incidentId=null;item.status='Available';}audit(s,req.user,'Resource allocation updated: '+item.name,item.incidentId);return item;}));
 app.use('/api',(_,res)=>res.status(404).json({error:'API endpoint not found.'}));
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(err.status||500).json({error:err.status?err.message:'Request failed.'});});
 return app;
}
