import {useEffect,useMemo,useRef,useState} from "react";
import {useNavigate} from "react-router";
import axiosClient from "../api/axiosClient";
import VerifiedPhotoStudio from "../components/VerifiedPhotoStudio";
import {compressProductPhoto} from "../utils/verifiedPhotoUploads";
import {useAuth} from "../context/AuthContext";
import {API_BASE_URL} from "../api/apiBaseUrl";
import {photoNeedsReview,referenceSkuPhoto} from "../data/catalogueReferencePhotos";
import "../styles/websiteCommerceStaff.css";

const money=v=>"GHS "+Number(v||0).toLocaleString("en-GH",{minimumFractionDigits:2,maximumFractionDigits:2});
const statuses=["all","new","contacted","quoted","fulfilled","cancelled"];
function messageOf(error,fallback){return error?.response?.data?.message||fallback}
const PHOTO_LABELS={verified_exact:"Verified exact",honest_reference:"Honest reference",needs_review:"Needs review",missing:"Missing"};
const EMPTY_PHOTO={status:"verified_exact",owner:"",license:"",source_url:"",evidence:""};
function cataloguePhoto(product){
 if(product.photo?.url)return product.photo;
 const reference=referenceSkuPhoto(product);
 if(reference)return {...reference,status:"honest_reference",url:reference.localSrc,owner:reference.credit,source_url:reference.source};
 if(photoNeedsReview(product))return {status:"needs_review"};
 return product.photo||{status:product.existing_image?"needs_review":"missing"};
}
function photoUrl(path){return path?.startsWith("/api/")?API_BASE_URL.replace(/\/api$/,"")+path:path;}
export default function WebsiteCommerceControlPage({mode="orders"}){
 const {user,branchId}=useAuth();
 const navigate=useNavigate();
 const admin=String(user?.role||"").toLowerCase()==="admin";
 const [orders,setOrders]=useState([]);
 const [products,setProducts]=useState([]);
 const [status,setStatus]=useState("all"),[search,setSearch]=useState("");
 const [loading,setLoading]=useState(false),[error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [saving,setSaving]=useState("");
 const [edit,setEdit]=useState(null);
 const [saleInputs,setSaleInputs]=useState({});
 const [paymentInputs,setPaymentInputs]=useState({});
 const [uploading,setUploading]=useState(false);
 const [photoView,setPhotoView]=useState("all");
 const [photoStudioOpen,setPhotoStudioOpen]=useState(false);
 const [photoApproved,setPhotoApproved]=useState(false);
 const [photoForm,setPhotoForm]=useState(EMPTY_PHOTO);
 const [preview,setPreview]=useState("");
 const previewId=useRef(null);
 const isCatalog=mode==="catalogue";
 const photoWorkflowAvailable=products.some(p=>p.photo);
 async function reload(){
  setLoading(true);setError("");
  try{
   if(isCatalog){
    const r=await axiosClient.get("/public-commerce/staff/products");
    setProducts(r.data.products||[]);
   }else{
    const r=await axiosClient.get("/public-commerce/staff/requests",{
      params:{status:status==="all"?"":status,search,limit:100}});
    setOrders(r.data.requests||[]);
   }
  }catch(e){setError(messageOf(e,"Unable to load online commerce."))}
  finally{setLoading(false)}
 }
 useEffect(()=>{reload();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[mode,branchId,status]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
 const filteredProducts=useMemo(()=>products.filter(p=>
  [p.id,p.name,p.category,p.size].some(v=>String(v||"").toLowerCase().includes(search.toLowerCase())) &&
  (photoView==="all"||cataloguePhoto(p).status===photoView)
 ),[products,search,photoView]);
 const photoProgress=useMemo(()=>products.filter(p=>p.is_active&&p.is_visible).reduce((counts,p)=>{
  counts[cataloguePhoto(p).status]++;
  return counts;
 },{verified_exact:0,honest_reference:0,needs_review:0,missing:0}),[products]);
 const filteredOrders=useMemo(()=>orders.filter(r=>
  [r.reference_code,r.customer_name,r.customer_phone,r.subject,r.request_type].some(v=>
   String(v||"").toLowerCase().includes(search.toLowerCase()))),[orders,search]);
 async function statusChange(id,value){
  setSaving(String(id));setError("");setMessage("");
  try{
   const r=await axiosClient.patch("/public-commerce/staff/requests/"+id+"/status",{status:value});
   setMessage(r.data.message);await reload();
  }catch(e){setError(messageOf(e,"Could not update customer follow-up."));}
  finally{setSaving("")}
 }
 function moveToPOS(order){
  sessionStorage.setItem("chalin03_web_order_prefill",JSON.stringify({
   id:order.id,reference:order.reference_code,branch_id:1,
   customer_name:order.customer_name,customer_phone:order.customer_phone,
   customer_location:order.customer_location,
   items:order.items.map(item=>({product_id:Number(item.product_id),quantity:Number(item.quantity)}))
  }));
  navigate("/new-sale?web_order="+order.id);
 }
 async function linkSale(order){
  setSaving(String(order.id));setError("");setMessage("");
  try{
   const {data}=await axiosClient.post("/public-commerce/staff/requests/"+order.id+"/fulfill",{
    sale_id:Number(saleInputs[order.id]||0),payment_method:paymentInputs[order.id]||"cash"});
   setMessage(data.message);await reload();
  }catch(e){setError(messageOf(e,"Could not verify the paid POS sale."));}
  finally{setSaving("")}
 }
 function updatePhoto(id,photo){
  const patch={photo,existing_image:photo?.status==="verified_exact"};
  setProducts(previous=>previous.map(p=>p.id===id?{...p,...patch}:p));
  setEdit(previous=>previous?.id===id?{...previous,...patch}:previous);
 }
 function closeEdit(){
  previewId.current=null;
  setPreview("");
  setEdit(null);
 }
 function openEdit(product){
  const photo=cataloguePhoto(product);
  setPhotoApproved(false);
  setPhotoForm(photo.url?{...EMPTY_PHOTO,...photo}:EMPTY_PHOTO);
  setEdit({...product});
  if((!product.is_visible||!product.is_active||photo.status==="needs_review")&&product.photo?.status!=="missing"){
   previewId.current=product.id;
   axiosClient.get("/public-commerce/staff/products/"+product.id+"/photo",{responseType:"blob"}).then(({data})=>{
    if(previewId.current===product.id)setPreview(URL.createObjectURL(data));
   }).catch(()=>{});
  }
 }
 async function uploadPhoto(file){
  if(!file||!edit)return;
  if(!photoApproved){setError("Confirm the photo matches this exact SKU before uploading.");return;}
  setUploading(true);setError("");setMessage("");
  try{
   const image_data_url=await compressProductPhoto(file);
   const {data}=await axiosClient.post("/public-commerce/staff/products/"+edit.id+"/photo",
    {image_data_url,photo_status:photoForm.status,photo_source_url:photoForm.source_url,
     photo_owner:photoForm.owner,photo_license:photoForm.license,photo_evidence:photoForm.evidence,
     photo_confirmed:photoApproved,replace_photo:true},{timeout:45000});
   setMessage(data.message+" SKU #"+edit.id+".");
   updatePhoto(edit.id,data.photo);
   if(!edit.is_visible||!edit.is_active){
    const response=await axiosClient.get("/public-commerce/staff/products/"+edit.id+"/photo",{responseType:"blob"});
    if(previewId.current===edit.id)setPreview(URL.createObjectURL(response.data));
   }else{setPreview("");}
   setPhotoApproved(false);
  }catch(error){setError(messageOf(error,"Product photo upload failed."));}
  finally{setUploading(false)}
 }
 async function saveCatalogue(){
  if(!edit)return;
  setSaving(String(edit.id));setError("");setMessage("");
  try{
   const {data}=await axiosClient.patch("/public-commerce/staff/products/"+edit.id,{
    is_visible:Boolean(edit.is_visible),is_featured:Boolean(edit.is_featured),
    image_url:edit.image_url||"",category_override:edit.category_override||"",
    description:edit.description||""
   });
   setMessage(data.message);closeEdit();await reload();
  }catch(e){setError(messageOf(e,"Could not save website product settings."));}
  finally{setSaving("")}
 }
 return <main className="wc-staff">
  <div className="wc-staff-hero"><div><span>CHALIN03 · WEBSITE COMMERCE</span>
    <h1>{isCatalog?"Online product display":"Customer orders & enquiries"}</h1>
    <p>{isCatalog?
     "Control which real Main Store items appear on the website. Master prices are edited through the existing protected Products page.":
     "All website orders, heavy-equipment quotations and customer messages arrive here. An enquiry does not deduct stock or collect money."}</p>
   </div><div className="wc-staff-stats"><strong>{isCatalog?products.length:orders.length}</strong><span>{isCatalog?"MAIN products":"Requests shown"}</span></div></div>
  <div className="wc-staff-toolbar"><input placeholder={isCatalog?"Search SKU, name, category or size":"Search customer, phone or request"}
     value={search} onChange={e=>setSearch(e.target.value)}/>
   {!isCatalog?<select value={status} onChange={e=>setStatus(e.target.value)}>
    {statuses.map(v=><option key={v} value={v}>{v==="all"?"All statuses":v.replace("_"," ")}</option>)}</select>:null}
   <button type="button" onClick={reload}>↻ Refresh</button>
   {isCatalog?<><select aria-label="Product photo status" value={photoView} onChange={e=>setPhotoView(e.target.value)}>
     <option value="all">All product photos</option>{Object.entries(PHOTO_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
     <button type="button" disabled={!photoWorkflowAvailable} onClick={()=>setPhotoStudioOpen(v=>!v)}>{photoStudioOpen?"Close verified photo studio":"Open verified photo studio"}</button>
      <button type="button" onClick={()=>navigate("/products")}>+ Add product in MAIN store</button></>:null}
  </div>
  {message?<p className="wc-staff-success" role="status">{message}</p>:null}
  {error?<p className="wc-staff-error" role="alert">{error}</p>:null}
  {loading?<p className="wc-staff-loading">Loading website commerce…</p>:null}
  {isCatalog?
   <><div className="wc-staff-intro"><h2>Publish products online</h2>
    <p>Manage online photos and listings. Selling prices come from the Main Store.</p>
    <div className="wc-inline-actions" aria-label="Published photo progress">{Object.entries(PHOTO_LABELS).map(([key,label])=>
     <span key={key} className="wc-chip">{label} · {photoProgress[key]}</span>)}</div></div>
    {!photoWorkflowAvailable&&products.length?<p role="status">Photo uploads are unavailable until the catalogue API updates.</p>:null}
    {photoStudioOpen&&admin?<VerifiedPhotoStudio products={products}
      onChanged={updatePhoto}
      onClose={()=>setPhotoStudioOpen(false)}/>:null}
     <div className="wc-product-list">{filteredProducts.map(product=>{
      const photo=cataloguePhoto(product);
      return <article key={product.id} className="wc-product-line">
     <div className="wc-product-identification">
       <div className="wc-product-thumb">
        {photo.url&&(product.is_active&&product.is_visible||!photo.url.startsWith("/api/"))?<img key={photo.url} src={photoUrl(photo.url)}
          alt={(photo.status==="honest_reference"?"Reference photo for ":"Photo of ")+product.name} loading="lazy" width="84" height="84"
          onError={e=>{e.currentTarget.hidden=true;}}/>:<span>{PHOTO_LABELS[photo.status]}</span>}
       </div>
       <div><small>#{product.id} · {product.category}</small><h3>{product.name}</h3>
      <p>{product.size||"No size recorded"} · {money(product.selling_price)} · Stock {product.quantity}</p>
      {photo.owner?<p>{photo.source_url?<a href={photo.source_url} target="_blank" rel="noreferrer">{photo.owner}</a>:photo.owner} · {photo.license}</p>:null}</div></div>
     <div className="wc-inline-actions"><span className={product.is_visible?"wc-chip live":"wc-chip"}>
       {product.is_visible?"Published":"Hidden"}</span>
      {product.is_featured?<span className="wc-chip gold">Featured</span>:null}
       <span className={product.existing_image?"wc-chip live":"wc-chip"}>{PHOTO_LABELS[photo.status]}</span>
      <button type="button" onClick={()=>openEdit(product)}>Edit online display</button>
      <button type="button" onClick={()=>navigate("/products")}>Manage product & price →</button>
     </div></article>})}</div>
    {!filteredProducts.length&&!loading?<p>No products match your search.</p>:null}
   </>:
   <><div className="wc-staff-intro"><h2>Manage customer requests</h2><p><strong>New → Contacted → Quoted → Fulfilled.</strong>
     First confirm the order with the customer. To finish a spare-parts sale, use <strong>New Sale</strong> (the normal POS) and record genuine payment. Then link that fully paid POS sale here. POS alone updates inventory, Daily Sales and closing totals; a web request never deducts stock.</p></div>
    <div className="wc-order-list">{filteredOrders.map(order=><article className="wc-order-card" key={order.id}>
     <header><div><span className="wc-order-ref">{order.reference_code}</span>
      <h3>{order.customer_name}</h3><p>{order.request_type.replaceAll("_"," ")} · {new Date(order.created_at).toLocaleString("en-GH")}</p></div>
      <span className={"wc-chip "+(order.status==="fulfilled"?"live":"")}>{order.status}</span></header>
     <div className="wc-order-contact">
      <span><b>Phone:</b> <a href={"tel:"+order.customer_phone}>{order.customer_phone}</a></span>
      <span><b>Location:</b> {order.customer_location}</span>
      {order.customer_email?<span><b>Email:</b> <a href={"mailto:"+order.customer_email}>{order.customer_email}</a></span>:null}
      <a target="_blank" rel="noreferrer" href={"https://wa.me/"+String(order.customer_phone).replace(/\D/g,"").replace(/^0/,"233")+"?text="+encodeURIComponent("Hello "+order.customer_name+", we are following up your CHALIN03 request "+order.reference_code+".")}>WhatsApp customer ↗</a>
     </div>
     {order.subject||order.message?<div className="wc-order-note"><strong>{order.subject||"Customer note"}</strong>
      <p>{order.message||"No additional message"}</p></div>:null}
     {order.items.length?<div className="wc-order-items">
      {order.items.map(item=><div key={item.product_id}><span>{item.product_name_snapshot} × {item.quantity}</span>
       <strong>{money(Number(item.unit_price_snapshot)*Number(item.quantity))}</strong></div>)}
      <div className="wc-order-total"><span>Submitted items subtotal (before POS tax)</span><b>{money(order.estimated_total)}</b></div>
     </div>:null}
     <div className="wc-order-actions">
      {["new","contacted","quoted"].includes(order.status)?
       <><button type="button" disabled={saving===String(order.id)} onClick={()=>statusChange(order.id,"contacted")}>Mark contacted</button>
       <button type="button" disabled={saving===String(order.id)} onClick={()=>statusChange(order.id,"quoted")}>Mark quoted</button>
       <button type="button" disabled={saving===String(order.id)} onClick={()=>statusChange(order.id,"cancelled")}>Cancel request</button></>:null}
      {order.request_type==="parts_order"&&order.status!=="cancelled"&&order.status!=="fulfilled"?<>
       <button type="button" className="wc-primary-action" onClick={()=>moveToPOS(order)}>Record paid sale in POS →</button>
       <div className="wc-pos-link"><label>Already sold? Enter POS sale ID<input type="number" min="1" value={saleInputs[order.id]||""}
        onChange={e=>setSaleInputs(v=>({...v,[order.id]:e.target.value}))}/></label>
        <label>Verified payment method<select value={paymentInputs[order.id]||"cash"}
         onChange={e=>setPaymentInputs(v=>({...v,[order.id]:e.target.value}))}>
          <option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank">Bank transfer</option>
         </select></label>
        <button type="button" disabled={saving===String(order.id)||!Number(saleInputs[order.id])}
         onClick={()=>linkSale(order)}>Verify POS receipt & fulfil</button>
       </div></>:null}
      {order.status==="fulfilled"?<span className="wc-linked">Paid POS sale #{order.linked_sale_id} · {order.payment_method}</span>:null}
     </div>
    </article>)}</div>
    {!filteredOrders.length&&!loading?<p className="wc-staff-loading">No matching enquiries yet.</p>:null}
   </>}
  {edit&&admin?<div className="wc-modal-cover" onClick={()=>{if(!uploading)closeEdit()}}>
    <section className="wc-modal" aria-label="Edit online display" onClick={e=>e.stopPropagation()}>
     <header><h2>{edit.name}</h2><button type="button" aria-label="Close" disabled={uploading} onClick={closeEdit}>✕</button></header>
     <p>Master price: <strong>{money(edit.selling_price)}</strong>. Changing it requires the existing protected Product / price-approval screen.</p>
     <label className="wc-toggle"><input type="checkbox" checked={edit.is_visible}
      onChange={e=>setEdit(v=>({...v,is_visible:e.target.checked}))}/> Publish on website</label>
     <label className="wc-toggle"><input type="checkbox" checked={edit.is_featured}
      onChange={e=>setEdit(v=>({...v,is_featured:e.target.checked}))}/> Feature product</label>
     <label>Website category<input value={edit.category_override||""}
      onChange={e=>setEdit(v=>({...v,category_override:e.target.value}))}
      placeholder={edit.category}/></label>
     <label>Short product description<textarea rows={3} value={edit.description||""}
      onChange={e=>setEdit(v=>({...v,description:e.target.value}))}/></label>
     {preview||cataloguePhoto(edit).url?<img className="wc-photo-preview" src={preview||photoUrl(cataloguePhoto(edit).url)} alt={"Current photo for "+edit.name}/>:null}
     <label>Photo match<select value={photoForm.status} disabled={uploading}
       onChange={e=>{setPhotoForm(v=>({...v,status:e.target.value}));setPhotoApproved(false)}}>
      <option value="verified_exact">Verified exact</option>
      <option value="honest_reference">Honest reference</option>
     </select></label>
     <label>Original photo source{photoForm.status==="honest_reference"?" (required)":""}
      <input type="url" maxLength={1000} value={photoForm.source_url||""} disabled={uploading} onChange={e=>setPhotoForm(v=>({...v,source_url:e.target.value}))}/></label>
     <label>Copyright owner<input maxLength={180} value={photoForm.owner} disabled={uploading} onChange={e=>setPhotoForm(v=>({...v,owner:e.target.value}))}/></label>
     <label>Licence or reuse permission<input maxLength={300} value={photoForm.license} disabled={uploading} onChange={e=>setPhotoForm(v=>({...v,license:e.target.value}))}/></label>
     <label>Match evidence<textarea rows={2} maxLength={600} value={photoForm.evidence} disabled={uploading} onChange={e=>setPhotoForm(v=>({...v,evidence:e.target.value}))}/></label>
     <label className="wc-toggle wc-photo-approval">
       <input type="checkbox" checked={photoApproved} disabled={uploading}
        onChange={e=>setPhotoApproved(e.target.checked)}/>
       I confirm commercial reuse is permitted and this photograph {photoForm.status==="honest_reference"?
        "shows the correct part type for":"matches the brand, model and size of"} Main Store SKU #{edit.id}.
      </label>
      <label>Upload or replace the photo for SKU #{edit.id}
       <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!photoWorkflowAvailable||uploading||!photoApproved||
        !photoForm.owner.trim()||!photoForm.license.trim()||!photoForm.evidence.trim()||
        (photoForm.status==="honest_reference"&&!photoForm.source_url?.trim())}
        onChange={event=>{uploadPhoto(event.target.files?.[0]);event.target.value="";}}/>
       {uploading?<small>Optimising and uploading the verified photograph…</small>:null}
      </label>
     <div className="wc-inline-actions"><button type="button" className="wc-primary-action" disabled={Boolean(saving)||uploading}
      onClick={saveCatalogue}>{saving?"Saving…":"Save online display"}</button>
      <button type="button" disabled={uploading} onClick={closeEdit}>Cancel</button></div>
    </section>
   </div>:null}
 </main>;
}
