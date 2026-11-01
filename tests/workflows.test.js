import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {webcrypto} from 'node:crypto';
import {createApp} from '../server/app.js';
import {passwordHash} from '../server/security.js';
import {migrate} from '../server/workflows.js';
import {makeSeed} from '../shared/domain.js';
import {deliver} from '../shared/delivery.js';

const password='Test-password-123!';
const hash=passwordHash(password);
const report=(extra={})=>({clientRequestId:crypto.randomUUID(),type:'Flood',location:'School, second floor',lat:30.7046,lng:76.7179,people:4,immediateDanger:true,...extra});
async function fixture({failSave=false,...options}={}){
 let state=migrate(makeSeed()),writes=0,events=0;
 state.users=[['op','operator',null],['citizen','citizen',null],['other','citizen',null],['rescue','responder','T1'],['wrong','responder','T4']].map(([id,role,teamId])=>({id,name:id,email:id+'@test.local',role,teamId,verified:true,passwordHash:hash}));
 const store={kind:'test',get:()=>state,save:async next=>{if(failSave)throw new Error('disk full');await new Promise(r=>setTimeout(r,2));state=next;writes++;}};
 const app=createApp(store,()=>events++,options),server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const client=()=>{let cookie='',csrf='';return {async call(url,method='GET',body,headers={}){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',cookie,'X-CSRF-Token':csrf,...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const data=await response.json();if(data.csrf)csrf=data.csrf;return {status:response.status,data};},async login(id){return this.call('/api/auth/login','POST',{email:id+'@test.local',password});}};};
 return {client,state:()=>state,counts:()=>({writes,events}),close:()=>new Promise(r=>server.close(r)),app};
}
test('authentication, public registration and ownership prevent role escalation and data leaks',async()=>{
 const f=await fixture();try{const anon=f.client(),citizen=f.client(),op=f.client(),other=f.client();
 assert.equal((await anon.call('/api/state')).status,401);
 await citizen.login('citizen');await op.login('op');await other.login('other');
 assert.equal((await citizen.call('/api/users','POST',{})).status,403);
 assert.equal((await citizen.call('/api/incidents','POST',report({ownerId:'other'}))).status,403);
 assert.equal((await citizen.call('/api/incidents','POST',report(),{'X-CSRF-Token':''})).status,403);
 assert.equal((await citizen.call('/api/incidents','POST',report(),{Origin:'https://evil.test'})).status,403);
 const created=await citizen.call('/api/incidents','POST',report());assert.equal(created.status,200);const id=created.data.incidentId;
 assert.equal((await other.call(`/api/incidents/${id}/safe`,'POST',{})).status,403);
 assert.equal((await other.call('/api/state')).data.incidents.length,0);
 assert.equal((await citizen.call('/api/state')).data.incidents.length,1);
 assert.equal((await citizen.call('/api/state')).data.users.length,0);
 const registration=await anon.call('/api/auth/register','POST',{name:'New',email:'new@test.local',password,role:'operator',verified:true});assert.equal(registration.data.user.role,'citizen');
 assert.ok(!(await op.call('/api/state')).data.users.some(u=>u.passwordHash));
 }finally{await f.close();}
});
test('concurrent retries persist exactly one SOS and return verifiable HQ receipts',async()=>{
 const f=await fixture();try{const c=f.client();await c.login('citizen');const data=report();const before=f.state().incidents.length;
 const responses=await Promise.all(Array.from({length:6},()=>c.call('/api/incidents','POST',data)));
 assert.ok(responses.every(r=>r.status===200));assert.equal(new Set(responses.map(r=>r.data.incidentId)).size,1);assert.equal(f.state().incidents.length,before+1);
 const receipt=responses[0].data.receipt,jwk=(await c.call('/api/config')).data.receiptPublicKey;
 const key=await webcrypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 assert.equal(await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,Buffer.from(receipt.signature,'base64url'),Buffer.from(receipt.encoded)),true);
 assert.equal(JSON.parse(Buffer.from(receipt.encoded,'base64url')).ownerId,'citizen');
 assert.equal((await c.call('/api/receipts/'+data.clientRequestId)).data.receipt.payload.incidentId,receipt.payload.incidentId);
 assert.equal((await c.call('/api/incidents','POST',{...data,title:'Changed on retry'})).data.incidentId,receipt.payload.incidentId);
 assert.notEqual(f.state().incidents[0].title,'Changed on retry');
 }finally{await f.close();}
});
test('failed persistence gives no receipt, emits no HQ event and rolls back state',async()=>{
 const f=await fixture({failSave:true});try{const c=f.client();await c.login('citizen');const before=f.state().incidents.length;const r=await c.call('/api/incidents','POST',report());assert.equal(r.status,503);assert.equal(r.data.receipt,undefined);assert.equal(f.state().incidents.length,before);assert.deepEqual(f.counts(),{writes:0,events:0});assert.equal((await c.call('/api/health')).data.ok,false);}finally{await f.close();}
});
test('connected lifecycle: acknowledge, verify, assign, accept, progress, backup, notes, handover',async()=>{
 const f=await fixture();try{const c=f.client(),op=f.client(),r=f.client(),wrong=f.client();await c.login('citizen');await op.login('op');await r.login('rescue');await wrong.login('wrong');const id=(await c.call('/api/incidents','POST',report())).data.incidentId;
 const action=(client,name,body={})=>client.call(`/api/incidents/${id}/${name}`,'POST',body);
 assert.equal((await action(c,'acknowledge')).status,403);assert.equal((await action(op,'acknowledge')).status,200);assert.equal((await action(op,'verify')).status,200);
 assert.equal((await action(op,'priority',{priority:'High',reason:'Verified lower immediate risk'})).status,200);
 const assignments=await Promise.all([action(op,'assign',{teamId:'T1'}),op.call('/api/incidents/RG-1005/assign','POST',{teamId:'T1'})]);assert.deepEqual(assignments.map(r=>r.status).sort(),[200,409]);
 assert.equal((await action(wrong,'status',{status:'Accepted'})).status,403);
 assert.equal((await action(r,'status',{status:'Resolved'})).status,409);
 assert.equal((await action(r,'backup',{text:'Boat and two responders required'})).status,200);
 assert.equal((await action(r,'note',{text:'Evacuation point established'})).status,200);
 for(const status of ['Accepted','En route','Arrived','Assistance underway','Resolved'])assert.equal((await action(r,'status',{status,handover:'Four rescued; handed over at shelter A.'})).status,200);
 assert.equal(f.state().teams.find(t=>t.id==='T1').status,'Available');
 assert.equal((await c.call('/api/state')).data.incidents[0].status,'Resolved');assert.equal((await c.call('/api/state')).data.incidents[0].notes,undefined);
 }finally{await f.close();}
});
test('decline, cancel and safe are visible to HQ and release assignments/resources',async()=>{
 const f=await fixture();try{const c=f.client(),op=f.client(),r=f.client();await c.login('citizen');await op.login('op');await r.login('rescue');const data=report(),id=(await c.call('/api/incidents','POST',data)).data.incidentId;
 await op.call(`/api/incidents/${id}/assign`,'POST',{teamId:'T1'});
 assert.equal((await r.call(`/api/incidents/${id}/decline`,'POST',{reason:'Boat unavailable'})).status,200);
 assert.equal(f.state().incidents[0].status,'New');await op.call(`/api/incidents/${id}/assign`,'POST',{teamId:'T1'});
 const resource=(await op.call('/api/inventory','POST',{name:'Boat 01'})).data;await op.call('/api/inventory/'+resource.id,'PATCH',{incidentId:id});
 assert.equal((await c.call(`/api/requests/${data.clientRequestId}/safe`,'POST',{})).status,200);
 assert.equal(f.state().teams[0].status,'Available');assert.equal(f.state().inventory[0].status,'Available');
 assert.equal((await c.call(`/api/requests/${data.clientRequestId}/safe`,'POST',{})).status,200);
 }finally{await f.close();}
});
test('media is separate from intake, role protected and idempotent; location is opt in',async()=>{
 const f=await fixture();try{const c=f.client(),o=f.client(),r=f.client();await c.login('citizen');await o.login('other');await r.login('rescue');const id=(await c.call('/api/incidents','POST',report({lat:null,lng:null,people:null}))).data.incidentId;
 const url=`/api/incidents/${id}/media/${crypto.randomUUID()}`,media={name:'message.webm',mime:'audio/webm',data:'YWJj'};
 assert.equal((await o.call(url,'PUT',media)).status,403);assert.equal((await c.call(url,'PUT',media)).status,200);assert.equal((await c.call(url,'PUT',media)).status,200);assert.equal(f.state().incidents[0].media.length,1);
 assert.equal((await r.call('/api/team','PATCH',{lat:30,lng:76})).status,400);
 await r.call('/api/team','PATCH',{locationSharing:true});assert.equal((await r.call('/api/team','PATCH',{lat:30,lng:76})).status,200);
 await r.call('/api/team','PATCH',{locationSharing:false});assert.equal(f.state().teams[0].liveLocation,undefined);
 }finally{await f.close();}
});
test('broadcasts, provisioning and grouping are restricted and audited',async()=>{
 const f=await fixture();try{const op=f.client(),c=f.client();await op.login('op');await c.login('citizen');assert.equal((await c.call('/api/alerts','POST',{})).status,403);
 await op.call('/api/alerts','POST',{title:'Flood warning',text:'Avoid the underpass',area:'Sector 71'});assert.equal((await c.call('/api/state')).data.alerts[0].verified,true);
 assert.equal((await op.call('/api/users','POST',{name:'Verified field team',email:'field@test.local',password,teamId:'T5'})).status,200);
 await op.call('/api/incidents/RG-1001/group','POST',{targetId:'RG-1005'});assert.equal(f.state().incidents.find(i=>i.id==='RG-1001').groupId,f.state().incidents.find(i=>i.id==='RG-1005').groupId);
 assert.equal((await op.call('/api/incidents/RG-1001/escalate','POST',{text:'Additional boats required'})).status,200);
 assert.ok(f.state().activity.some(a=>a.actor==='op'&&a.action.includes('Escalated')));
 }finally{await f.close();}
});
test('gateway requires both a scoped ticket and gateway key and shares deduplication',async()=>{
 const f=await fixture({gateways:{rf:{url:'http://gateway.test/send',key:'test-gateway-secret'}}});try{const c=f.client(),gateway=f.client();const session=(await c.login('citizen')).data,reportData=report();const body={transport:'rf',ticket:session.ticket,report:reportData};
 assert.equal((await gateway.call('/api/gateway/ingest','POST',body)).status,401);
 assert.equal((await gateway.call('/api/gateway/ingest','POST',{...body,ticket:'bad'},{'X-Gateway-Key':'test-gateway-secret'})).status,401);
 const viaGateway=await gateway.call('/api/gateway/ingest','POST',body,{'X-Gateway-Key':'test-gateway-secret'});assert.equal(viaGateway.status,200);assert.equal(viaGateway.data.receipt.payload.transport,'rf');
 const internet=await c.call('/api/incidents','POST',reportData);assert.equal(internet.data.incidentId,viaGateway.data.incidentId);
 }finally{await f.close();}
});
test('existing Raksha Field APK pairs securely and shares idempotent SOS/status with HQ',async()=>{
 const f=await fixture();try{const op=f.client(),field=f.client();await op.login('op');const connection=(await op.call('/api/hq/connection')).data;assert.ok(connection.pairing.code);const installationId=crypto.randomUUID(),body={code:connection.pairing.code,name:'Test field phone',installationId};
 assert.equal((await field.call('/api/field/pair','POST',{...body,code:'invalid-code-000'})).status,401);
 const paired=await field.call('/api/field/pair','POST',body);assert.equal(paired.status,200);const deviceClient=f.client(),data={requestId:crypto.randomUUID(),type:'Flood',message:'Water rising near the village shelter.',location:'Community school, upper floor',coordinates:{lat:30.7046,lng:76.7179,accuracy:12}};
 const send=(client,payload)=>client.call('/api/field/alerts','POST',payload,{Authorization:'Bearer '+paired.data.token});
 const first=await send(deviceClient,data),retry=await send(deviceClient,data);assert.equal(first.status,200);assert.equal(first.data.id,retry.data.id);assert.equal(first.data.status,'Received');assert.equal(f.state().incidents.filter(i=>i.ownerId==='field:'+paired.data.id).length,1);
 const listed=await deviceClient.call('/api/field/alerts','GET',undefined,{Authorization:'Bearer '+paired.data.token});assert.equal(listed.data.alerts[0].requestId,data.requestId);const incident=first.data.id;
 await op.call('/api/incidents/'+incident+'/acknowledge','POST',{});const afterAck=await deviceClient.call('/api/field/alerts','GET',undefined,{Authorization:'Bearer '+paired.data.token});assert.equal(afterAck.data.alerts[0].status,'Acknowledged');
 assert.equal((await op.call('/api/incidents/'+incident+'/assign','POST',{teamId:'T1'})).status,200);const afterAssign=await deviceClient.call('/api/field/alerts','GET',undefined,{Authorization:'Bearer '+paired.data.token});assert.equal(afterAssign.data.alerts[0].status,'Responding');
 await op.call('/api/hq/devices/'+paired.data.id+'/revoke','POST',{});assert.equal((await deviceClient.call('/api/field/alerts','GET',undefined,{Authorization:'Bearer '+paired.data.token})).status,401);
 assert.ok((await op.call('/api/state')).data.incidents.some(i=>i.id===incident));
 }finally{await f.close();}
});
test('fallback order, forged receipts and simulation never falsely confirm delivery',async()=>{
 const config={transports:['internet','local','rf','satellite'].map(name=>({name,mode:'configured',url:'https://'+name+'.test'}))};let calls=[];
 const pending=await deliver({report:report(),ownerId:'citizen',config,send:async(url,body,name)=>{calls.push(name);return {receipt:{fake:true}};},verify:async()=>false});assert.deepEqual(calls,['internet','local','rf','satellite']);assert.equal(pending.receipt,null);
 calls=[];const result=await deliver({report:report(),ownerId:'citizen',config,send:async(url,body,name)=>{calls.push(name);if(name!=='rf')throw new Error('offline');return {receipt:{valid:true}};},verify:async r=>r.valid});assert.deepEqual(calls,['internet','local','rf']);assert.ok(result.receipt.valid);
 const simulation=await deliver({report:report(),config:{transports:[]},send:async()=>{throw new Error('offline');},verify:async()=>true});assert.equal(simulation.receipt,null);assert.equal(simulation.attempts.length,4);assert.ok(simulation.attempts[2].status.includes('Simulation'));
});
