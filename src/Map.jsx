import React,{useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
const colors={Critical:'#d44a3f',High:'#d98535',Medium:'#428fa1',Low:'#738177'};
export default function IncidentMap({incidents,selectedId,onSelect,picking=false,onPick,pin,teams=[]}){
 const ref=useRef(null),map=useRef(null),layer=useRef(null),callbacks=useRef({onPick,onSelect,picking});const [tileError,setTileError]=useState(false);
 callbacks.current={onPick,onSelect,picking};
 useEffect(()=>{
  const m=L.map(ref.current,{zoomControl:false}).setView([30.719,76.754],12);map.current=m;
  const tiles=L.tileLayer(import.meta.env.VITE_MAP_TILE_URL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:import.meta.env.VITE_MAP_ATTRIBUTION||'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin'}).addTo(m);
  tiles.on('tileerror',()=>setTileError(true));
  L.control.zoom({position:'bottomright'}).addTo(m);layer.current=L.layerGroup().addTo(m);
  m.on('click',e=>{if(callbacks.current.picking)callbacks.current.onPick?.({lat:+e.latlng.lat.toFixed(5),lng:+e.latlng.lng.toFixed(5)});});
  const ro=new ResizeObserver(()=>m.invalidateSize());ro.observe(ref.current);
  return()=>{ro.disconnect();m.remove();map.current=null;};
 },[]);
 useEffect(()=>{
  if(!layer.current)return;layer.current.clearLayers();
  for(const incident of incidents){
   if(incident.lat==null||incident.lng==null)continue;
   const active=incident.id===selectedId;
   const icon=L.divIcon({className:'map-icon',html:'<span class="incident-pin '+(active?'active':'')+'" style="--pin:'+colors[incident.priority]+'">'+(({Fire:'F',Flood:'W',Medical:'M','Road blockage':'R',Trapped:'T',Other:'!'})[incident.type]||'!')+'</span>',iconSize:[32,32],iconAnchor:[16,16]});
   const marker=L.marker([incident.lat,incident.lng],{icon,title:incident.title,keyboard:true}).addTo(layer.current);
   const tip=document.createElement('span');tip.textContent=incident.title;marker.bindTooltip(tip);
   marker.on('click',()=>{if(!callbacks.current.picking)callbacks.current.onSelect?.(incident.id);});
  }
  for(const t of teams){const p=t.liveLocation||t;if(p.lat==null||p.lng==null)continue;const tip=document.createElement('span');tip.textContent=t.name+(t.liveLocation?' · last shared '+new Date(t.liveLocation.at).toLocaleTimeString():' · simulated base');L.circleMarker([p.lat,p.lng],{radius:5,color:'#fff',weight:2,fillColor:'#1d7567',fillOpacity:1}).addTo(layer.current).bindTooltip(tip);}
  if(pin)L.circleMarker([pin.lat,pin.lng],{radius:10,color:'#155f52',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(layer.current);
 },[incidents,selectedId,pin,teams]);
 useEffect(()=>{const i=incidents.find(i=>i.id===selectedId);if(i?.lat!=null&&map.current)map.current.panTo([i.lat,i.lng],{animate:true});},[selectedId]);
 return <div className={'map-shell '+(picking?'picking':'')}><div ref={ref} className="leaflet-host"/>{tileError&&<div className="map-alert">Basemap unavailable. Coordinates remain available in reports.</div>}<div className="map-label">{picking?'Click map to place report':'SHARED SITUATION MAP'}<small>{picking?'Or enter coordinates below':'Team bases are simulated unless location is shared'}</small></div></div>;
}
