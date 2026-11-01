// No browser or Node dependencies: used by both the UI and transport tests.
export async function deliver({report,ownerId,ticket,config,send,verify,onAttempt=()=>{}}) {
 const attempts=[];
 for(const name of ['internet','local','rf','satellite']) {
  const transport=config.transports.find(t=>t.name===name);
  if(name!=='internet'&&(!transport?.url||transport.mode!=='configured')){
   attempts.push({name,status:'Simulation / not configured — not delivered'});onAttempt([...attempts]);continue;
  }
  try {
   const response=await send(name==='internet'?'/api/incidents':transport.url,name==='internet'?report:{report,ticket,transport:name},name);
   if(!await verify(response.receipt,config.receiptPublicKey,report.clientRequestId,ownerId))throw new Error('No valid HQ receipt');
   attempts.push({name,status:'HQ receipt confirmed'});onAttempt([...attempts]);return {receipt:response.receipt,attempts};
  } catch(error) {
   attempts.push({name,status:error.message||'Unreachable — not delivered'});onAttempt([...attempts]);
   // Permanent report validation errors need correction, not another transport.
   if(error.status===400||error.status===413||error.status===422)return {receipt:null,attempts,needsReview:true};
  }
 }
 return {receipt:null,attempts};
}
