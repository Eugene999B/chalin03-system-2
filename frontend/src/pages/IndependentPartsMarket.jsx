import {useEffect,useMemo,useState} from "react";
import {useSearchParams} from "react-router";
import axiosClient from "../api/axiosClient";
import {API_BASE_URL} from "../api/apiBaseUrl";
import PublicPageMeta from "../components/PublicPageMeta";
import PublicContactPanel from "../components/PublicContactPanel";
import RealPhoto from "../components/RealPhoto";
import {PHOTO_LIBRARY,SPAREPARTS_SKU_REFERENCE_PHOTOS} from "../data/verifiedPublicPhotos";
import {siteHref,sectorHref} from "../config/officialSites";
import "../styles/independentPartsMarket.css";

const money=value=>value==null?"Price on request":"GHS "+Number(value).toLocaleString("en-GH",{minimumFractionDigits:2,maximumFractionDigits:2});
const keygen=()=>globalThis.crypto?.randomUUID?.()||"e95f9365-6ca0-44a3-8661-"+Math.random().toString(16).slice(2).padEnd(12,"0").slice(0,12);
const emptyCustomer={customer_name:"",customer_phone:"",customer_location:"",customer_email:"",message:""};
const photosrc=src=>String(src||"").startsWith("/api/")?API_BASE_URL.replace(/\/api$/,"")+src:src||"";
const shortCategory=name=>String(name||"Parts").replace(/ & /g," + ");
const CURATED_PHOTO_PRODUCTS=[{"id":20,"name":"Oil Filter (LF3349)"},{"id":35,"name":"China Oil Filter"},{"id":21,"name":"Fuel Filter (FF5544)"},{"id":115,"name":"Hand Grease Gun Long"},{"id":200,"name":"Hammer"},{"id":138,"name":"Shovel"},{"id":656,"name":"Bucket"},{"id":192,"name":"Spanner 13"},{"id":193,"name":"Spanner 11"},{"id":183,"name":"Box Spanner Tool Set"},{"id":201,"name":"Piston Set"},{"id":97,"name":"Black Hose"},{"id":378,"name":"BATTERY-BIG AVATAR"}];
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
 const [onlyPhotos,setOnlyPhotos]=useState(params.get("photo")==="only");
 const [page,setPage]=useState(Math.max(1,Number(params.get("page"))||1));
 const [products,setProducts]=useState([]),[categories,setCategories]=useState([]);
 const [count,setCount]=useState(0),[pages,setPages]=useState(1);
 const [busy,setBusy]=useState(true),[error,setError]=useState("");
 const [basket,setBasket]=useState({}),[basketOpen,setBasketOpen]=useState(false);
 const [customer,setCustomer]=useState(emptyCustomer);
 const [requestKey,setRequestKey]=useState(keygen);
 const [sending,setSending]=useState(false),[orderError,setOrderError]=useState(""),[reference,setReference]=useState("");
 const [mobileFilters,setMobileFilters]=useState(false);
 const basketItems=useMemo(()=>Object.values(basket),[basket]);
 const basketUnits=basketItems.reduce((n,p)=>n+p.qty,0);
 const subtotal=basketItems.reduce((n,p)=>n+p.qty*Number(p.price||0),0);
 useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),260);return()=>clearTimeout(timer)},[search]);
 useEffect(()=>{
  const qs=new URLSearchParams();
  if(query)qs.set("q",query);if(category)qs.set("category",category);
  if(sort!=="featured")qs.set("sort",sort);if(onlyStock)qs.set("stock","only");
  if(onlyPhotos)qs.set("photo","only");if(page>1)qs.set("page",String(page));
  setParams(qs,{replace:true});
 },[query,category,sort,onlyStock,onlyPhotos,page,setParams]);
 useEffect(()=>{
  let alive=true;const controller=new AbortController();
  setBusy(true);setError("");
  axiosClient.get("/public-commerce/products",{
   params:{search:query,category,sort,stock:onlyStock?"only":"",photo:onlyPhotos?"only":"",page,limit:24},
   signal:controller.signal,timeout:17000
  }).then(({data})=>{if(!alive)return;setProducts(data.products||[]);
    setCategories(data.categories||[]);setCount(Number(data.count||0));setPages(Math.max(1,Number(data.pages||1)));})
    .catch(e=>{if(alive&&e?.code!=="ERR_CANCELED")setError(e.response?.data?.message||"We could not load the latest product catalogue. Please retry or contact our team.");})
    .finally(()=>{if(alive)setBusy(false)});
  return()=>{alive=false;controller.abort()};
 },[query,category,sort,onlyStock,onlyPhotos,page]);
 function resetFilters(){setSearch("");setQuery("");setCategory("");setOnlyStock(false);setOnlyPhotos(false);setSort("featured");setPage(1);}
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
 const askPhoto=product=>"https://wa.me/233540713654?text="+encodeURIComponent("Hello CHALIN03, please send me the ACTUAL product photo and fitment details for "+product.name+(product.size?" ("+product.size+")":"")+" — Product #"+product.id+".");
 return <main className="pm-site">
  <PublicPageMeta title="CHALIN03 Spare Parts Shop | Filters, Oils, Excavator Parts & Tools" description="Dedicated CHALIN03 online spare-parts shop in Ghana. Search products, compare live Main Store selling prices, filter by department and send an order for staff confirmation." canonicalPath="/shop"/>
  <div className="pm-mini-header"><span>CHALIN03 MAIN STORE · DUNKWA POLICE BARRIER</span><span><a href="tel:+233540713654">054 071 3654</a> · <a href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">WHATSAPP US</a></span></div>
  <header className="pm-header">
   <MarketBrand/>
   <nav aria-label="Shop links"><a href={siteHref("company")}>Company home</a><a href={siteHref("parts")}>Shop products</a><a href={siteHref("help")}>Help</a><a href={siteHref("work")}>Staff</a></nav>
   <button className="pm-cart-btn" onClick={()=>setBasketOpen(true)} type="button">Your basket <strong>{basketUnits}</strong></button>
  </header>
  <section className="pm-hero"><div className="pm-hero__copy">
    <div className="pm-eyebrow">THE CHALIN03 SPARE PARTS SHOP</div>
    <h1>Keep your machine<br/><em>moving.</em></h1>
    <p>Excavator spare parts, oils, workshop tools and components — organized in a dedicated market, with prices from our Main Store.</p>
    <form className="pm-hero-search" onSubmit={e=>{e.preventDefault();document.getElementById("pm-products")?.scrollIntoView({behavior:"smooth"});}}>
     <label htmlFor="pm-big-search" className="pm-visually-hidden">Search the spare-parts shop</label>
     <input id="pm-big-search" type="search" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search part, filter, model, oil, tool…"/>
     <button type="submit">Search products</button>
    </form>
    <div className="pm-hero__promises"><span>Live selling prices</span><span>Staff-confirmed orders</span><span>Secure enquiry only</span></div>
   </div><div className="pm-hero__visual"><RealPhoto photo={PHOTO_LIBRARY.hoses} eager/>
    <div className="pm-hero__seal">REAL PARTS.<br/><strong>RIGHT FIT.</strong></div>
   </div>
  </section>
  <section className="pm-real-photo-shelf" aria-labelledby="pm-real-photo-heading">
   <div className="pm-real-photo-shelf__head"><div>
    <span>PHOTOGRAPHED PART TYPES</span>
    <h2 id="pm-real-photo-heading">Real parts. Real photographs.</h2>
    <p>Different photographs of real filters, tools and equipment parts — not AI images or repeated category art. These are visual references; our team confirms the exact size, manufacturer and physical stock item before sale.</p>
   </div><a href="#pm-products">Browse all Main Store products</a></div>
   <div className="pm-real-photo-shelf__scroll">
    {CURATED_PHOTO_PRODUCTS.map(p=><article className="pm-real-photo-shelf__card" key={p.id}>
     <RealPhoto photo={SPAREPARTS_SKU_REFERENCE_PHOTOS[p.id]}/>
     <div><span>REAL REFERENCE PHOTO · MODEL TO CONFIRM</span><h3>{p.name}</h3>
      <a href={siteHref("parts","",new URLSearchParams({q:p.name}).toString())}>View part and live price ↗</a></div>
    </article>)}
   </div>
  </section>
  <section className="pm-find" id="pm-products">
   <div className="pm-heading"><div><span className="pm-eyebrow pm-eyebrow--dark">BROWSE OUR MAIN STORE</span>
    <h2>The parts catalogue</h2><p>{busy?"Checking latest listings…":count.toLocaleString()+" matching products"} · Main Store prices in Ghana cedis</p></div>
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
     <label><input type="checkbox" checked={onlyPhotos} onChange={e=>{setOnlyPhotos(e.target.checked);setPage(1)}}/> Actual item photo available</label></div>
    <div className="pm-department-head"><strong>Shop departments</strong><small>{categories.length} groups</small></div>
    <div className="pm-departments"><button type="button" className={!category?"selected":""} onClick={()=>{setCategory("");setPage(1)}}>All spare parts <span>→</span></button>
     {categories.map(name=><button type="button" className={category===name?"selected":""} key={name} onClick={()=>{setCategory(name);setPage(1)}}>{shortCategory(name)}<span>→</span></button>)}</div>
    <div className="pm-sidebar__help"><strong>Need a specific part?</strong><p>Send the make, model and part number. Our team can check the exact item for you.</p><a href={sectorHref("spare-parts")}>Ask our team ↗</a></div>
   </aside>
   <div className="pm-listings">
    <div className="pm-listings__toolbar"><div><span>{category||"All departments"}</span><strong>{count} products</strong></div><span>Actual stock photos take priority. Real part-type reference images are labelled separately.</span></div>
    {error?<div className="pm-error" role="alert">{error}<button type="button" onClick={()=>{setPage(1);setQuery(search.trim())}}>Retry</button></div>:null}
    {busy?<div className="pm-loading" role="status">Loading the latest catalogue…</div>:null}
    {!busy&&products.length?<div className="pm-grid">{products.map(p=><article key={p.id} className="pm-product">
      <div className="pm-product__photo">
       {p.image_url?<img src={photosrc(p.image_url)} alt={p.name+" actual stock photo"} loading="lazy" decoding="async" width="420" height="320" onError={e=>{e.currentTarget.hidden=true;e.currentTarget.nextElementSibling?.removeAttribute("hidden")}}/>:null}
       {!p.image_url&&SPAREPARTS_SKU_REFERENCE_PHOTOS[p.id]?<RealPhoto photo={SPAREPARTS_SKU_REFERENCE_PHOTOS[p.id]} className="pm-product__reference-photo"/>:null}
       <div className="pm-product__no-photo" hidden={Boolean(p.image_url||SPAREPARTS_SKU_REFERENCE_PHOTOS[p.id])}><span>CHALIN03 PRODUCT #{p.id}</span><strong>{p.name}</strong><small>Actual item photograph needed</small></div>
       {!p.image_url&&SPAREPARTS_SKU_REFERENCE_PHOTOS[p.id]?<span className="pm-product__reference-badge">REAL PART-TYPE PHOTO · ACTUAL STOCK TO CONFIRM</span>:null}
       {p.featured?<span className="pm-product__featured">FEATURED</span>:null}
      </div>
      <div className="pm-product__body"><span className="pm-product__category">{p.category}</span><h3>{p.name}</h3>
       <p className="pm-product__size">{p.size&&p.size.toLowerCase()!=="none"?p.size:"Confirm exact machine fitment"}</p>
       <strong className="pm-product__price">{money(p.price)}</strong>
       <small className={p.in_stock?"pm-availability":"pm-availability pm-availability--out"}>{p.in_stock?"Enquire to confirm stock":"Availability on request"}</small>
       <div className="pm-product__actions"><button type="button" disabled={!p.in_stock} onClick={()=>addItem(p)}>{p.in_stock?"Add to basket +":"Request availability"}</button>
       {!p.image_url?<a href={askPhoto(p)} target="_blank" rel="noopener noreferrer">Request actual photo</a>:null}</div>
      </div>
     </article>)}</div>:null}
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
 </main>;
}
