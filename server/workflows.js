import {assessPriority,distanceMeters,findDuplicate} from '../shared/domain.js';
import {fail,publicUser} from './security.js';

export const CATEGORIES=['Medical','Fire','Flood','Trapped','Road blockage','Other'];
export const CLOSED=['Resolved','Safe','Cancelled'];
export const now=()=>new Date().toISOString();
export function migrate(state) {
 state.schemaVersion=2;state.users||=[];state.alerts||=[];state.inventory||=[];state.activity||=[];state.devices||=[];
 for(const i of state.incidents){i.notes||=[];i.history||=[{status:i.status,at:i.updatedAt}];i.media||=[];i.receivedAt||=i.createdAt;i.verified??=false;}
 for(const t of state.teams){t.locationSharing??=false;}
 return state;
}
export function audit(state,user,action,incidentId=null) {state.activity.unshift({id:crypto.randomUUID(),actor:user?.id||'system',actorName:user?.name||'System',action,incidentId,at:now()});}
export function text(value,max=500,required=false){if(typeof value!=='string')value='';value=value.trim();if(value.length>max||required&&!value)throw fail('Please provide valid text (maximum '+max+' characters).');return value;}
export function coords(input) {
 if(input.lat==null&&input.lng==null)return {lat:null,lng:null};
 if(typeof input.lat!=='number'||typeof input.lng!=='number'||!Number.isFinite(input.lat)||!Number.isFinite(input.lng)||Math.abs(input.lat)>90||Math.abs(input.lng)>180)throw fail('Invalid latitude or longitude.');
 return {lat:input.lat,lng:input.lng};
}
export function getIncident(state,user,id) {
 const i=state.incidents.find(i=>i.id===id);if(!i)throw fail('Incident not found.',404);
 if(user.role==='citizen'&&i.ownerId!==user.id||user.role==='responder'&&i.ownerId!==user.id&&i.teamId!==user.teamId)throw fail('Access denied.',403);
 return i;
}
export function score(i) {
 const base=assessPriority({...i,type:i.type==='Trapped'?'Fire':i.type});
 const wait=Math.min(10,Math.floor(Math.max(0,Date.now()-Date.parse(i.createdAt))/600000));
 const value=Math.min(100,base.score+wait+(i.distress?100:0));
 return {score:value,priority:value>=80?'Critical':value>=55?'High':value>=35?'Medium':'Low',reasons:[...base.reasons,`Waiting time: +${wait}`, ...(!i.lat&&!i.lng||i.people===null?['Missing information: operator review required']:[]),...(i.distress?['Responder distress: critical review']:[])]};
}
export function view(state,user) {
 const incidents=state.incidents.filter(i=>user.role==='operator'||i.ownerId===user.id||user.role==='responder'&&i.teamId===user.teamId).map(i=>{
  const {media,...record}=i;const suggested=score(i);const result={...record,suggested,score:suggested.score,priority:i.priorityOverride?.priority||suggested.priority,media:media.map(({id,name,mime})=>({id,name,mime}))};
  if(user.role==='citizen'){delete result.notes;delete result.priorityOverride;delete result.duplicateOf;delete result.groupId;delete result.backupRequests;delete result.escalations;delete result.reportFingerprint;result.history=result.history.map(({status,at})=>({status,at}));}
  return result;
 });
 const teams=user.role==='operator'?state.teams:user.role==='responder'?state.teams.filter(t=>t.id===user.teamId):state.teams.filter(t=>incidents.some(i=>i.teamId===t.id)).map(({id,name,status})=>({id,name,status}));
 return {schemaVersion:2,incidents,teams,alerts:state.alerts.filter(a=>a.verified),inventory:user.role==='operator'?state.inventory:[],activity:user.role==='operator'?state.activity.slice(0,300):[],users:user.role==='operator'?state.users.map(publicUser):[],serverTime:now()};
}
export function createSOS(state,user,input) {
 if(input.ownerId&&input.ownerId!==user.id)throw fail('This pending SOS belongs to a different account. Sign in with its original account.',403);
 if(!/^[a-zA-Z0-9_-]{16,100}$/.test(input.clientRequestId||''))throw fail('A stable request ID is required.');
 const existing=state.incidents.find(i=>i.ownerId===user.id&&i.clientRequestId===input.clientRequestId);
 // The first accepted payload wins. Retries never create or modify an incident.
 if(existing)return existing;
 if(!CATEGORIES.includes(input.type))throw fail('Choose a valid emergency category.');
 if(input.people!=null&&(!Number.isInteger(input.people)||input.people<1||input.people>10000))throw fail('People affected must be 1–10,000 or unknown.');
 const position=coords(input), at=now();
 const report={...position,type:input.type,title:text(input.title,100)||input.type+' assistance requested',description:text(input.description,1000)||'Details not yet provided. Contact the reporter.',location:text(input.location,120)||'Location not yet provided',people:input.people??null,immediateDanger:input.immediateDanger===true};
 const duplicate=position.lat===null?null:findDuplicate(report,state.incidents.filter(i=>!CLOSED.includes(i.status)&&i.lat!==null),Date.now());
 const incident={...report,...assessPriority(report),id:'RG-'+crypto.randomUUID().slice(0,8).toUpperCase(),ownerId:user.id,reporterName:user.name,reporterPhone:user.phone||'',clientRequestId:input.clientRequestId,distress:user.role==='responder'&&input.distress===true,status:'New',teamId:null,duplicateOf:duplicate?.id||null,createdAt:at,updatedAt:at,receivedAt:at,verified:false,history:[{status:'HQ received',at}],notes:[],media:[]};
 state.incidents.unshift(incident);audit(state,user,incident.distress?'Responder distress SOS received':'SOS received: '+incident.title,incident.id);return incident;
}
function event(state,user,i,status){i.updatedAt=now();i.history.push({status,at:i.updatedAt,actor:user.id});audit(state,user,status,i.id);}
function release(state,i){const team=state.teams.find(t=>t.id===i.teamId);if(team&&team.incidentId===i.id){team.status='Available';team.incidentId=null;}for(const item of state.inventory)if(item.incidentId===i.id){item.incidentId=null;item.status='Available';}}
export function act(state,user,id,action,input={}) {
 const i=getIncident(state,user,id),operator=user.role==='operator',responder=user.role==='responder'&&i.teamId===user.teamId;
 const requireOperator=()=>{if(!operator)throw fail('Operator access required.',403);};
 if(action==='acknowledge'){requireOperator();if(!i.acknowledgedAt){i.acknowledgedAt=now();event(state,user,i,'Acknowledged');}}
 else if(action==='verify'){requireOperator();i.verified=true;event(state,user,i,'Verified by operator');}
 else if(action==='priority'){requireOperator();if(!['Critical','High','Medium','Low'].includes(input.priority))throw fail('Invalid priority.');i.priorityOverride={priority:input.priority,reason:text(input.reason,500,true),by:user.id,at:now()};event(state,user,i,'Priority overridden: '+input.priority+' — '+i.priorityOverride.reason);}
 else if(action==='group'){requireOperator();const target=state.incidents.find(v=>v.id===input.targetId);if(!target||target.id===i.id)throw fail('Select another incident to group.');i.groupId=target.groupId||target.id;target.groupId=i.groupId;event(state,user,i,'Grouped for review with '+target.id);}
 else if(action==='assign'){
  requireOperator();if(i.status!=='New')throw fail('Only an unassigned active incident can be assigned.',409);
  const t=state.teams.find(t=>t.id===input.teamId);if(!t||t.status!=='Available'||!t.capabilities.includes(i.type))throw fail('Team unavailable or missing the required capability.',409);
  if(!state.users.some(u=>u.role==='responder'&&u.verified&&u.teamId===t.id))throw fail('This team needs a verified responder account.');
  i.teamId=t.id;i.status='Assigned';t.status='Deployed';t.incidentId=i.id;event(state,user,i,'Assigned');
 }else if(action==='status'){
  if(!operator&&!responder)throw fail('Assigned responder access required.',403);
  const next={Assigned:'Accepted',Accepted:'En route','En route':'Arrived',Arrived:'Assistance underway','Assistance underway':'Resolved'}[i.status];
  if(input.status!==next)throw fail('Invalid response progression.',409);
  i.status=next;if(next==='Resolved'){i.handover=text(input.handover,1000,true);release(state,i);}event(state,user,i,next);
 }else if(action==='decline'){
  if(!responder||i.status!=='Assigned')throw fail('Only the assigned team can decline a pending assignment.',409);
  const reason=text(input.reason,500,true);release(state,i);i.teamId=null;i.status='New';event(state,user,i,'Assignment declined: '+reason);
 }else if(action==='safe'||action==='cancel'){
  if(i.ownerId!==user.id&&!operator)throw fail('Only the reporter or operator can close this SOS.',403);
  if(!CLOSED.includes(i.status)){i.status=action==='safe'?'Safe':'Cancelled';release(state,i);event(state,user,i,i.status);}
 }else if(action==='note'||action==='backup'||action==='escalate'){
  if(!operator&&!responder)throw fail('Operational access required.',403);if(action==='escalate')requireOperator();
  const entry={id:crypto.randomUUID(),text:text(input.text,1000,true),at:now(),by:user.name};
  const field=action==='note'?'notes':action==='backup'?'backupRequests':'escalations';(i[field]||=[]).push(entry);event(state,user,i,action==='backup'?'Backup requested':action==='escalate'?'Escalated for operator follow-up':'Field note added');
 }else throw fail('Unknown action.',404);
 return i;
}
export function recommendations(i,teams) {
 return teams.filter(t=>t.status==='Available'&&t.capabilities.includes(i.type)).map(t=>({...t,distanceKm:i.lat!=null?Math.round(distanceMeters(i,t)/100)/10:null})).sort((a,b)=>(a.distanceKm??Infinity)-(b.distanceKm??Infinity));
}
