import {useEffect,useMemo,useState} from "react";
import {Link,useSearchParams} from "react-router";
import axiosClient from "../api/axiosClient";
import {API_BASE_URL} from "../api/apiBaseUrl";
import PublicPageMeta from "../components/PublicPageMeta";
import PublicContactPanel from "../components/PublicContactPanel";
import "../styles/publicCommerce.css";

const money=v=>"GHS "+Number(v||0).toLocaleString("en-GH",{minimumFractionDigits:2,maximumFractionDigits:2});
const newKey=()=>globalThis.crypto?.randomUUID?.()||"e95f9365-6ca0-44a3-8661-"+Math.random().toString(16).slice(2).padEnd(12,"0").slice(0,12);
const imageSrc=src=>String(src||"").startsWith("/api/")?API_BASE_URL.replace(/\/api$/,"")+src:(src||"");
const typeIcon=type=>/filter/i.test(type)?"▥":/oil|grease/i.test(type)?"◉":/tool|spanner/i.test(type)?"⚒":/hydraulic/i.test(type)?"⚙":/engine/i.test(type)?"▣":/motorcycle/i.test(type)?"◈":"◇";
const contactBlank={customer_name:"",customer_phone:"",customer_location:"",customer_email:"",message:""};

export default function PublicShopPage(){
 const [params,setParams]=useSearchParams();
 const [search,setSearch]=useState(params.get("q")||"");
 const [category,setCategory]=useState(params.get("category")||"");
 const [sort,setSort]=useState("featured"),[page,setPage]=useState(1);
 const [stockOnly,setStockOnly]=useState(params.get("stock")==="only");
 const [photoOnly,setPhotoOnly]=useState(params.get("photo")==="only");
 const [products,setProducts]=useState([]),[categories,setCategories]=useState([]);
 const [count,setCount]=useState(0),[pages,setPages]=useState(1);
 const [loading,setLoading]=useState(true),[error,setError]=useState("");
 const [cart,setCart]=useState({}),[cartOpen,setCartOpen]=useState(false);
 const [details,setDetails]=useState(contactBlank),[key,setKey]=useState(newKey);
 const [submitting,setSubmitting]=useState(false),[success,setSuccess]=useState("");
 const [submitError,setSubmitError]=useState("");
 const items=useMemo(()=>Object.values(cart),[cart]);
 const totalQuantity=items.reduce((a,b)=>a+b.quantity,0);
 const subtotal=items.reduce((a,b)=>a+b.price*b.quantity,0);
 useEffect(()=>{
   const id=setTimeout(()=>{
    const next=new URLSearchParams(params);
    if(search.trim())next.set("q",search.trim());else next.delete("q");
    if(category)next.set("category",category);else next.delete("category");
    if(stockOnly)next.set("stock","only");else next.delete("stock");
    if(photoOnly)next.set("photo","only");else next.delete("photo");
    setParams(next,{replace:true});
   },260);
   return()=>clearTimeout(id);
 // Query params are mirrored to the shareable URL, but only actual search inputs trigger this effect.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[search,category,stockOnly,photoOnly]);
 useEffect(()=>{
  let active=true;const controller=new AbortController();
  setLoading(true);setError("");
  axiosClient.get("/public-commerce/products",{params:{search,category,sort,page,limit:24,stock:stockOnly?"only":"",photo:photoOnly?"only":""},
    signal:controller.signal,timeout:16000})
   .then(({data})=>{if(!active)return;setProducts(data.products||[]);
    setCategories(data.categories||[]);setCount(Number(data.count||0));
    setPages(Math.max(1,Number(data.pages||1)));})
   .catch(e=>{if(active&&e?.code!=="ERR_CANCELED")
    setError(e.response?.data?.message||"Catalogue temporarily unavailable. Please call us.");})
   .finally(()=>{if(active)setLoading(false)});
  return()=>{active=false;controller.abort()};
 },[search,category,sort,page,stockOnly,photoOnly]);
 const chooseCategory=c=>{setCategory(c);setPage(1)};
 const add=product=>{
  if(!product.in_stock)return;
  setCart(previous=>({...previous,[product.id]:{...product,quantity:
   Math.min(200,(previous[product.id]?.quantity||0)+1)}}));
  setSuccess("");setCartOpen(true);
 };
 const quantity=(id,value)=>setCart(previous=>{
  if(!previous[id])return previous;
  const n=Math.max(0,Math.min(200,Number(value)||0));
  if(!n){const clone={...previous};delete clone[id];return clone}
  return {...previous,[id]:{...previous[id],quantity:n}};
 });
 async function submit(e){
  e.preventDefault();if(!items.length||submitting)return;
  setSubmitting(true);setSubmitError("");
  try{
   const {data}=await axiosClient.post("/public-commerce/requests",{
    ...details,client_key:key,request_type:"parts_order",
    items:items.map(item=>({product_id:item.id,quantity:item.quantity})),
   },{timeout:16000});
   setSuccess(data.reference||"Your order");
   setCart({});setCartOpen(false);setKey(newKey());setDetails(contactBlank);
  }catch(err){setSubmitError(err.response?.data?.message||"Order not sent. Please call us instead.");}
  finally{setSubmitting(false)}
 }
 return <main className="pc-site">
  <PublicPageMeta title="Buy Excavator Spare Parts, Oils & Tools | CHALIN03 Ghana"
   description="Search spare parts, filters, hydraulic oils and excavator components at CHALIN03 Main Store. View prices and send orders for staff confirmation."
   canonicalPath="/shop"/>
  <div className="pc-utility"><span>Dunkwa Police Barrier · Ghana</span>
   <div><a href="tel:+233249469080">Call us</a><a href="tel:+233540713654">054 071 3654</a></div></div>
  <header className="pc-header">
   <Link to="/" className="pc-logo"><img src="/chalin03-logo.png" alt=""/>
    <span><b>CHALIN<span>03</span></b><small>Online Spare Parts Store</small></span></Link>
   <nav aria-label="Store navigation"><Link to="/">Home</Link><Link to="/enquire">Enquire</Link><Link to="/customer-help">Help</Link>
    <Link to="/login">Staff login</Link></nav>
   <button type="button" className="pc-cart-button" onClick={()=>setCartOpen(!cartOpen)}>
    Basket <strong>{totalQuantity}</strong></button>
  </header>
  <section className="pc-shop-hero">
   <div><span className="pc-eyebrow">THE MAIN STORE · SPARE PARTS</span>
    <h1>Find the right part.<br/><em>Keep moving.</em></h1>
    <p>Welcome to our dedicated online parts market. Search, compare Main Store prices, filter departments and send a basket request. Our staff confirms exact fit, availability and payment arrangements before a sale.</p>
    <div className="pc-hero-points"><span>✓ Live listed prices</span><span>✓ No online payment</span><span>✓ Ghana-wide enquiries</span></div>
   </div>
   <img src="/images/home/v1/parts.webp" alt="Mechanical parts and tools in a workshop"/>
  </section>
  <section className="pc-catalogue">
   <div className="pc-section-heading"><div><span className="pc-eyebrow">SHOP DEPARTMENTS</span>
    <h2>Spare parts catalogue</h2>
    <p>{loading?"Checking products…":count.toLocaleString()+" matching products"} · Main Store</p></div>
    <a href="https://wa.me/233540713654" target="_blank" rel="noreferrer">Ask us to find a part ↗</a>
   </div>
   <div className="pc-shop-layout">
    <aside className="pc-filters">
     <label htmlFor="pc-search">Search by name or specification</label>
     <input id="pc-search" placeholder="Filter, hammer, hydraulic oil, XCMG…"
      value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/>
     <label htmlFor="pc-sort">Sort</label>
     <select id="pc-sort" value={sort} onChange={e=>{setSort(e.target.value);setPage(1)}}>
      <option value="featured">Featured / in stock</option><option value="name">A–Z</option>
      <option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>
     </select>
     <div className="pc-filter-toggles">
       <label><input type="checkbox" checked={stockOnly} onChange={e=>{setStockOnly(e.target.checked);setPage(1)}}/> Available to request</label>
       <label><input type="checkbox" checked={photoOnly} onChange={e=>{setPhotoOnly(e.target.checked);setPage(1)}}/> With individual item photos</label>
      </div>
      <h3>Departments</h3>
     <div className="pc-category-list">
      <button type="button" className={!category?"active":""} onClick={()=>chooseCategory("")}>All spare parts</button>
      {categories.map(c=><button type="button" key={c} className={category===c?"active":""}
       onClick={()=>chooseCategory(c)}>{c}</button>)}
     </div>
     <p className="pc-help-note">Each photograph shown is linked to its own product. Where a verified item photograph is not available, we show a clearly labelled product card instead of a misleading generic picture.</p>
    </aside>
    <div className="pc-shop-main">
     {error?<p className="pc-alert" role="alert">{error}</p>:null}
     {loading?<div className="pc-loading" role="status">Loading latest product details…</div>:
      products.length?<div className="pc-product-grid">
      {products.map(product=><article key={product.id} className="pc-product">
       <div className="pc-product-image">
        <div className="pc-product-image__placeholder" aria-hidden="true">
         <span>{typeIcon(product.category)}</span><strong>{product.name}</strong>
         <small>Individual item photo pending</small>
        </div>
        {product.image_url?<img src={imageSrc(product.image_url)} alt={product.name+" — item photograph"}
         loading="lazy" decoding="async" width="400" height="300"
         onError={event=>{event.currentTarget.style.display="none";}}/>:null}
        {product.featured?<span className="pc-featured">FEATURED</span>:null}
       </div>
       <div className="pc-product-detail">
        <span className="pc-product-category">{product.category}</span>
        <h3>{product.name}</h3>
        <p>{product.size&&product.size.toLowerCase()!=="none"?product.size:"Confirm fitment with our team"}</p>
        <strong className="pc-price">{product.price===null?"Price on request":money(product.price)}</strong>
        <span className={"pc-stock"+(product.in_stock?"":" is-empty")}>
         {product.in_stock?"Ask for availability":"Restock enquiry only"}</span>
        <button type="button" disabled={!product.in_stock} onClick={()=>add(product)}>
         {product.in_stock?"Add to basket +":"Currently unavailable"}</button>
        {product.image_is_illustrative?<small>Individual item photograph not yet uploaded</small>:null}
       </div></article>)}</div>:
       <div className="pc-empty"><h3>No items match</h3><p>Try a different search or message our team.</p>
        <Link to="/enquire?sector=spare-parts">Request the part ↗</Link></div>}
     <div className="pc-pagination"><button type="button" disabled={loading||page===1}
      onClick={()=>setPage(p=>Math.max(1,p-1))}>← Previous</button>
      <span>Page {page} of {pages}</span>
      <button type="button" disabled={loading||page>=pages} onClick={()=>setPage(p=>p+1)}>Next →</button>
     </div>
    </div>
   </div>
  </section>
  <section className="pc-bottom-cta"><div><span className="pc-eyebrow">MORE THAN PARTS</span>
   <h2>Need an excavator, heavy machine, vehicle, transport or gold-related service?</h2>
   <p>Specialist machinery and services are quotation-only — no prices displayed publicly.</p></div>
   <Link to="/excavators">Explore our excavators →</Link></section>
  {success?<div className="pc-success" role="status"><strong>Order received: {success}</strong>
   <p>Save this reference. Our team will phone you to confirm quantity, price and payment. Nothing has been charged online.</p>
   <button type="button" onClick={()=>setSuccess("")}>Close</button></div>:null}
  {cartOpen?<div className="pc-drawer-backdrop" onClick={()=>setCartOpen(false)}>
   <aside className="pc-drawer" aria-label="Order basket" onClick={e=>e.stopPropagation()}>
    <div className="pc-drawer-head"><div><span className="pc-eyebrow">BASKET</span><h2>Your order request</h2></div>
     <button type="button" aria-label="Close basket" onClick={()=>setCartOpen(false)}>✕</button></div>
    {!items.length?<p>Your basket is empty.</p>:<>
     <div className="pc-cart-list">{items.map(item=><div key={item.id} className="pc-cart-item">
      <div><strong>{item.name}</strong><small>{money(item.price)} per unit</small></div>
      <div><label htmlFor={"item-"+item.id}>Qty</label><input id={"item-"+item.id}
       type="number" min="0" max="200" value={item.quantity} onChange={e=>quantity(item.id,e.target.value)}/></div>
     </div>)}</div>
     <div className="pc-cart-total"><span>Estimated subtotal</span><strong>{money(subtotal)}</strong></div>
     <p className="pc-help-note">Availability and final total are confirmed by staff. This is not an online payment checkout.</p>
     <form className="pc-contact-form" onSubmit={submit}>
      <label>Your full name *<input required autoComplete="name" value={details.customer_name}
       onChange={e=>setDetails(x=>({...x,customer_name:e.target.value}))}/></label>
      <label>Phone / WhatsApp *<input required type="tel" autoComplete="tel"
       value={details.customer_phone} onChange={e=>setDetails(x=>({...x,customer_phone:e.target.value}))}/></label>
      <label>Town and location *<input required autoComplete="address-level2"
       value={details.customer_location} onChange={e=>setDetails(x=>({...x,customer_location:e.target.value}))}/></label>
      <label>Email (optional)<input type="email" autoComplete="email"
       value={details.customer_email} onChange={e=>setDetails(x=>({...x,customer_email:e.target.value}))}/></label>
      <label>Machine model / part notes<textarea rows={3} value={details.message}
       onChange={e=>setDetails(x=>({...x,message:e.target.value}))}/></label>
      {submitError?<p className="pc-alert" role="alert">{submitError}</p>:null}
      <button type="submit" className="pc-primary-button" disabled={submitting}>
       {submitting?"Sending securely…":"Send order for confirmation →"}</button>
     </form>
    </>}
   </aside>
  </div>:null}
  <footer className="pc-footer"><Link to="/">← CHALIN03 home</Link>
   <div><a href="tel:+233249469080">Boss: +233 24 946 9080</a>
    <a href="https://wa.me/233540713654" target="_blank" rel="noreferrer">WhatsApp: 054 071 3654</a></div>
   <span>© {new Date().getFullYear()} CHALIN 03 COMPANY LIMITED</span></footer>
 <PublicContactPanel subject="Spare parts market customer help"/>
 </main>;
}
