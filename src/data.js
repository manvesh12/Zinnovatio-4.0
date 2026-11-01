import {io} from 'socket.io-client';
let session=null;
export const setSession=value=>{session=value;if(value)localStorage.setItem('rg-session',JSON.stringify(value));else localStorage.removeItem('rg-session');};
export const cachedSession=()=>{try{return JSON.parse(localStorage.getItem('rg-session'));}catch{return null;}};
export async function request(url,method='GET',body){
 const response=await fetch(url,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(session?.csrf?{'X-CSRF-Token':session.csrf}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000)});
 const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||'Request failed'),{status:response.status});return result;
}
export function subscribe(callback){const socket=io({withCredentials:true});socket.on('state:changed',callback);socket.on('connect',callback);return()=>socket.disconnect();}
