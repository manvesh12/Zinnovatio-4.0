import {makeSeed,createIncident,assignTeam,advanceIncident,addIncidentNote} from '../shared/domain.js';
import {io} from 'socket.io-client';
export const localDemo=!import.meta.env.DEV&&!import.meta.env.VITE_API_URL;
const base=import.meta.env.VITE_API_URL||'';
const key='raksha-grid-v1';
let listeners=new Set(), memory=null;
function readLocal(){
 try{const raw=localStorage.getItem(key);if(raw){const s=JSON.parse(raw);if(s.schemaVersion===1&&Array.isArray(s.incidents)&&Array.isArray(s.teams)&&Array.isArray(s.activity))return s;}}
 catch{}
 return memory||makeSeed();
}
function saveLocal(s){memory=s;localStorage.setItem(key,JSON.stringify(s));listeners.forEach(f=>f());}
async function request(url,method='GET',data){
 const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const result=await r.json();if(!r.ok)throw new Error(result.error||'Request failed.');return result;
}
export const data={
 get:async()=>localDemo?readLocal():request('/api/state'),
 report:async form=>{if(!localDemo)return request('/api/incidents','POST',form);const s=readLocal();const i=createIncident(s,form);saveLocal(s);return i;},
 assign:async(id,teamId)=>{if(!localDemo)return request('/api/incidents/'+id+'/assign','POST',{teamId});const s=readLocal();assignTeam(s,id,teamId);saveLocal(s);},
 advance:async(id,status)=>{if(!localDemo)return request('/api/incidents/'+id+'/status','PATCH',{status});const s=readLocal();advanceIncident(s,id,status);saveLocal(s);},
 note:async(id,text)=>{if(!localDemo)return request('/api/incidents/'+id+'/notes','POST',{text});const s=readLocal();addIncidentNote(s,id,text);saveLocal(s);},
 reset:async()=>{if(!localDemo)return request('/api/reset','POST',{});saveLocal(makeSeed());},
 subscribe:callback=>{
  listeners.add(callback);
  if(localDemo){const handler=e=>{if(e.key===key)callback();};window.addEventListener('storage',handler);return()=>{listeners.delete(callback);window.removeEventListener('storage',handler);};}
  const socket=io(base||window.location.origin);socket.on('state:changed',callback);socket.on('connect',callback);return()=>{listeners.delete(callback);socket.disconnect();};
 }
};
