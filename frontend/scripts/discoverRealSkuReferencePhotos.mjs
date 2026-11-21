/**
 * One-time research: find independently licensed REAL photographs representing
 * live CHALIN03 Main Store products. NOT AI generated; NOT actual on-shelf
 * inventory. Every result is a source-attributed candidate subject to review.
 *
 * No public writes, no modifications of POS and no untrusted image downloads.
 * Output is an auditable candidate list in CI logs for reviewed publishing.
 */
const BASE="https://api.chalin03.com/api/public-commerce/products";
const COMMONS="https://commons.wikimedia.org/w/api.php";
const MAX_PRODUCTS=Math.max(1,Math.min(600,Number(process.env.MAX_PRODUCTS||120)));
const WORKERS=2;
const MAX_MS=8*60*1000;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const userAgent="CHALIN03ProductPhotoResearch/1.0 (https://homepage.chalin03.com/; contact via help.chalin03.com)";
const blocked=/\b(?:logo|drawing|diagram|illustration|render|cartoon|sketch|drawing|vector|icon|symbol|painting|screenshot|map|infographic|manual|pdf|brochure|sign|poster|photo[ -]?montage)\b/i;
const common=new Set(["small","large","big","little","short","long","normal","heavy","duty","original","single","all","none","standard","complete","china","chinese","with","without","set","for","the","of","and","or","good","red","black","white","big","yard","box","light","up","top","down","pair","oil","excavator","engine","tool"]);
const tokenise=value=>String(value||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").split(" ").filter(x=>x.length>1);
const unique=arr=>[...new Set(arr)];
function shortName(v){
 const name=String(v||"");
 return name.replace(/\b(?:original|big|light duty|heavy duty|complete|new|None)\b/ig," ").replace(/\s+/g," ").trim().slice(0,90);
}
function photoScore(product,title){
 const words=tokenise(product.name),titleWords=tokenise(title.replace(/^File:/,"").replace(/\.(jpg|jpeg|png)$/i,""));
 const photoSet=new Set(titleWords);
 const key=unique(words.filter(w=>w.length>=3&&!common.has(w)));
 const matches=key.filter(w=>photoSet.has(w));
 const meaningful=words.filter(w=>w.length>=3&&!["and","the","for","with","without"].includes(w));
 const commonMatched=meaningful.filter(w=>photoSet.has(w));
 if(matches.length===0&&commonMatched.length<2)return 0;
 if(key.length>=2&&matches.length<Math.min(2,key.length)&&commonMatched.length<2)return 0;
 const brandWords=["sany","xcmg","liugong","jcb","hyundai","komatsu","caterpillar","apsonic","shell","sinopec","total","gtt","stanley","johndeere"];
 const itemBrands=brandWords.filter(w=>words.includes(w)),photoBrands=brandWords.filter(w=>photoSet.has(w));
 if(itemBrands.length&&photoBrands.length&&!itemBrands.some(w=>photoBrands.includes(w)))return 0;
 const numeric=words.filter(w=>/^\d{1,5}$/.test(w));
 const picturedNumeric=titleWords.filter(w=>/^\d{1,5}$/.test(w));
 // A pictured incompatible part-number / spanner size is not acceptable.
 if(numeric.length&&picturedNumeric.length&&!numeric.some(w=>picturedNumeric.includes(w)))return 0;
 const score=matches.length*22+commonMatched.length*7+(photoSet.has(words[0])?8:0)+
  (numeric.some(w=>photoSet.has(w))?9:0)+(itemBrands.some(w=>photoSet.has(w))?12:0);
 return score>=18?score:0;
}
function htmlText(input){return String(input||"").replace(/<[^>]*>/g," ").replace(/&[^;]{1,15};/g," ").replace(/\s+/g," ").trim().slice(0,150);}
async function fetchJson(url,timeout=10500){
 const signal=AbortSignal.timeout(timeout);
 const r=await fetch(url,{headers:{"Accept":"application/json","User-Agent":userAgent},signal});
 if(!r.ok){const e=new Error("HTTP "+r.status);e.httpStatus=r.status;throw e;}
 return r.json();
}
async function products(){
 let all=[],count=459;
 for(let page=1;page<=12;page++){
  const url=new URL(BASE);
  url.searchParams.set("page",String(page));
  url.searchParams.set("limit","60");
  const data=await fetchJson(url.toString(),15000);
  if(!Array.isArray(data.products))throw new Error("Live catalogue has no products array");
  all.push(...data.products);
  count=Number(data.count||count);
  if(all.length>=count||!data.products.length)break;
 }
 if(all.length<100)throw new Error("Live catalogue returned too few products; refusing incomplete photo research");
 return all.sort((a,b)=>a.id-b.id);
}
function searchQuery(item){
 // Keep actual manufacturer/part references as search terms where available.
 let phrase=shortName(item.name);
 if(phrase.length<3)return null;
 return phrase;
}
async function commonsCandidates(item){
 const search=searchQuery(item);
 if(!search)return [];
 const url=new URL(COMMONS);
 Object.entries({action:"query",generator:"search",gsrsearch:search,gsrnamespace:"6",gsrlimit:"10",prop:"imageinfo",iiprop:"url|size|extmetadata",iiurlwidth:"480",format:"json",formatversion:"2"}).forEach(([k,v])=>url.searchParams.set(k,v));
 const data=await fetchJson(url.toString(),11000);
 return (data.query?.pages||[]).filter(p=>p.imageinfo?.[0]&&p.title);
}
function toCandidate(item,result){
 const info=result.imageinfo?.[0]||{},title=result.title||"";
 if(blocked.test(title)||!/\.(?:jpg|jpeg|png)$/i.test(title))return null;
 if(Number(info.width)<350||Number(info.height)<270||!info.thumburl)return null;
 const ext=info.extmetadata||{};
 const license=htmlText(ext.LicenseShortName?.value);
 if(!/^(?:CC0|CC BY(?:-SA)?(?: |$)|Public domain)/i.test(license))return null;
 const score=photoScore(item,title);
 if(score<=0)return null;
 const source="https://commons.wikimedia.org/wiki/"+encodeURIComponent(title.replace(/ /g,"_"));
 const thumb=new URL(info.thumburl);
 if(thumb.protocol!=="https:"||thumb.hostname!=="upload.wikimedia.org")return null;
 return {
   id:item.id,name:item.name,size:item.size||"",photo_url:thumb.href,
   source,license,credit:htmlText(ext.Artist?.value)||"Wikimedia Commons photographer",
   photo_title:title,score,
   photo_kind:"licensed_reference_not_stock",
 };
}
async function main(){
 const start=Date.now(),list=await products();
 console.log("CHALIN_SOURCE_INVENTORY|"+list.length);
 const selected=list.slice(0,MAX_PRODUCTS);
 let counter=0,found=0,notFound=0,errors=0,rateLimited=0;
 const used=new Set(),results=[];
 async function worker(){
  while(true){
   const idx=counter++;
   if(idx>=selected.length||Date.now()-start>MAX_MS)return;
   const item=selected[idx];
   try{
    const c=await commonsCandidates(item);
    const options=c.map(p=>toCandidate(item,p)).filter(Boolean).sort((a,b)=>b.score-a.score);
    const best=options.find(o=>!used.has(o.photo_url));
    if(best){
      used.add(best.photo_url);
      results.push(best);
      console.log("CHALIN_MATCH|"+JSON.stringify(best));
      found++;
    }else notFound++;
   }catch(e){
    errors++;
    if(e.httpStatus===429)rateLimited++;
    if(errors<=12)console.log("CHALIN_RESEARCH_ERROR|"+item.id+"|"+String(e.message||e).slice(0,100));
    if(rateLimited>=8){console.log("CHALIN_RESEARCH_HALTED|Wikimedia API rate-limited requests");return;}
   }
   if(idx%30===0)console.log("CHALIN_PROGRESS|"+JSON.stringify({processed:idx+1,found,notFound,errors}));
   await wait(520);
  }
 }
 await Promise.all(Array.from({length:WORKERS},()=>worker()));
 console.log("CHALIN_DONE|"+JSON.stringify({source:list.length,attempted:found+notFound+errors,matched:found,notFound,errors,rateLimited,seconds:Math.round((Date.now()-start)/1000)}));
}
main().catch(e=>{console.error("CHALIN_ABORT|"+e.message);process.exitCode=1;});
