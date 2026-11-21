import {useEffect,useMemo,useState} from "react";
import {useNavigate} from "react-router";
import axiosClient from "../api/axiosClient";
import {useAuth} from "../context/AuthContext";
import "../styles/websiteCommerceStaff.css";

const money=v=>"GHS "+Number(v||0).toLocaleString("en-GH",{minimumFractionDigits:2,maximumFractionDigits:2});
const statuses=["all","new","contacted","quoted","fulfilled","cancelled"];
function messageOf(error,fallback){return error?.response?.data?.message||fallback}
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
 const isCatalog=mode==="catalogue";
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
 const filteredProducts=useMemo(()=>products.filter(p=>
  [p.name,p.category,p.size].some(v=>String(v||"").toLowerCase().includes(search.toLowerCase())) &&
  (photoView==="all"||(photoView==="missing"?!p.existing_image:Boolean(p.existing_image)))
 ),[products,search,photoView]);
 const needingPhotos=products.filter(p=>p.is_visible&&!p.existing_image).length;
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
 async function uploadPhoto(file){
  if(!file||!edit)return;
  if(file.size>2800000){setError("Choose a photo under 2.8 MB.");return}
  setUploading(true);setError("");
  const source=URL.createObjectURL(file);
  try{
   const image=new Image();
   await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=source;});
   const ratio=Math.min(1,1000/Math.max(image.width,image.height));
   const canvas=document.createElement("canvas");
   canvas.width=Math.max(1,Math.round(image.width*ratio));
   canvas.height=Math.max(1,Math.round(image.height*ratio));
   canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
   const image_data_url=canvas.toDataURL("image/jpeg",0.77);
   const {data}=await axiosClient.post("/public-commerce/staff/products/"+edit.id+"/photo",
    {image_data_url},{timeout:30000});
   setMessage(data.message);setEdit(x=>({...x,existing_image:true}));
  }catch(error){setError(messageOf(error,"Product photo upload failed."));}
  finally{URL.revokeObjectURL(source);setUploading(false)}
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
   setMessage(data.message);setEdit(null);await reload();
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
  <div className="wc-staff-toolbar"><input placeholder={isCatalog?"Search product name, category or size":"Search customer, phone or request"}
     value={search} onChange={e=>setSearch(e.target.value)}/>
   {!isCatalog?<select value={status} onChange={e=>setStatus(e.target.value)}>
    {statuses.map(v=><option key={v} value={v}>{v==="all"?"All statuses":v.replace("_"," ")}</option>)}</select>:null}
   <button type="button" onClick={reload}>↻ Refresh</button>
   {isCatalog?<><select aria-label="Product photo status" value={photoView} onChange={e=>setPhotoView(e.target.value)}>
     <option value="all">All product photos</option><option value="missing">Needs item photos</option><option value="ready">Has item photo</option></select>
     <button type="button" onClick={()=>navigate("/products")}>+ Add product in MAIN store</button></>:null}
  </div>
  {message?<p className="wc-staff-success" role="status">{message}</p>:null}
  {error?<p className="wc-staff-error" role="alert">{error}</p>:null}
  {loading?<p className="wc-staff-loading">Loading website commerce…</p>:null}
  {isCatalog?
   <><div className="wc-staff-intro"><h2>Publish products online</h2>
    <p>Active products are published by default, with actual selling prices pulled live from the existing POS database. You may hide, feature, describe or attach a verified item photo without altering stock or price. The protected price approval workflow remains the only way to change a master price.</p><strong>{needingPhotos} published items still need real product-specific photographs. Use the “Needs item photos” filter above.</strong></div>
    <div className="wc-product-list">{filteredProducts.map(product=><article key={product.id} className="wc-product-line">
     <div><small>#{product.id} · {product.category}</small><h3>{product.name}</h3>
      <p>{product.size||"No size recorded"} · {money(product.selling_price)} · Stock {product.quantity}</p></div>
     <div className="wc-inline-actions"><span className={product.is_visible?"wc-chip live":"wc-chip"}>
       {product.is_visible?"Published":"Hidden"}</span>
      {product.is_featured?<span className="wc-chip gold">Featured</span>:null}
       <span className={product.existing_image?"wc-chip live":"wc-chip"}>{product.existing_image?"Item photo ready":"Photo needed"}</span>
      <button type="button" onClick={()=>setEdit({...product})}>Edit online display</button>
      <button type="button" onClick={()=>navigate("/products")}>Manage product & price →</button>
     </div></article>)}</div>
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
  {edit&&admin?<div className="wc-modal-cover" onClick={()=>setEdit(null)}>
    <section className="wc-modal" aria-label="Edit online display" onClick={e=>e.stopPropagation()}>
     <header><h2>{edit.name}</h2><button type="button" onClick={()=>setEdit(null)}>✕</button></header>
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
     <label>Upload the actual item photo (recommended)
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
        onChange={event=>uploadPhoto(event.target.files?.[0])}/>
      {uploading?<small>Uploading the photograph…</small>:null}
     </label>
     <label>Optional existing approved photo URL<input value={edit.image_url||""}
      placeholder="https://images.unsplash.com/… or CHALIN03 image path"
      onChange={e=>setEdit(v=>({...v,image_url:e.target.value}))}/></label>
     <p className="wc-photo-note">Use a real photograph of the exact stock item where possible. Otherwise the market displays a clearly labelled product-specific placeholder, not an unrelated category photo.</p>
     <div className="wc-inline-actions"><button type="button" className="wc-primary-action" disabled={Boolean(saving)}
      onClick={saveCatalogue}>{saving?"Saving…":"Save online display"}</button>
      <button type="button" onClick={()=>setEdit(null)}>Cancel</button></div>
    </section>
   </div>:null}
 </main>;
}
