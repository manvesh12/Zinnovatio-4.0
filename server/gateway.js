// Reference LOCAL NETWORK gateway only. No RF or satellite transmission is claimed.
import 'dotenv/config';
import express from 'express';
const upstream=process.env.GATEWAY_HQ_URL;
const key=process.env.LOCAL_GATEWAY_KEY;
if(!upstream||!key)throw new Error('Set GATEWAY_HQ_URL and LOCAL_GATEWAY_KEY on the gateway machine.');
const origins=(process.env.GATEWAY_ALLOWED_ORIGINS||'http://127.0.0.1:4173').split(',').map(s=>s.trim());
const app=express();app.disable('x-powered-by');
app.use((req,res,next)=>{const origin=req.headers.origin;if(origin&&!origins.includes(origin))return res.sendStatus(403);if(origin)res.set('Access-Control-Allow-Origin',origin);res.set({'Vary':'Origin','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'});if(req.method==='OPTIONS')return res.sendStatus(204);next();});
app.use(express.json({limit:'16kb'}));
app.post('/send',async(req,res)=>{try{
 if(req.body.transport!=='local')return res.status(400).json({error:'This adapter only supports local network delivery.'});
 const result=await fetch(new URL('/api/gateway/ingest',upstream),{method:'POST',headers:{'Content-Type':'application/json','X-Gateway-Key':key},body:JSON.stringify(req.body),signal:AbortSignal.timeout(6000)});
 const data=await result.json();res.status(result.status).json(data);
}catch{res.status(503).json({error:'HQ unreachable. Not delivered; retain the SOS in the device queue.'});}});
app.listen(Number(process.env.GATEWAY_PORT||4400),process.env.GATEWAY_HOST||'127.0.0.1',()=>console.log('Local network gateway listening. RF and satellite are not implemented by this adapter.'));
