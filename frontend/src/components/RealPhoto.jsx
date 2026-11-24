import {useEffect,useMemo,useState} from "react";
import "../styles/realPhotos.css";

/**
 * Production first attempts the locally cached real licensed photograph.
 * Browser preview and local development use the original Wikimedia CDN.
 * A failed local asset tries the approved remote image once. Never substitute
 * a different item or use AI artwork as an image fallback.
 */
export default function RealPhoto({photo:image,className="",eager=false}){
 const [sourceIndex,setSourceIndex]=useState(0);
 const sources=useMemo(()=>{
  if(!image)return [];
  const hostname=typeof window!=="undefined"?window.location.hostname.toLowerCase():"";
  const official=hostname==="chalin03.com"||hostname.endsWith(".chalin03.com");
  return [...new Set([...(official&&image.localSrc?[image.localSrc]:[]),image.src,image.src?.replace("/960px-","/1280px-"),image.original].filter(Boolean))];
 },[image]);
 useEffect(()=>{setSourceIndex(0);},[image?.src,image?.localSrc]);
 if(!image)return null;
 const failed=sourceIndex>=sources.length;
 return <figure className={"real-photo "+className}>
  {failed?<div className="real-photo__unavailable" role="img" aria-label={"Verified photo unavailable for "+image.alt}>
    <span>CHALIN03 · PHOTO REFERENCE</span>
    <strong>{image.alt}</strong>
    <small>Ask us for current photographs</small>
   </div>:
   <img src={sources[sourceIndex]} alt={image.alt} loading={eager?"eager":"lazy"} decoding="async"
    fetchPriority={eager?"high":"auto"} width="960" height="640"
    onError={()=>setSourceIndex(i=>i+1)}/>}
  {!failed?<figcaption><a href={image.source} rel="noopener noreferrer" target="_blank">
   Photo: {image.credit}{image.licenseUrl?"":" · "+image.license}</a>{image.licenseUrl?<>{" · "}<a href={image.licenseUrl} rel="noopener noreferrer" target="_blank">{image.license}</a>{" · "+image.changes}</>:null}</figcaption>:null}
 </figure>;
}
