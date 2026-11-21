import {useEffect,useMemo,useRef,useState} from "react";
import axiosClient from "../api/axiosClient";
import {compressProductPhoto,downloadPhotoShotList,identifyProductPhotoFilename,photoShotListCsv,safePhotoFilename} from "../utils/verifiedPhotoUploads";
import "../styles/verifiedPhotoStudio.css";

const LIMIT=40;
function note(error,fallback){
 return error?.response?.data?.message||error?.message||fallback;
}
export default function VerifiedPhotoStudio({products=[],onChanged,onClose}){
 const [queue,setQueue]=useState([]);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState("");
 const [error,setError]=useState("");
 const [owner,setOwner]=useState("");
 const [license,setLicense]=useState("");
 const urls=useRef([]);
 useEffect(()=>()=>{urls.current.forEach(u=>URL.revokeObjectURL(u));urls.current=[];},[]);
 const stats=useMemo(()=>{
  const published=products.filter(p=>p.is_active!==false&&p.is_visible!==false);
  return {published:published.length,
    withPhoto:published.filter(p=>p.existing_image).length,
    missing:published.filter(p=>!p.existing_image).length};
 },[products]);
 const ready=queue.filter(x=>x.product&&!x.error&&x.confirmed&&x.status==="pending");
 const finished=queue.filter(x=>x.status==="uploaded").length;
 function selectFiles(selection){
  if(busy)return;
  urls.current.forEach(u=>URL.revokeObjectURL(u));urls.current=[];
  setNotice("");setError("");
  const list=Array.from(selection||[]).slice(0,LIMIT);
  const duplicate=new Set();
  const next=list.map((file,i)=>{
    const identified=identifyProductPhotoFilename(file.name,products);
    let validation=identified.error||"";
    if(!validation&&!["image/jpeg","image/png","image/webp"].includes(file.type))
      validation="Only photographs saved as JPEG, PNG or WebP are accepted.";
    if(!validation&&file.size>16*1024*1024)validation="Photo exceeds 16 MB.";
    if(!validation&&duplicate.has(identified.id))validation="Two photos match this SKU. Keep one clear photo in this batch.";
    if(identified.id)duplicate.add(identified.id);
    let url="";
    if(file.type.startsWith("image/")&&file.size<=16*1024*1024){
      url=URL.createObjectURL(file);urls.current.push(url);
    }
    return {key:String(i)+"-"+file.name,file,url,id:identified.id||null,
      product:identified.product||null,error:validation,
      confirmed:false,status:"pending"};
  });
  setQueue(next);
  if(Array.from(selection||[]).length>LIMIT)
    setNotice("Only the first "+LIMIT+" images were added. Upload these first, then choose the next batch.");
 }
 function confirm(key,checked){setQueue(old=>old.map(x=>x.key===key?{...x,confirmed:checked}:x))}
 function update(key,patch){setQueue(old=>old.map(x=>x.key===key?{...x,...patch}:x))}
 async function upload(){
  if(busy||!ready.length||!owner.trim()||!license.trim())return;
  setBusy(true);setNotice("");setError("");
  let uploaded=0,failed=0;
  // A confirmed file is sent only to its exact product ID; the user reviews the
  // preview and name before this loop. Never infer a SKU from photo similarity.
  for(const item of ready){
    update(item.key,{status:"compressing"});
    try{
      const image_data_url=await compressProductPhoto(item.file);
      update(item.key,{status:"uploading"});
      const {data}=await axiosClient.post("/public-commerce/staff/products/"+item.id+"/photo",{
       image_data_url,photo_status:"verified_exact",photo_confirmed:true,
       photo_owner:owner,photo_license:license,
       photo_evidence:"Staff matched the photograph to SKU #"+item.id+" "+item.product.name+
        (item.product.size?" ("+item.product.size+")":"")+" and confirmed the visible part and stock identity."
      },{timeout:45000});
      update(item.key,{status:"uploaded",confirmed:false,error:""});
      onChanged?.(item.id,data.photo);
      uploaded++;
    }catch(err){
      update(item.key,{status:"pending",error:note(err,"Photo could not be uploaded. Check and retry individually."),confirmed:false});
      failed++;
    }
  }
  setNotice(uploaded+" exact-SKU photograph"+(uploaded===1?" was":"s were")+" saved to the online catalogue."+
    (failed?" "+failed+" file"+(failed===1?" needs":"s need")+" correction.":""));
  setBusy(false);
 }
 const csvRows=useMemo(()=>photoShotListCsv(products).split("\r\n").length-2,[products]);
 return <section className="photo-studio" aria-labelledby="photo-studio-heading">
  <div className="photo-studio__header">
   <div><span className="photo-studio__eyebrow">CHALIN03 · REAL PRODUCT PHOTOGRAPHY</span>
    <h2 id="photo-studio-heading">Verified item photo studio</h2>
    <p>Photograph the actual product, label it with the correct Main Store SKU, review the match, then publish. No generated pictures, no repeated category images and no changes to stock or price.</p></div>
   <button type="button" className="photo-studio__close" onClick={onClose} disabled={busy}>Close photo studio</button>
  </div>
  <div className="photo-studio__stats">
   <div><strong>{stats.published}</strong><span>Published Main Store items</span></div>
   <div><strong>{stats.withPhoto}</strong><span>With a recorded item photograph</span></div>
   <div><strong>{stats.missing}</strong><span>Photos still required</span></div>
  </div>
  <div className="photo-studio__steps">
   <div><span>01</span><strong>Download the SKU photo list</strong>
    <p>Get each product's actual stock ID, name, specification and recommended photo filename. {csvRows} rows are awaiting a photo.</p>
    <button type="button" onClick={()=>downloadPhotoShotList(products)}>Download photo shot list (.csv)</button>
   </div>
   <div><span>02</span><strong>Photograph the real item</strong>
    <p>Take a clear picture with a phone, showing the whole part. Confirm the brand, size and model on the label or packaging. Name it like:</p>
    <code>{safePhotoFilename(products.find(p=>p.is_visible!==false&&!p.existing_image)||{id:25,name:"1105 Engine"})}</code>
   </div>
   <div><span>03</span><strong>Match and approve before upload</strong>
    <p>Select up to {LIMIT} photographs. Check the preview and full SKU name, then approve the match individually. Photos are compressed before upload.</p>
    <label className="photo-studio__select">
     <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy}
       onChange={e=>{selectFiles(e.target.files);e.target.value="";}}/>
     Choose actual product photos
    </label>
   </div>
  </div>
  {error?<p role="alert" className="photo-studio__error">{error}</p>:null}
  {notice?<p role="status" className="photo-studio__notice">{notice}</p>:null}
  {queue.length?<div className="photo-studio__review">
   <div className="photo-studio__review-header"><div><h3>Review each image match</h3>
    <p>A similar-looking part is not enough. Compare the actual product and manufacturer markings before approving.</p></div>
    <span>{ready.length} selected for upload · {finished} saved</span></div>
   <div className="photo-studio__rights">
    <label>Copyright owner<input maxLength={180} value={owner} disabled={busy} onChange={e=>setOwner(e.target.value)}/></label>
    <label>Reuse permission for this batch<input maxLength={300} value={license} disabled={busy} onChange={e=>setLicense(e.target.value)}/></label>
   </div>
   <div className="photo-studio__list">
    {queue.map(item=><article className={"photo-studio__item"+(item.error?" has-error":"")} key={item.key}>
     <div className="photo-studio__preview">{item.url?<img src={item.url} alt={"Review actual item photograph "+item.file.name} loading="lazy"/>:<span>Photo preview unavailable</span>}</div>
     <div className="photo-studio__details">
      <small>{item.file.name}</small>
      {item.product?<><strong>SKU #{item.id} · {item.product.name}</strong>
       <p>{item.product.size||"Size not recorded"} · {item.product.category||"Uncategorised"}</p>
       <span className="photo-studio__status">{item.status==="uploaded"?"Saved to catalogue":item.status==="compressing"?"Optimising image":item.status==="uploading"?"Uploading exact SKU":item.error?"Needs correction":"Pending human review"}</span>
      </>:<strong>Cannot identify the product record</strong>}
      {item.error?<p className="photo-studio__item-error">{item.error}</p>:null}
      {item.product&&!item.error&&item.status==="pending"?<label className="photo-studio__confirm">
       <input type="checkbox" checked={item.confirmed} onChange={e=>confirm(item.key,e.target.checked)} disabled={busy}/>
       <span>I have checked that this is a real, permitted photograph of the exact SKU #{item.id}, including its model, size and visible markings.</span>
      </label>:null}
     </div>
    </article>)}
   </div>
   <div className="photo-studio__footer">
    <p>Only manually approved photographs will upload. Existing photos cannot be silently overwritten in a batch.</p>
    <button type="button" disabled={busy||!ready.length||!owner.trim()||!license.trim()} onClick={upload}>
     {busy?"Uploading verified photographs…":"Upload "+ready.length+" verified photo"+(ready.length===1?"":"s")}
    </button>
   </div>
  </div>:null}
 </section>;
}
