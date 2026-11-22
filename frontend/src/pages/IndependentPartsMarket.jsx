import {useEffect,useMemo,useRef,useState} from "react";
import {useSearchParams} from "react-router";
import axiosClient from "../api/axiosClient";
import {API_BASE_URL} from "../api/apiBaseUrl";
import PublicPageMeta from "../components/PublicPageMeta";
import PublicContactPanel from "../components/PublicContactPanel";
import {photoNeedsReview,referenceSkuPhoto} from "../data/catalogueReferencePhotos";
import {siteHref,sectorHref} from "../config/officialSites";
import "../styles/independentPartsMarket.css";
import "../styles/chalin03PublicRefresh.css";
import "../styles/chalin03PublicRebuild.css";

const money=value=>value==null?"Price on request":"GHS "+Number(value).toLocaleString("en-GH",{minimumFractionDigits:2,maximumFractionDigits:2});
const keygen=()=>globalThis.crypto?.randomUUID?.()||"e95f9365-6ca0-44a3-8661-"+Math.random().toString(16).slice(2).padEnd(12,"0").slice(0,12);
const emptyCustomer={customer_name:"",customer_phone:"",customer_location:"",customer_email:"",message:""};
const photosrc=src=>String(src||"").startsWith("/api/")?API_BASE_URL.replace(/\/api$/,"")+src:src||"";
const shortCategory=name=>String(name||"Parts").replace(/ & /g," + ");
const REFERENCE_LABEL="REAL REFERENCE PHOTO — EXACT STOCK ITEM TO CONFIRM";
function displayPhoto(product){
 if(product.image_url&&["verified_exact","honest_reference"].includes(product.photo_status)){
  return {src:photosrc(product.image_url),reference:product.photo_status==="honest_reference",
   credit:product.photo_credit,license:product.photo_license,source:product.photo_source_url};
 }
 const photo=referenceSkuPhoto(product);
 return photo?{...photo,src:photo.localSrc,reference:true}:null;
}
function PhotoCredit({photo}){
 const credit=[photo.credit,photo.license].filter(Boolean).join(" · ");
 if(!credit)return null;
 return <small className="pm-product__credit">
  {photo.licenseUrl?<><a href={photo.source} target="_blank" rel="noreferrer">{photo.credit}</a>{" · "}
   <a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a>{" · "+photo.changes}</>:
   photo.source?<a href={photo.source} target="_blank" rel="noreferrer">{credit}</a>:credit}
 </small>;
}
function ProductPhoto({product,photo,onOpen}){
 const [failed,setFailed]=useState(false);
 const description=photo?.alt||[product.name,product.size].filter(Boolean).join(" · ");
 if(!photo||failed)return <div className="pm-product__no-photo" aria-label={"Item-specific photo not verified for "+product.name}>
  <span className="pm-product__no-photo-top">CHALIN03 / MAIN STORE</span>
  <strong>{product.name}</strong><small>{product.category} · SKU {product.id}</small>
  <em>{failed?"Reference photo temporarily unavailable":photoNeedsReview(product)?"Photo under review — exact item to confirm":"Actual item photo pending verification"}</em>
 </div>;
 return <>
  <button className="pm-product__photo-button" type="button" aria-label={"Enlarge photo of "+product.name}
   onClick={()=>onOpen({product,photo,description})}>
   <img className={photo.reference?"pm-product__reference-photo":undefined}
    src={photo.src} srcSet={photo.srcSet} sizes="(max-width: 530px) 92vw, 360px"
    alt={description} loading="lazy" decoding="async" width="420" height="320"
    onError={()=>setFailed(true)}/>
  </button>
  {photo.reference?<span className="pm-product__reference-badge">{REFERENCE_LABEL}</span>:null}
 </>;
}
function PhotoDialog({selection,onClose}){
 const dialog=useRef(null);
 useEffect(()=>{dialog.current.showModal();},[]);
 const {product,photo,description}=selection;
 return <dialog ref={dialog} className="pm-photo-dialog" aria-labelledby="pm-photo-title" onClose={onClose}>
  <header><h2 id="pm-photo-title">{product.name}</h2><form method="dialog"><button type="submit">Close</button></form></header>
  {photo.reference?<p>{REFERENCE_LABEL}</p>:null}
  <img src={photo.src} alt={description}/>
  <PhotoCredit photo={photo}/>
 </dialog>;
}
function MarketBrand(){
 return <a className="pm-brand" href={siteHref("parts")}>
  <img src="/chalin03-logo.png" width="42" height="42" alt=""/>
  <span><strong>CHALIN<span>03</span></strong><small>SPARE PARTS SHOP</small></span></a>;
}
export default function IndependentPartsMarket(){
 const [params,setParams]=useSearchParams();
 const [search,setSearch]=useState(params.get("q")||"");
 const [query,setQuery]=useState(params.get("q")||"");
 const [category,setCategory]=useState(params.get("category")||"");
 const [sort,setSort]=useState(params.get("sort")||"featured");
 const [onlyStock,setOnlyStock]=useState(params.get("stock")==="only");
 const [photoFilter,setPhotoFilter]=useState(["any","only"].includes(params.get("photo"))?params.get("photo"):"");
 const [page,setPage]=useState(Math.max(1,Number(params.get("page"))||1));
 const [products,setProducts]=useState([]),[categories,setCategories]=useState([]);
 const [count,setCount]=useState(0),[pages,setPages]=useState(1);
 const [busy,setBusy]=useState(true),[error,setError]=useState("");
 const [catalogueReload,setCatalogueReload]=useState(0),[retryingCatalogue,setRetryingCatalogue]=useState(false);
 const [basket,setBasket]=useState({}),[basketOpen,setBasketOpen]=useState(false);
 const [customer,setCustomer]=useState(emptyCustomer);
 const [requestKey,setRequestKey]=useState(keygen);
 const [sending,setSending]=useState(false),[orderError,setOrderError]=useState(""),[reference,setReference]=useState("");
 const [mobileFilters,setMobileFilters]=useState(false);
 const [selectedPhoto,setSelectedPhoto]=useState(null);
 const basketItems=useMemo(()=>Object.values(basket),[basket]);
 const basketUnits=basketItems.reduce((n,p)=>n+p.qty,0);
 const subtotal=basketItems.reduce((n,p)=>n+p.qty*Number(p.price||0),0);
 useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),260);return()=>clearTimeout(timer)},[search]);
 useEffect(()=>{
  const qs=new URLSearchParams();
  if(query)qs.set("q",query);if(category)qs.set("category",category);
  if(sort!=="featured")qs.set("sort",sort);if(onlyStock)qs.set("stock","only");
  if(photoFilter)qs.set("photo",photoFilter);if(page>1)qs.set("page",String(page));
  setParams(qs,{replace:true});
 },[query,category,sort,onlyStock,photoFilter,page,setParams]);
 useEffect(()=>{
  let alive=true;let retryTimer=null;
  const controller=new AbortController();
  const filters={search:query,category,sort,stock:onlyStock?"only":"",photo:photoFilter,page,limit:24};
  setBusy(true);setError("");setRetryingCatalogue(false);
  async function fetchCatalogue(attempt=0){
   try{
    const {data}=await axiosClient.get("/public-commerce/products",{
     params:filters,signal:controller.signal,timeout:17000
    });
    if(!alive)return;
    setProducts(data.products||[]);setCategories(data.categories||[]);
    setCount(Number(data.count||0));setPages(Math.max(1,Number(data.pages||1)));
    setError("");setRetryingCatalogue(false);
   }catch(e){
    if(!alive||e?.code==="ERR_CANCELED")return;
    const temporary=[502,503,504].includes(e.response?.status)||
     ["ERR_NETWORK","ECONNABORTED","ETIMEDOUT"].includes(e?.code);
    if(temporary&&attempt===0){
     setRetryingCatalogue(true);
     retryTimer=setTimeout(()=>{retryTimer=null;if(alive)void fetchCatalogue(1);},1300);
     return;
    }
    setProducts([]);setCount(0);setPages(1);setRetryingCatalogue(false);
    setError(e.response?.data?.message||"We could not load the latest product catalogue. Please retry or contact our team.");
   }finally{
    if(alive&&retryTimer===null)setBusy(false);
   }
  }
  void fetchCatalogue();
  return()=>{alive=false;clearTimeout(retryTimer);controller.abort();};
 },[query,category,sort,onlyStock,photoFilter,page,catalogueReload]);
 function retryCatalogue(){
  setError("");setRetryingCatalogue(false);
  setCatalogueReload(version=>version+1);
 }
 function resetFilters(){setSearch("");setQuery("");setCategory("");setOnlyStock(false);setPhotoFilter("");setSort("featured");setPage(1);}
 function addItem(product){
  if(!product.in_stock||product.price==null)return;
  setBasket(previous=>({...previous,[product.id]:{...product,qty:Math.min(200,(previous[product.id]?.qty||0)+1)}}));
  setBasketOpen(true);setReference("");setOrderError("");
 }
 function setQty(id,qty){setBasket(previous=>{
  if(!previous[id])return previous;const n=Math.max(0,Math.min(200,Number(qty)||0));
  if(n===0){const copy={...previous};delete copy[id];return copy}
  return {...previous,[id]:{...previous[id],qty:n}};
 })}
 async function sendOrder(event){
  event.preventDefault();
  if(!basketItems.length||sending)return;
  setSending(true);setOrderError("");
  try{
   const {data}=await axiosClient.post("/public-commerce/requests",{
    ...customer,request_type:"parts_order",client_key:requestKey,
    items:basketItems.map(p=>({product_id:p.id,quantity:p.qty}))
   },{timeout:20000});
   setReference(data.reference||"Request received");setBasket({});setBasketOpen(false);setCustomer(emptyCustomer);setRequestKey(keygen());
  }catch(e){setOrderError(e.response?.data?.message||"Order not sent. Please retry or WhatsApp us.");}
  finally{setSending(false)}
 }
 const askPhoto=product=>"https://wa.me/233540713654?text="+encodeURIComponent("Hello CHALIN03, please confirm availability, fitment and the stock photo for "+product.name+(product.size?" ("+product.size+")":"")+" — Product #"+product.id+".");
 return <main className="pm-site">
  <PublicPageMeta title="CHALIN03 Spare Parts Shop | Filters, Oils, Excavator Parts & Tools" description="Dedicated CHALIN03 online spare-parts shop in Ghana. Search products, compare live Main Store selling prices, filter by department and send an order for staff confirmation." canonicalPath="/shop"/>
  <div className="pm-mini-header"><span>CHALIN03 MAIN STORE · DUNKWA POLICE BARRIER</span><span><a href="tel:+233540713654">054 071 3654</a> · <a href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">WHATSAPP US</a></span></div>
  <header className="pm-header">
   <MarketBrand/>
   <nav aria-label="Shop links"><a href={siteHref("company")}>Company home</a><a href={siteHref("parts")}>Shop products</a><a href={siteHref("help")}>Help</a><a href={siteHref("work")}>Staff</a></nav>
   <button className="pm-cart-btn" onClick={()=>setBasketOpen(true)} type="button">Your basket <strong>{basketUnits}</strong></button>
  </header>
  <section className="pm-hero"><div className="pm-hero__copy">
    <p className="site-location">CHALIN03 MAIN STORE · DUNKWA</p>
    <h1>Find the part you need.</h1>
    <p>Search live stock and prices by part name, model or size.</p>
    <form className="pm-hero-search" onSubmit={e=>{e.preventDefault();document.getElementById("pm-products")?.scrollIntoView({behavior:"smooth"});}}>
     <label htmlFor="pm-big-search" className="pm-visually-hidden">Search the spare-parts shop</label>
     <input id="pm-big-search" type="search" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search part, filter, model, oil, tool…"/>
     <button type="submit">Search products</button>
    </form>
   </div>
   <aside className="pm-hero__service"><h2>Need help with fitment?</h2><p>Send the machine model and any number stamped on the part.</p><a href={sectorHref("spare-parts")}>Ask the parts team →</a></aside>
  </section>
  <section className="pm-find" id="pm-products">
   <div className="pm-heading"><div>
    <h2>Shop the catalogue</h2><p>{busy?"Checking latest listings…":count.toLocaleString()+" matching products"} · Main Store prices in Ghana cedis</p></div>
    <button type="button" className="pm-mobile-filter-btn" onClick={()=>setMobileFilters(v=>!v)}>{mobileFilters?"Close filters":"Show filters"}</button>
   </div>
   <div className="pm-store-layout"><aside className={"pm-sidebar"+(mobileFilters?" is-open":"")}>
    <div className="pm-sidebar__head"><strong>Find the right item</strong><button type="button" onClick={resetFilters}>Reset all</button></div>
    <label className="pm-filter-label" htmlFor="pm-side-search">Search by name or specification</label>
    <input id="pm-side-search" type="search" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Part number, name, model…"/>
    <label className="pm-filter-label" htmlFor="pm-sort">Sort products</label>
    <select id="pm-sort" value={sort} onChange={e=>{setSort(e.target.value);setPage(1)}}>
     <option value="featured">Recommended / relevant</option><option value="name">Product name A–Z</option>
     <option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>
    </select>
    <div className="pm-toggles"><label><input type="checkbox" checked={onlyStock} onChange={e=>{setOnlyStock(e.target.checked);setPage(1)}}/> In-stock listings</label>
     <label className="pm-filter-label" htmlFor="pm-photo-filter">Photo availability</label>
     <select id="pm-photo-filter" value={photoFilter} onChange={e=>{setPhotoFilter(e.target.value);setPage(1)}}>
      <option value="">All listings</option><option value="any">Exact or reference photo</option><option value="only">Verified exact photo</option>
     </select></div>
    <div className="pm-department-head"><strong>Shop departments</strong><small>{categories.length} groups</small></div>
    <div className="pm-departments"><button type="button" className={!category?"selected":""} onClick={()=>{setCategory("");setPage(1)}}>All spare parts <span>→</span></button>
     {categories.map(name=><button type="button" className={category===name?"selected":""} key={name} onClick={()=>{setCategory(name);setPage(1)}}>{shortCategory(name)}<span>→</span></button>)}</div>
    <div className="pm-sidebar__help"><strong>Need a specific part?</strong><p>Send the make, model and part number. Our team can check the exact item for you.</p><a href={sectorHref("spare-parts")}>Ask our team ↗</a></div>
   </aside>
   <div className="pm-listings">
    <div className="pm-listings__toolbar"><div><span>{category||"All departments"}</span><strong>{count} products</strong></div></div>
    {error?<div className="pm-error" role="alert">{error}<button type="button" onClick={retryCatalogue}>Retry loading products</button><a href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">Ask us on WhatsApp</a></div>:null}
    {busy?<div className="pm-loading" role="status">{retryingCatalogue?"Temporary connection issue — retrying the catalogue automatically…":"Loading the latest catalogue…"}</div>:null}
    {!busy&&products.length?<div className="pm-grid">{products.map(p=>{
     const photo=displayPhoto(p);
     return <article key={p.id} className="pm-product">
      <div className="pm-product__photo">
       <ProductPhoto key={photo?.src||p.id} product={p} photo={photo} onOpen={setSelectedPhoto}/>
       {p.featured?<span className="pm-product__featured">FEATURED</span>:null}
      </div>
      <div className="pm-product__body"><span className="pm-product__category">{p.category} · SKU {p.id}</span><h3>{p.name}</h3>
       <p className="pm-product__size">{p.size&&p.size.toLowerCase()!=="none"?p.size:"Confirm exact machine fitment"}</p>
       {p.description?<p className="pm-product__size">{p.description}</p>:null}
       {photo?<PhotoCredit photo={photo}/>:null}
       <strong className="pm-product__price">{money(p.price)}</strong>
       <small className={p.in_stock?"pm-availability":"pm-availability pm-availability--out"}>{p.in_stock?"In stock · confirm with staff":"Availability on request"}</small>
       <div className="pm-product__actions">{p.in_stock?<button type="button" onClick={()=>addItem(p)}>Add to basket</button>:null}
       <a href={askPhoto(p)} target="_blank" rel="noopener noreferrer">Enquire</a></div>
      </div>
     </article>})}</div>:null}
    {!busy&&!products.length&&!error?<div className="pm-empty"><h3>No matching parts found</h3><p>Try a different term or ask our team to source your exact item.</p><button type="button" onClick={resetFilters}>Clear filters</button></div>:null}
    <div className="pm-pagination"><button type="button" disabled={busy||page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>← Previous</button>
     <span>Page {page} of {pages}</span><button type="button" disabled={busy||page>=pages} onClick={()=>setPage(p=>p+1)}>Next →</button></div>
   </div></div>
  </section>
  <section className="pm-cta"><div><span>OUR SERVICE PROMISE</span><h2>Need the exact part?<br/>Let's get it right.</h2><p>Send a photo of the old part or a manufacturer part number. The team will confirm fitment and availability before any sale.</p></div>
   <a href={sectorHref("spare-parts")}>Ask about a specific part ↗</a></section>
  <footer className="pm-footer"><MarketBrand/><div><a href={siteHref("company")}>Company home</a><a href={siteHref("help")}>Help centre</a><a href={siteHref("work")}>Staff portal</a><a href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">WhatsApp us</a></div><span>© {new Date().getFullYear()} CHALIN03 COMPANY LIMITED</span></footer>
  {reference?<div className="pm-success" role="status"><div><strong>Order request received</strong><p>Reference: <b>{reference}</b>. Our team will confirm fitment, price and payment. Nothing was charged online.</p><button type="button" onClick={()=>setReference("")}>Close</button></div></div>:null}
  {basketOpen?<div className="pm-basket-overlay" onClick={()=>setBasketOpen(false)}><aside className="pm-basket" aria-label="Spare-parts order basket" onClick={e=>e.stopPropagation()}>
   <header><div><span>CHALIN03 MARKET</span><h2>Your order request</h2></div><button type="button" aria-label="Close order basket" onClick={()=>setBasketOpen(false)}>×</button></header>
   {!basketItems.length?<p className="pm-empty-basket">Your basket is empty. Browse the marketplace to add parts.</p>:<>
    <div className="pm-basket-items">{basketItems.map(p=><div key={p.id}><div><strong>{p.name}</strong><small>{money(p.price)} each</small></div>
     <label>Quantity<input type="number" min="0" max="200" value={p.qty} onChange={e=>setQty(p.id,e.target.value)}/></label></div>)}</div>
    <div className="pm-subtotal"><span>Estimated subtotal</span><strong>{money(subtotal)}</strong></div>
    <p className="pm-basket-note">No online payment. Actual availability and totals are confirmed by our team.</p>
    <form onSubmit={sendOrder}>
     <label>Full name *<input required minLength={2} maxLength={150} autoComplete="name" value={customer.customer_name} onChange={e=>setCustomer(v=>({...v,customer_name:e.target.value}))}/></label>
     <label>Phone or WhatsApp *<input required type="tel" maxLength={32} autoComplete="tel" value={customer.customer_phone} onChange={e=>setCustomer(v=>({...v,customer_phone:e.target.value}))}/></label>
     <label>Town / delivery location *<input required minLength={2} autoComplete="address-level2" value={customer.customer_location} onChange={e=>setCustomer(v=>({...v,customer_location:e.target.value}))}/></label>
     <label>Email (optional)<input type="email" value={customer.customer_email} onChange={e=>setCustomer(v=>({...v,customer_email:e.target.value}))}/></label>
     <label>Machine details / notes<textarea rows={3} value={customer.message} onChange={e=>setCustomer(v=>({...v,message:e.target.value}))}/></label>
     {orderError?<p className="pm-error" role="alert">{orderError}</p>:null}
     <button className="pm-place" type="submit" disabled={sending}>{sending?"Sending order…":"Send order request →"}</button>
    </form></>}
  </aside></div>:null}
  <PublicContactPanel subject="CHALIN03 spare-parts shop customer help"/>
  {selectedPhoto?<PhotoDialog selection={selectedPhoto} onClose={()=>setSelectedPhoto(null)}/>:null}
 </main>;
}
