import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApp} from '../server/app.js';
import {makeSeed} from '../shared/domain.js';
test('API persists reports, rejects invalid changes and serializes assignments',async()=>{
 let state=makeSeed();let saves=0;let emits=0;
 const store={kind:'test',get:()=>state,save:async next=>{await new Promise(r=>setTimeout(r,5));state=next;saves++;}};
 const server=createServer(createApp(store,()=>emits++));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 async function req(url,method='GET',body){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
 try{
 assert.equal((await req('/api/health')).status,200);
 assert.equal((await req('/api/incidents','POST',{title:'x'})).status,400);
 const made=await req('/api/incidents','POST',{title:'Water near lane',description:'Water levels rising nearby.',location:'Sector 71',type:'Flood',lat:30.7046,lng:76.7179,people:8,immediateDanger:true});
 assert.equal(made.status,200);assert.equal(made.data.duplicateOf,'RG-1001');
 const assigned=await Promise.all([req('/api/incidents/'+made.data.id+'/assign','POST',{teamId:'T1'}),req('/api/incidents/RG-1005/assign','POST',{teamId:'T1'})]);
 assert.deepEqual(assigned.map(a=>a.status).sort(),[200,400]);
 assert.equal((await req('/api/incidents/'+made.data.id+'/status','PATCH',{status:'Resolved'})).status,400);
 assert.equal((await req('/api/incidents/'+made.data.id+'/status','PATCH',{status:'En route'})).status,200);
 assert.equal((await req('/api/incidents/'+made.data.id+'/status','PATCH',{status:'Resolved'})).status,200);
 assert.equal((await req('/api/state')).data.teams.find(t=>t.id==='T1').status,'Available');
 assert.equal(saves,4);assert.equal(emits,4);
 assert.equal((await req('/api/not-found')).status,404);
 }finally{await new Promise(r=>server.close(r));}
});
test('failed persistence does not change authoritative state',async()=>{
 const state=makeSeed();const server=createServer(createApp({kind:'test',get:()=>state,save:async()=>{throw new Error('Storage unavailable');}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/incidents/RG-1001/assign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({teamId:'T1'})});assert.equal(response.status,400);assert.equal(state.incidents[0].status,'New');assert.equal(state.teams[0].status,'Available');}finally{await new Promise(r=>server.close(r));}
});
