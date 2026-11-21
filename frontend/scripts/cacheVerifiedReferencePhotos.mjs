/**
 * Production-only first-party cache of properly attributed real Wikimedia
 * equipment photography. Copies 960px, verified licensed thumbnails into
 * Vite's public directory, served from the official CHALIN03 website host.
 * No new paid storage service, database writes or SKU changes.
 *
 * If a remote image is unavailable, skip that asset; RealPhoto automatically
 * falls back to its trusted Wikimedia direct image, then truthful text.
 */
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PHOTO_LIBRARY} from "../src/data/verifiedPublicPhotos.js";

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SAFE_OUTPUT_DIR=path.resolve(root,"public/images/verified-reference");
const enabled=process.env.CF_PAGES_BRANCH==="production"
  || process.env.CHALIN03_DOWNLOAD_REAL_PHOTOS==="1";
const items=[...new Map(Object.values(PHOTO_LIBRARY).map(p=>[p.localSrc,p])).values()];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MAX_BYTES=2_500_000;
const ATTEMPTS=3;
const TIMEOUT_MS=11_000;

export function verifyReferencePhoto(photo){
  if(!photo||typeof photo.localSrc!=="string"
    ||!/^\/images\/verified-reference\/[a-z0-9-]+\.jpg$/.test(photo.localSrc)){
    throw new Error("Invalid local photo destination");
  }
  const imageUrl=new URL(photo.src);
  const creditUrl=new URL(photo.source);
  if(imageUrl.protocol!=="https:"||imageUrl.hostname!=="upload.wikimedia.org"
    ||!/^\/wikipedia\/commons\/thumb\/[a-f0-9]\/([a-f0-9]{2})\/.+\/960px-.+\.(?:jpg|JPG)$/.test(imageUrl.pathname)
    ||creditUrl.protocol!=="https:"||creditUrl.hostname!=="commons.wikimedia.org"
    ||!creditUrl.pathname.startsWith("/wiki/File:")){
    throw new Error("Only exact verified HTTPS Wikimedia Commons thumbnails can be mirrored");
  }
  if(!photo.credit||!photo.license){
    throw new Error("Image license and author attribution required");
  }
  return true;
}

async function downloadOne(photo){
  verifyReferencePhoto(photo);
  const filename=photo.localSrc.split("/").at(-1);
  const localPath=path.resolve(SAFE_OUTPUT_DIR,filename);
  if(path.dirname(localPath)!==SAFE_OUTPUT_DIR)throw new Error("Unsafe photo cache destination");
  for(let attempt=1;attempt<=ATTEMPTS;attempt++){
    try{
      const response=await fetch(photo.src,{
        headers:{
          "Accept":"image/jpeg",
          // Wikimedia requests a descriptive User-Agent and a real referrer.
          "User-Agent":"CHALIN03PublicWebsite/1.0 (https://chalin03.com/customer-help; source-photo-cache)",
          "Referer":photo.source,
        },
        signal:AbortSignal.timeout(TIMEOUT_MS),
      });
      if(!response.ok)throw new Error("HTTP "+response.status);
      const contentType=response.headers.get("content-type")||"";
      if(!contentType.toLowerCase().startsWith("image/jpeg"))
        throw new Error("Source did not return JPEG: "+contentType);
      const length=Number(response.headers.get("content-length")||"0");
      if(length>MAX_BYTES)throw new Error("Reference photo exceeds 2.5 MB");
      if(new URL(response.url).hostname!=="upload.wikimedia.org"){
        throw new Error("Unexpected remote image redirect");
      }
      if(!response.body)throw new Error("Empty JPEG response stream");
      const reader=response.body.getReader(),chunks=[];
      let received=0;
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        received+=value.byteLength;
        if(received>MAX_BYTES){
          await reader.cancel();
          throw new Error("JPEG response exceeds the capped 2.5 MB streaming limit");
        }
        chunks.push(Buffer.from(value));
      }
      const bytes=Buffer.concat(chunks,received);
      if(bytes.length<500||bytes.length>MAX_BYTES||bytes[0]!==0xff||bytes[1]!==0xd8)
        throw new Error("Invalid/oversize JPEG source");
      await mkdir(SAFE_OUTPUT_DIR,{recursive:true});
      await writeFile(localPath,bytes);
      return {ok:true,bytes:bytes.length};
    }catch(error){
      if(attempt===ATTEMPTS)return {ok:false,reason:String(error?.message||error).slice(0,130)};
      await sleep(650*attempt);
    }
  }
  return {ok:false,reason:"Unexpected image fetch issue"};
}
export async function cacheVerifiedReferencePhotos(){
  if(!enabled){
    console.log("Skipping licensed static image caching outside production Cloudflare Pages.");
    return {skipped:true};
  }
  console.log("Caching "+items.length+" distinct licensed equipment photos for CHALIN03 first-party delivery.");
  let index=0;
  const output=[];
  async function worker(){
    while(index<items.length){
      const photo=items[index++];
      const result=await downloadOne(photo);
      output.push({...result,local:photo.localSrc});
      if(!result.ok)console.warn("Reference source unavailable: "+photo.localSrc+" ("+result.reason+"); browser CDN fallback retained");
      await sleep(160);
    }
  }
  await Promise.all([worker(),worker()]);
  const ok=output.filter(x=>x.ok);
  const total=ok.reduce((sum,x)=>sum+x.bytes,0);
  console.log("CHALIN03 real photos copied: "+ok.length+"/"+items.length+"; total "+(total/1024/1024).toFixed(2)+" MiB. Remaining images retain verified external fallback.");
  return {success:ok.length,total:items.length,bytes:total};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await cacheVerifiedReferencePhotos();
}
