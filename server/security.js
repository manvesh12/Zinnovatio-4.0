import {randomBytes, scryptSync, timingSafeEqual, createHmac, generateKeyPairSync, sign} from 'node:crypto';

export const fail = (message, status=400) => Object.assign(new Error(message), {status});
export const publicUser = ({id,name,email,role,verified,teamId,phone,language}) => ({id,name,email,role,verified,teamId,phone,language});
export function passwordHash(password) {
 if(typeof password !== 'string' || password.length<12 || password.length>128) throw fail('Use a password of 12–128 characters.');
 const salt=randomBytes(16).toString('hex');
 return salt+':'+scryptSync(password,salt,64).toString('hex');
}
export function passwordMatches(password, stored) {
 if(typeof password!=='string'||password.length>128||!stored)return false;
 const [salt,hash]=stored.split(':');
 return timingSafeEqual(Buffer.from(hash,'hex'),scryptSync(password,salt,64));
}
export function createSecurity(options={}) {
 const sessions=new Map(), attempts=new Map();
 const signing=options.signing||generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const secret=options.ticketSecret||randomBytes(32).toString('hex');
 const cookieName='rg_session';
 const sessionFrom = req => {
  const value=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const session=sessions.get(value);
  if(!session||session.expires<Date.now()){sessions.delete(value);return null;}
  return {...session,token:value};
 };
 const issueTicket = user => {const body=Buffer.from(JSON.stringify({userId:user.id,expires:Date.now()+86400000})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
 return {
  sessionFrom,
  publicKey: signing.publicKey.export({format:'jwk'}),
  issueTicket,
  readTicket(ticket) {
   if(typeof ticket!=='string')throw fail('Delivery authorization is required.',401);
   const [body,mac]=ticket.split('.');const expected=createHmac('sha256',secret).update(body||'').digest('base64url');
   if(!mac||mac.length!==expected.length||!timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))throw fail('Delivery authorization expired. Sign in to retry.',401);
   let value;try{value=JSON.parse(Buffer.from(body,'base64url').toString());}catch{throw fail('Invalid delivery authorization.',401);}
   if(value.expires<Date.now())throw fail('Delivery authorization expired. Sign in to retry.',401);return value;
  },
  receipt(incident,transport) {
   const payload={requestId:incident.clientRequestId,incidentId:incident.id,ownerId:incident.ownerId,receivedAt:incident.receivedAt,transport,status:'HQ received'};
   const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
   return {payload,encoded,signature:sign('sha256',Buffer.from(encoded),{key:signing.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')};
  },
  login(req,res,user) {
   const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
   sessions.set(token,{userId:user.id,csrf,expires:Date.now()+12*3600000});
   res.cookie(cookieName,token,{httpOnly:true,sameSite:'strict',secure:options.secureCookies===true,maxAge:12*3600000,path:'/'});
   return {user:publicUser(user),csrf,ticket:issueTicket(user)};
  },
  logout(req,res) {const session=sessionFrom(req);if(session)sessions.delete(session.token);res.clearCookie(cookieName,{path:'/'});},
  throttle(key) {
   const now=Date.now();for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
   const bucket=attempts.get(key)||{count:0,until:now+60000};bucket.count++;attempts.set(key,bucket);
   if(bucket.count>20)throw fail('Too many attempts. Wait one minute.',429);
  }
 };
}
