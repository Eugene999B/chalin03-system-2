import {useEffect,useState} from "react";
import "../styles/realPhotos.css";
export default function RealPhoto({photo:image,className="",eager=false}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>{setFailed(false);},[image?.src]);
 if(!image)return null;
 return <figure className={"real-photo "+className}>
  {failed?<div className="real-photo__unavailable" role="img" aria-label={"Verified photo unavailable for "+image.alt}>
    <span>CHALIN03 · PHOTO REFERENCE</span>
    <strong>{image.alt}</strong>
    <small>Verified photo temporarily unavailable</small>
   </div>:
   <img src={image.src} alt={image.alt} loading={eager?"eager":"lazy"} decoding="async"
    fetchPriority={eager?"high":"auto"} width="960" height="640"
    onError={()=>setFailed(true)}/>}
  {!failed?<figcaption><a href={image.source} rel="noopener noreferrer" target="_blank">
   Real photo · {image.credit} · {image.license}</a></figcaption>:null}
 </figure>;
}
