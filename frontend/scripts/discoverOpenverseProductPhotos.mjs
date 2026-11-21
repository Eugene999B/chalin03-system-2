/**
 * Licensed, REAL photographic references for the CHALIN03 public catalogue.
 * Openverse indexes independently published CC photographs. This research
 * never overwrites the uploaded on-shelf SKU photograph or changes master
 * store products, prices, orders or stock.
 *
 * Import results only after subject/category and licensing review. Data are
 * candidates of the part TYPE, NOT CHALIN03 inventory proof or exact fitment.
 */
const BASE="https://api.chalin03.com/api/public-commerce/products";
const API="https://api.openverse.org/v1/images/";
const WAIT=3350; // Anonymous Openverse requests: stay under 20 per minute.
const MAX_TIME=11*60*1000;
const MAX_PAGES=2;
const userAgent="CHALIN03LicensedPhotoResearch/1.0 (https://homepage.chalin03.com; business photo research)";
const banned=/\b(?:logo|graphic|drawing|diagram|icon|illustration|render|artwork|sculpture|seat|painting|poster|signboard|brochure|chart|infographic|cartoon|character|dog|cat|person|people|portrait|map|advert|advertisement|vintage poster)\b/i;
const sources=new Set(["upload.wikimedia.org","live.staticflickr.com","images.pexels.com","cdn.stocksnap.io","images.unsplash.com","cdn.pixabay.com"]);
const patterns=[
 ["oil-filter",/oil.?filter|hydraulic.*filter|return filter|pilot filter/i,"automotive oil filter mechanical filter part",["filter","oil","automotive"]],
 ["fuel-filter",/fuel filter|water separator/i,"diesel engine fuel filter mechanical automotive",["filter","fuel","diesel"]],
 ["air-filter",/air cleaner|air condition filter/i,"engine air filter cylindrical replacement",["filter","air","engine"]],
 ["spanner-socket",/box spanner|piston spanner/i,"socket wrench metal hand tool",["socket","wrench","spanner"]],
 ["spanner",/spanner|wrench|alloy key/i,"combination spanner wrench workshop",["spanner","wrench","tools"]],
 ["seal",/seal|gasket|o.?ring|osher/i,"rubber o ring gasket mechanical seal",["seal","gasket","rubber","ring"]],
 ["belt",/fan belt|alternator.*belt|\bbelt\b/i,"rubber engine serpentine drive belt",["belt","engine","rubber"]],
 ["nut-bolt",/bolt|\bnut\b|screw|nipple/i,"steel bolts nuts fasteners workshop",["bolt","nut","screw","fastener"]],
 ["lubricant",/\boil\b|lubricant|coolant|\bgrease\b/i,"motor engine lubricant oil bottle workshop",["oil","lubricant","engine","motor","bottle","grease"]],
 ["grease-gun",/grease gun|blowtorch gun/i,"manual grease gun workshop hand tool",["grease","gun","tool","lubrication"]],
 ["hydraulic-hose",/hose|\bpipe\b|tube/i,"industrial hydraulic hose rubber pipe",["hose","pipe","hydraulic","rubber"]],
 ["excavator-pin",/\bpin\b|bushing|spacer|collar/i,"heavy machinery steel pin bushing bearing",["pin","bushing","steel","bearing"]],
 ["bearing",/bearing|\bbush\b/i,"industrial ball bearing steel machinery part",["bearing","steel"]],
 ["gear",/\bgear\b|sprocket|spocket|coupling|teeth|tooth|idler|roller|track link/i,"industrial mechanical steel spur gear sprocket",["gear","sprocket","steel","machinery"]],
 ["track",/track shoe|track guard/i,"excavator metal tracks treads",["track","excavator","steel"]],
 ["engine",/engine|cylinder|piston|injector|crank|turbo/i,"industrial diesel engine motor component",["diesel","engine","motor","cylinder"]],
 ["battery",/battery|alternator|starter/i,"automotive car battery alternator",["battery","alternator","automotive","starter"]],
 ["pump",/pump|impeller/i,"industrial hydraulic pump mechanical machinery",["pump","hydraulic","industrial"]],
 ["ignition-key",/\bkey\b|key nob|switch|regulator/i,"machinery ignition key switch metal",["key","ignition","switch","machinery"]],
 ["excavator-bucket",/bucket|excavator teeth|teeth adapter/i,"construction excavator metal digging bucket",["bucket","excavator","construction"]],
 ["tool-hammer",/hammer|shovel|cutter/i,"steel claw hammer shovel work tool",["hammer","shovel","tool"]],
 ["motorbike",/motor bike|motorcycle|apsonic|haojin/i,"commuter motorcycle motorbike",["motorcycle","motorbike","bike"]],
 ["wire",/wire|cable|charger|monitor|sensor/i,"electrical copper wire wiring cable",["wire","cable","electrical"]],
 ["radiator-tank",/tank|radiation|radiator/i,"automotive engine radiator coolant reservoir",["radiator","engine","coolant","tank"]],
 ["blanket",/blanket|jeans|boot|rain coat|umbrella/i,"protective work clothing raincoat boots",["workwear","boot","raincoat","clothing"]],
 ["valve",/valve|solenoid/i,"industrial hydraulic valve metal machinery",["valve","hydraulic","metal"]],
 ["motor",/motor|accelerator/i,"industrial electric motor metal machinery",["motor","electric","machinery"]],
 ["fan",/fan blade|fan pulley/i,"engine cooling fan pulley automotive",["fan","pulley","engine"]],
 ["clamp",/clamp|fuse box|digital scale|torch light/i,"industrial mechanical clamp handheld workshop",["clamp","workshop","tool"]],
 ["misc",/bar|rod|disc|metal plate|case|coupling|extensional/i,"steel mechanical workshop metal part",["metal","steel","workshop","mechanical"]],
];
const trim=(s,n=130)=>String(s??"").trim().slice(0,n);
const tokens=s=>new Set(String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").split(" ").filter(x=>x.length>=3));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function request(url,timeout=16000){
 const res=await fetch(url,{headers:{"Accept":"application/json","User-Agent":userAgent},signal:AbortSignal.timeout(timeout)});
 if(!res.ok)throw new Error("HTTP "+res.status);
 return res.json();
}
async function catalogue(){
 let list=[];
 for(let i=1;i<=12;i++){
  const u=new URL(BASE);u.searchParams.set("page",String(i));u.searchParams.set("limit","60");
  const data=await request(u.toString());
  if(!Array.isArray(data.products))throw Error("Catalog API invalid");
  list.push(...data.products);
  if(list.length>=Number(data.count||459)||!data.products.length)break;
 }
 if(list.length<100)throw Error("Unexpectedly empty Main Store catalogue");
 return list;
}
function groupFor(item){
 const name=trim(item.name,200);
 return patterns.find(x=>x[1].test(name))?.[0]||null;
}
function pass(item,group){
 const obj=patterns.find(x=>x[0]===group);
 if(!obj)return false;
 const title=trim(item.title,260),tagText=(item.tags||[]).map(t=>trim(t.name)).join(" ");
 if(banned.test(title)||banned.test(tagText))return false;
 if(item.mature===true||item.category!=="photograph")return false;
 if(!["cc0","pdm","by","by-sa"].includes(trim(item.license).toLowerCase()))return false;
 if(Number(item.width)<350||Number(item.height)<260)return false;
 if(!/^https:\/\//.test(item.url)||!/^https:\/\//.test(item.foreign_landing_url))return false;
 let hostname;try{hostname=new URL(item.url).hostname;}catch{return false;}
 if(!sources.has(hostname))return false;
 if(!/\.(jpg|jpeg|png)(?:\?|$)/i.test(new URL(item.url).pathname))return false;
 const words=tokens(title+" "+tagText);
 return obj[3].some(t=>words.has(t));
}
async function fetchGroup(obj,page){
 const u=new URL(API);
 for(const [k,v] of Object.entries({q:obj[2],page_size:"40",page:String(page),license_type:"commercial",category:"photograph"}))u.searchParams.set(k,v);
 const data=await request(u.toString(),18000);
 return Array.isArray(data.results)?data.results:[];
}
async function main(){
 const started=Date.now(),list=await catalogue(),groups=new Map();
 for(const item of list){const g=groupFor(item);if(!g)continue;const bucket=groups.get(g)||[];bucket.push(item);groups.set(g,bucket);}
 const seen=new Set(),matches=[];
 console.log("OPENVERSE_MAIN_STORE_COUNT|"+list.length);
 console.log("OPENVERSE_GROUP_COUNTS|"+JSON.stringify(Object.fromEntries([...groups].map(([g,items])=>[g,items.length]))));
 let queries=0,errors=0,images=0;
 for(const obj of patterns){
   if(Date.now()-started>MAX_TIME)break;
   const type=obj[0],items=groups.get(type)||[];
   if(!items.length)continue;
   let candidates=[];
   const pages=items.length>24?MAX_PAGES:1;
   for(let p=1;p<=pages;p++){
    try{
      const result=await fetchGroup(obj,p);
      queries++;candidates.push(...result.filter(image=>pass(image,type)));
    }catch(err){errors++;console.log("OPENVERSE_ERROR|"+type+"|"+String(err.message||err).slice(0,75));}
    await sleep(WAIT);
   }
   candidates=candidates.sort((a,b)=>Number(b.width||0)*Number(b.height||0)-Number(a.width||0)*Number(a.height||0));
   let assigned=0;
   for(const item of items){
    const next=candidates.find(p=>!seen.has(p.id)&&!seen.has(p.url));
    if(!next)break;
    seen.add(next.id);seen.add(next.url);
    matches.push({id:item.id,name:item.name,size:item.size||"",
      image_url:next.url,source:next.foreign_landing_url,license:next.license+" "+(next.license_version||""),
      license_url:next.license_url,credit:trim(next.creator)||"Openverse contributor",
      photo_title:trim(next.title,180),source_provider:next.provider,photo_kind:"representative_real_photo_not_exact_stock"});
    assigned++;
   }
   images+=assigned;
   console.log("OPENVERSE_GROUP|"+JSON.stringify({type,items:items.length,candidates:candidates.length,assigned}));
 }
 for(const match of matches)console.log("OPENVERSE_MATCH|"+JSON.stringify(match));
 console.log("OPENVERSE_DONE|"+JSON.stringify({inventory:list.length,candidate_photos:images,unmatched:list.length-images,queries,errors,seconds:Math.round((Date.now()-started)/1000)}));
}
main().catch(err=>{console.error("OPENVERSE_ABORT|"+err.message);process.exitCode=1;});
