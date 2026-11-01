// Explicit, isolated training mode. Never uses the operational data file.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeSeed} from '../shared/domain.js';
import {migrate} from './workflows.js';
import {passwordHash} from './security.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'data','demo-state.json');
await mkdir(path.dirname(file),{recursive:true});
try{await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;
 const state=migrate(makeSeed()),hash=passwordHash('Raksha-demo-2026!');
 state.users=[['operator','HQ Operator','operator',null],['citizen','Aarav Sharma','citizen',null],['responder','Rescue Alpha','responder','T1']].map(([id,name,role,teamId])=>({id:'demo-'+id,name,email:id+'@raksha.demo',passwordHash:hash,role,teamId,verified:true}));
 await writeFile(file,JSON.stringify(state,null,2));
}
process.env.RAKSHA_GRID_DATA_FILE=file;delete process.env.MONGODB_URI;
process.env.PORT='4173';process.env.APP_ORIGINS='http://127.0.0.1:4173,http://localhost:4173';process.env.APP_MODE='training';
console.log('ISOLATED TRAINING: operator@raksha.demo, citizen@raksha.demo, responder@raksha.demo');
console.log('Training password: Raksha-demo-2026! — never use these accounts for operational deployment.');
await import('./index.js');
