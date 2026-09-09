/** Suhail Travel API backend (Cloudflare Worker)
 *  Secrets: DUFFEL_TOKEN
 *  Deploy separately from GitHub Pages. Never put DUFFEL_TOKEN in index.html.
 */
const H = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
async function duffel(path, method='GET', body, token){
  token=String(token||'').trim();
  if(!token) throw new Error('DUFFEL_TOKEN is not configured');
  const r=await fetch('https://api.duffel.com'+path,{method,headers:{'Authorization':`Bearer ${token}`,'Duffel-Version':'v2','Accept':'application/json','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const text=await r.text(); let data={}; try{data=JSON.parse(text)}catch{}
  if(!r.ok) throw new Error(data?.errors?.[0]?.message||data?.error||`Duffel ${r.status}`);
  return data;
}
function cleanCode(v){return String(v||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8)}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))}
async function flights(p, token){
  const origin=cleanCode(p.origin), destination=cleanCode(p.destination), dep=String(p.departureDate||'');
  if(!origin||!destination||!validDate(dep)) throw new Error('origin, destination and a valid departureDate are required');
  const adults=Math.max(1,Math.min(9,Number(p.adults||1)));
  const slices=[{origin,destination,departure_date:dep}];
  if(p.returnDate&&validDate(p.returnDate)) slices.push({origin:destination,destination:origin,departure_date:p.returnDate});
  const body={data:{cabin_class:['economy','premium_economy','business','first'].includes(p.cabin)?p.cabin:'economy',slices,passengers:Array.from({length:adults},()=>({type:'adult'}))}};
  const data=await duffel('/air/offer_requests?return_offers=true&view=offers','POST',body,token);
  return {provider:'duffel',offers:data?.data?.offers||[],request:data?.data?.id||null,liveMode:!!data?.data?.live_mode};
}
async function stays(p, token){
  const checkIn=String(p.checkIn||''), checkOut=String(p.checkOut||'');
  if(!validDate(checkIn)||!validDate(checkOut)) throw new Error('checkIn and checkOut must be YYYY-MM-DD');
  const lat=Number(p.latitude), lng=Number(p.longitude), radius=Math.max(1,Math.min(50,Number(p.radius||5)));
  if(!Number.isFinite(lat)||!Number.isFinite(lng)) throw new Error('latitude and longitude are required for hotel search');
  const adults=Math.max(1,Math.min(20,Number(p.adults||2))), rooms=Math.max(1,Math.min(10,Number(p.rooms||1)));
  const guests=Array.from({length:adults},()=>({type:'adult'}));
  const body={data:{check_in_date:checkIn,check_out_date:checkOut,rooms,guests,location:{radius,geographic_coordinates:{latitude:lat,longitude:lng}},mobile:true}};
  const data=await duffel('/stays/search','POST',body,token);
  return {provider:'duffel',results:data?.data?.results||[],searchId:data?.data?.id||null};
}
export default {async fetch(req, env){
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:H});
  const u=new URL(req.url);
  try{
    if(u.pathname==='/api/health') return json({ok:true,provider:'duffel',configured:!!String(env?.DUFFEL_TOKEN||'').trim()});
    if(req.method!=='POST') return json({error:'Method not allowed'},405);
    const p=await req.json();
    if(u.pathname==='/api/flights/search') return json(await flights(p, env?.DUFFEL_TOKEN));
    if(u.pathname==='/api/stays/search') return json(await stays(p, env?.DUFFEL_TOKEN));
    return json({error:'Not found'},404);
  }catch(e){console.error(e); return json({error:e?.message||'Server error'},400)}
}};
