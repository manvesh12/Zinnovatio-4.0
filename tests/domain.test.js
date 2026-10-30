import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSeed,createIncident,assignTeam,advanceIncident,assessPriority,findDuplicate,validateReport,suggestedTeams,addIncidentNote} from '../shared/domain.js';
const now=Date.parse('2026-10-27T09:00:00Z');
const report={title:'Water near residential lane',description:'Water levels rising near residences.',location:'Sector 71, Mohali',type:'Flood',lat:30.7046,lng:76.7179,people:8,immediateDanger:false};
test('priority thresholds and immediate danger are explainable',()=>{
 assert.equal(assessPriority(report).priority,'Medium');
 assert.equal(assessPriority({...report,immediateDanger:true}).priority,'Critical');
 assert.equal(assessPriority({...report,type:'Fire',people:20,immediateDanger:true}).score,100);
 assert.equal(assessPriority({...report,type:'Road blockage',people:1}).priority,'Low');
});
test('validation rejects invalid coordinates, counts and report text',()=>{
 for(const bad of [{lat:''},{lng:181},{lat:30.1},{people:0},{people:1.5},{type:'Other'},{title:'x'},{description:'short'}])assert.throws(()=>validateReport({...report,...bad}));
});
test('duplicate requires type, proximity, time and active status',()=>{
 const state=makeSeed(now);assert.equal(findDuplicate(report,state.incidents,now).id,'RG-1001');
 assert.equal(findDuplicate({...report,type:'Fire'},state.incidents,now),null);
 assert.equal(findDuplicate({...report,lat:30.8},state.incidents,now),null);
 assert.equal(findDuplicate(report,state.incidents,now+3*3600000),null);
 state.incidents.find(i=>i.id==='RG-1001').status='Resolved';assert.equal(findDuplicate(report,state.incidents,now),null);
});
test('reports remain separate when a possible duplicate is flagged',()=>{
 const s=makeSeed(now),length=s.incidents.length;const i=createIncident(s,report,now);
 assert.equal(i.duplicateOf,'RG-1001');assert.equal(s.incidents.length,length+1);assert.equal(i.status,'New');
});
test('assignment enforces capability and availability',()=>{
 const s=makeSeed(now);assert.throws(()=>assignTeam(s,'RG-1001','T5',now));
 assignTeam(s,'RG-1001','T1',now);assert.equal(s.teams[0].status,'Deployed');
 assert.throws(()=>assignTeam(s,'RG-1005','T1',now));assert.throws(()=>assignTeam(s,'RG-1001','T4',now));
});
test('response transitions release resource only on resolution',()=>{
 const s=makeSeed(now);assert.throws(()=>advanceIncident(s,'RG-1001','Resolved',now));
 assignTeam(s,'RG-1001','T1',now);assert.throws(()=>advanceIncident(s,'RG-1001','Resolved',now));
 advanceIncident(s,'RG-1001','En route',now);assert.equal(s.teams[0].status,'Deployed');
 advanceIncident(s,'RG-1001','Resolved',now);assert.equal(s.teams[0].status,'Available');assert.equal(s.teams[0].incidentId,null);
 assert.throws(()=>advanceIncident(s,'RG-1001','New',now));assert.equal(s.activity.length,4);
});
test('suggestions include only available compatible teams in distance order',()=>{
 const s=makeSeed(now),incident=s.incidents.find(i=>i.id==='RG-1001');
 assert.deepEqual(suggestedTeams(incident,s.teams).map(t=>t.id),['T1','T4']);
 assignTeam(s,incident.id,'T1',now);assert.deepEqual(suggestedTeams(incident,s.teams).map(t=>t.id),['T4']);
});
test('operator notes validate, persist on the incident and enter audit log',()=>{
 const s=makeSeed(now);assert.throws(()=>addIncidentNote(s,'RG-1001',' '));
 assert.throws(()=>addIncidentNote(s,'missing','A valid note'));
 const note=addIncidentNote(s,'RG-1001','  Road access confirmed  ',now);
 assert.equal(note.text,'Road access confirmed');assert.equal(s.incidents[0].notes[0].id,note.id);
 assert.equal(s.activity[0].incidentId,'RG-1001');
});
