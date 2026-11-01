import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSeed} from '../shared/domain.js';
import {migrate} from '../server/workflows.js';
test('migration preserves legacy incidents, assignments, operator notes and activity',()=>{
 const existing=makeSeed();existing.incidents[0].notes=[{id:'legacy-note',text:'Keep this field report',at:'2026-10-27T00:00:00Z'}];
 const before=structuredClone(existing),migrated=migrate(existing);
 assert.equal(migrated.schemaVersion,2);assert.equal(migrated.incidents.length,before.incidents.length);
 for(const record of before.incidents){const after=migrated.incidents.find(i=>i.id===record.id);for(const [key,value] of Object.entries(record))assert.deepEqual(after[key],value);}
 for(const team of before.teams){const after=migrated.teams.find(t=>t.id===team.id);for(const [key,value] of Object.entries(team))assert.deepEqual(after[key],value);}
 assert.deepEqual(migrated.activity,before.activity);assert.deepEqual(migrate(migrated),migrated);
});
