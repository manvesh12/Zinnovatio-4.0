import express from 'express';
import {createIncident,assignTeam,advanceIncident,addIncidentNote,makeSeed} from '../shared/domain.js';
export function createApp(store,onChange=()=>{}) {
 const app=express();app.disable('x-powered-by');app.use(express.json({limit:'16kb'}));
 let queue=Promise.resolve();
 app.get('/api/health',(_,res)=>res.json({ok:true,mode:'simulation',storage:store.kind}));
 app.get('/api/state',(_,res)=>res.json(store.get()));
 function mutate(res,operation) {
  const task=queue.then(async()=>{const next=structuredClone(store.get());const result=operation(next);await store.save(next);onChange();res.json(result);});
  queue=task.catch(error=>{if(!res.headersSent)res.status(error.status||400).json({error:error.message});});
 }
 app.post('/api/incidents',(req,res)=>mutate(res,s=>createIncident(s,req.body)));
 app.post('/api/incidents/:id/assign',(req,res)=>mutate(res,s=>assignTeam(s,req.params.id,req.body.teamId)));
 app.patch('/api/incidents/:id/status',(req,res)=>mutate(res,s=>advanceIncident(s,req.params.id,req.body.status)));
 app.post('/api/incidents/:id/notes',(req,res)=>mutate(res,s=>addIncidentNote(s,req.params.id,req.body.text)));
 app.post('/api/reset',(_,res)=>mutate(res,s=>{Object.assign(s,makeSeed());return {ok:true};}));
 app.use('/api',(_,res)=>res.status(404).json({error:'API endpoint not found.'}));
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(err.status||500).json({error:err.type==='entity.parse.failed'?'Invalid JSON.':'Request failed.'});});
 return app;
}
