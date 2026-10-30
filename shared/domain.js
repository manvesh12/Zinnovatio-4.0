export const TYPES = ['Fire','Flood','Road blockage','Medical'];
export const STATUSES = ['New','Assigned','En route','Resolved'];
export const PRIORITIES = ['Critical','High','Medium','Low'];
export const SERVICE_AREA = { south:30.55, north:30.87, west:76.45, east:76.95 };
export function validateReport(input) {
 const title=String(input.title||'').trim(), description=String(input.description||'').trim(), location=String(input.location||'').trim();
 if(title.length<5||title.length>100) throw new Error('Title must contain 5–100 characters.');
 if(description.length<10||description.length>1000) throw new Error('Description must contain 10–1000 characters.');
 if(location.length<3||location.length>120) throw new Error('Location must contain 3–120 characters.');
 if(!TYPES.includes(input.type)) throw new Error('Choose a valid incident type.');
 const lat=Number(input.lat), lng=Number(input.lng), people=Number(input.people);
 if(input.lat===''||input.lng===''||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<SERVICE_AREA.south||lat>SERVICE_AREA.north||lng<SERVICE_AREA.west||lng>SERVICE_AREA.east) throw new Error('Choose a location in the Chandigarh/Mohali demo area.');
 if(!Number.isInteger(people)||people<1||people>10000) throw new Error('People affected must be a whole number from 1 to 10,000.');
 return {title,description,location,type:input.type,lat,lng,people,immediateDanger:input.immediateDanger===true};
}
export function assessPriority(report) {
 let score=({Fire:55,Flood:40,'Road blockage':20,Medical:50})[report.type]||20;
 const reasons=[report.type+' baseline: '+score];
 if(report.immediateDanger){score+=45;reasons.push('Immediate danger reported: +45');}
 if(report.people>=20){score+=20;reasons.push('20+ people affected: +20');}
 else if(report.people>=5){score+=10;reasons.push('5–19 people affected: +10');}
 score=Math.min(100,score);
 return {score,priority:score>=80?'Critical':score>=55?'High':score>=35?'Medium':'Low',reasons};
}
export function distanceMeters(a,b) {
 const rad=v=>v*Math.PI/180, p=rad(b.lat-a.lat), q=rad(b.lng-a.lng);
 const h=Math.sin(p/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(q/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
export function findDuplicate(report,incidents,now=Date.now()) {
 return incidents.filter(i=>i.status!=='Resolved'&&i.type===report.type&&now-Date.parse(i.createdAt)>=0&&now-Date.parse(i.createdAt)<7200000&&distanceMeters(report,i)<=350)
 .sort((a,b)=>distanceMeters(report,a)-distanceMeters(report,b))[0]||null;
}
export function eligibleTeams(incident,teams) {
 return teams.filter(t=>t.status==='Available'&&t.capabilities.includes(incident.type));
}
export function suggestedTeams(incident,teams) {
 return eligibleTeams(incident,teams).map(team=>({...team,distanceKm:Math.round(distanceMeters(incident,team)/100)/10}))
 .sort((a,b)=>a.distanceKm-b.distanceKm||a.id.localeCompare(b.id));
}
export function addIncidentNote(state,incidentId,text,now=Date.now()) {
 const incident=state.incidents.find(i=>i.id===incidentId);
 if(!incident) throw new Error('Incident not found.');
 if(typeof text!=='string'||text.trim().length<2||text.trim().length>500) throw new Error('Note must contain 2-500 characters.');
 const note={id:crypto.randomUUID(),text:text.trim(),at:new Date(now).toISOString()};
 incident.notes=[...(incident.notes||[]),note];incident.updatedAt=note.at;
 log(state,'Operator note added',incident.id,now);return note;
}
function log(state,action,incidentId,now) {state.activity.unshift({id:crypto.randomUUID(),action,incidentId,at:new Date(now).toISOString()});state.activity=state.activity.slice(0,200);}
export function createIncident(state,input,now=Date.now()) {
 const report=validateReport(input), assessment=assessPriority(report), duplicate=findDuplicate(report,state.incidents,now);
 const incident={...report,...assessment,id:'RG-'+crypto.randomUUID().slice(0,8).toUpperCase(),status:'New',teamId:null,duplicateOf:duplicate?.id||null,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()};
 state.incidents.unshift(incident);log(state,'Report received: '+incident.title,incident.id,now);return incident;
}
export function assignTeam(state,incidentId,teamId,now=Date.now()) {
 const incident=state.incidents.find(i=>i.id===incidentId), team=state.teams.find(t=>t.id===teamId);
 if(!incident||!team) throw new Error('Incident or team no longer exists.');
 if(incident.status!=='New') throw new Error('Only a new incident can be assigned.');
 if(!eligibleTeams(incident,state.teams).some(t=>t.id===teamId)) throw new Error('Team is unavailable or does not support this incident type.');
 incident.teamId=team.id;incident.status='Assigned';incident.updatedAt=new Date(now).toISOString();team.status='Deployed';team.incidentId=incident.id;
 log(state,team.name+' assigned by operator',incident.id,now);return incident;
}
export function advanceIncident(state,incidentId,status,now=Date.now()) {
 const incident=state.incidents.find(i=>i.id===incidentId);
 if(!incident) throw new Error('Incident not found.');
 const next={Assigned:'En route','En route':'Resolved'}[incident.status];
 if(status!==next) throw new Error('Invalid status change. Assign a team before advancing response.');
 incident.status=status;incident.updatedAt=new Date(now).toISOString();
 if(status==='Resolved'){const team=state.teams.find(t=>t.id===incident.teamId);if(team){team.status='Available';team.incidentId=null;}}
 log(state,'Status changed to '+status,incident.id,now);return incident;
}
export function makeSeed(now=Date.now()) {
 const teams=[
 {id:'T1',name:'Rescue Alpha',role:'Flood rescue',capabilities:['Flood'],lat:30.7046,lng:76.7179,status:'Available',incidentId:null,members:6},
 {id:'T2',name:'Fire Unit 02',role:'Fire response',capabilities:['Fire'],lat:30.735,lng:76.775,status:'Available',incidentId:null,members:5},
 {id:'T3',name:'Medical Bravo',role:'Medical response',capabilities:['Medical'],lat:30.728,lng:76.745,status:'Available',incidentId:null,members:3},
 {id:'T4',name:'Civil Response',role:'Road clearance',capabilities:['Road blockage','Flood'],lat:30.742,lng:76.70,status:'Available',incidentId:null,members:4},
 {id:'T5',name:'Fire Unit 05',role:'Fire response',capabilities:['Fire'],lat:30.762,lng:76.79,status:'Available',incidentId:null,members:5}];
 const sample=[
 ['RG-1001','Water rising near residential lane','Flood','Sector 71, Mohali',30.7046,76.7179,24,true,'Water has entered the ground floor. Residents need help reaching higher ground.','New',null,7],
 ['RG-1002','Smoke reported at market complex','Fire','Sector 22, Chandigarh',30.7353,76.7751,8,true,'Heavy smoke reported near a shop entrance. Evacuation assistance is requested.','Assigned','T2',16],
 ['RG-1003','Fallen tree blocking main road','Road blockage','Sector 35, Chandigarh',30.7222,76.7599,12,false,'A fallen tree obstructs both lanes. Traffic is backing up near the junction.','New',null,25],
 ['RG-1004','Medical assistance at relief point','Medical','Sector 61, Mohali',30.703,76.737,3,false,'Three people at the simulated relief point require medical assessment.','En route','T3',34],
 ['RG-1005','Waterlogged underpass reported','Flood','Sector 80, Mohali',30.683,76.718,6,false,'Standing water is obstructing the underpass. Road access needs assessment.','New',null,42],
 ['RG-1006','Road obstruction cleared','Road blockage','Sector 17, Chandigarh',30.741,76.782,5,false,'Simulated debris has been cleared and the incident is marked resolved.','Resolved',null,55]];
 const incidents=sample.map(([id,title,type,location,lat,lng,people,immediateDanger,description,status,teamId,minutes])=>{const report={title,type,location,lat,lng,people,immediateDanger,description};return {...report,...assessPriority(report),id,status,teamId,duplicateOf:null,createdAt:new Date(now-minutes*60000).toISOString(),updatedAt:new Date(now-minutes*60000).toISOString()};});
 for(const t of teams){const i=incidents.find(i=>i.teamId===t.id&&i.status!=='Resolved');if(i){t.status='Deployed';t.incidentId=i.id;}}
 return {schemaVersion:1,incidents,teams,activity:[{id:'seed',at:new Date(now).toISOString(),action:'Training scenario loaded • all incidents and teams are simulated',incidentId:null}]};
}
