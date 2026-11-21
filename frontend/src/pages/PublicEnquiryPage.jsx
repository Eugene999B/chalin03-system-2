import {useState} from "react";
import {Link,useSearchParams} from "react-router";
import axiosClient from "../api/axiosClient";
import PublicPageMeta from "../components/PublicPageMeta";
import PublicContactPanel from "../components/PublicContactPanel";
import "../styles/publicCommerce.css";

const sectors=[
 {id:"excavators",name:"Excavators for sale",icon:"🚜",desc:"Mini, medium and large excavators for earthmoving, roads, mining and civil works. Share your budget, preferred model, year and operating hours.",image:"/images/home/v1/excavators.webp"},
 {id:"heavy-machines",name:"Heavy-duty machines",icon:"🏗️",desc:"Wheel loaders, bulldozers, graders, compactors, backhoes and site equipment. Ask for the machine type and intended workload.",image:"/images/home/v1/hire.webp"},
 {id:"machine-transport",name:"Excavator lifting & transport",icon:"🚚",desc:"Arrange a quotation for loading, lifting, low-bed movement and safe delivery of heavy equipment between locations.",image:"/images/home/v1/hire.webp"},
 {id:"spare-parts",name:"Spare parts & workshop supplies",icon:"⚙️",desc:"Filters, engine parts, hydraulic hoses, oils, hammers, spanners, teeth and undercarriage components from our main store.",image:"/images/home/v1/parts.webp"},
 {id:"gold",name:"Gold buying & refining enquiries",icon:"◆",desc:"Discuss gold-sector buying and refining requirements. All potential transactions are subject to applicable Ghana licensing, identification, verification and compliance.",image:"/images/home/v1/hero-desktop.webp"},
 {id:"motorcycles",name:"Motorcycles",icon:"🏍️",desc:"Motorcycle sales and sourcing enquiries. Ask about available makes, sizes, registration documentation and service support.",image:"/images/home/v1/parts.webp"},
 {id:"automobiles",name:"Cars & automobiles",icon:"🚗",desc:"Car sales and sourcing enquiries, including saloon cars, pickups, SUVs and commercial vehicles. Specifications and availability are confirmed directly.",image:"/images/home/v1/hero-desktop.webp"},
 {id:"equipment-hire",name:"Equipment hire & site support",icon:"🏞️",desc:"Short- and long-term excavator hire for trenches, foundations, clearing, mining support and civil projects.",image:"/images/home/v1/hire.webp"},
 {id:"general",name:"Other business enquiry",icon:"☎",desc:"Tell the CHALIN03 team what you need. We will assess your request and call you with the next step.",image:"/images/home/v1/parts.webp"},
];
const excavatorModels={
 "Caterpillar":["CAT 305","CAT 307","CAT 308","CAT 312","CAT 320","CAT 323","CAT 325","CAT 330","CAT 336","CAT 349"],
 "Komatsu":["PC55","PC78","PC130","PC200","PC210","PC220","PC300","PC350","PC400"],
 "Hitachi":["ZX55","ZX120","ZX200","ZX210","ZX240","ZX330","ZX350","ZX470"],
 "Volvo":["EC140","EC210","EC220","EC250","EC300","EC350","EC380"],
 "Hyundai":["R140","R210","R215","R220","R290","R330"],
 "SANY":["SY75","SY135","SY215","SY245","SY365","SY500"],
 "XCMG":["XE80","XE135","XE215","XE260","XE370"],
 "Doosan / Develon":["DX140","DX225","DX300","DX350"],
 "JCB":["JS130","JS200","JS220","JS330"],
 "Kobelco":["SK135","SK200","SK210","SK260","SK350"],
 "Other requested makes":["LiuGong","Sumitomo","CASE","John Deere","Kubota","Bobcat","Liebherr"],
};
const freshKey=()=>globalThis.crypto?.randomUUID?.()||
 "e95f9365-6ca0-44a3-8661-"+Math.random().toString(16).slice(2).padEnd(12,"0").slice(0,12);
export default function PublicEnquiryPage(){
 const [params]=useSearchParams();
 const initial=sectors.some(s=>s.id===params.get("sector"))?params.get("sector"):"excavators";
 const [sector,setSector]=useState(initial);
 const [model,setModel]=useState(params.get("model")||"");
 const [name,setName]=useState(""),[phone,setPhone]=useState("");
 const [location,setLocation]=useState(""),[email,setEmail]=useState("");
 const [message,setMessage]=useState(""),[sending,setSending]=useState(false);
 const [reference,setReference]=useState(""),[error,setError]=useState("");
 const [key,setKey]=useState(freshKey);
 async function submit(e){
  e.preventDefault();if(sending)return;
  setSending(true);setError("");
  try{
   const enquiry=sectors.find(s=>s.id===sector);
   const {data}=await axiosClient.post("/public-commerce/requests",{
    request_type:sector==="general"?"message":
      sector==="excavators"||sector==="heavy-machines"||sector==="automobiles"||sector==="motorcycles"?
       "equipment_enquiry":"service_enquiry",
    client_key:key,customer_name:name,customer_phone:phone,
    customer_location:location,customer_email:email,
    subject:enquiry?.name||"CHALIN03 enquiry",
    message:(model?"Interested in: "+model+". ":"")+message,
   },{timeout:16000});
   setReference(data.reference||"Submitted");
   setKey(freshKey());
  }catch(e){setError(e.response?.data?.message||"Unable to send enquiry. Please WhatsApp or call us.");}
  finally{setSending(false)}
 }
 function chooseModel(brand,value){
  setSector("excavators");setModel(brand+" "+value);
  document.getElementById("pc-enquiry-form")?.scrollIntoView({behavior:"smooth",block:"start"});
 }

 return <main className="pc-site pc-enquiry-site">
  <PublicPageMeta title="Excavators, Cars, Gold Sector, Haulage & More | CHALIN03"
   description="Ask CHALIN03 about excavator sales, heavy equipment, motorcycles, cars, machine lifting and transport, or gold-sector services in Ghana."
   canonicalPath="/enquire"/>
  <header className="pc-header"><Link to="/" className="pc-logo"><img src="/chalin03-logo.png" alt=""/>
    <span><b>CHALIN<span>03</span></b><small>Business Enquiries</small></span></Link>
   <nav aria-label="Enquiry navigation"><Link to="/">Home</Link><Link to="/shop">Shop spare parts</Link><Link to="/excavators">Excavators</Link><Link to="/help">Help</Link><Link to="/login">Staff login</Link></nav>
  </header>
  <section className="pc-enquiry-hero"><div><span className="pc-eyebrow">CHALIN03 · DUNKWA · GHANA</span>
    <h1>Big jobs.<br/><em>Real conversations.</em></h1>
    <p>Whether you're buying an excavator, moving one to a site, sourcing a car or discussing a specialist project, tell us what you need and our team will respond.</p>
    <div className="pc-hero-points"><span>Personal quotations</span><span>Machines & transport</span><span>Ghana-wide enquiries</span></div>
   </div><img src="/images/home/v1/excavators.webp" alt="Excavator at a work site"/></section>
  <section className="pc-industry-explorer">
   <div className="pc-section-heading"><div><span className="pc-eyebrow">WHAT WE CAN HELP WITH</span><h2>Explore our business sectors</h2>
    <p>All machinery, vehicle, transport and specialist service prices are provided privately after confirming requirements.</p></div></div>
   <div className="pc-industry-grid">{sectors.map(s=><article key={s.id} className="pc-industry-card">
    <img src={s.image} alt={"Illustrative photograph for "+s.name} loading="lazy"/>
    <div><span>{s.icon} {s.name}</span><p>{s.desc}</p>
     <button type="button" onClick={()=>{setSector(s.id);document.getElementById("pc-enquiry-form")?.scrollIntoView({behavior:"smooth"});}}>
      Enquire about this →</button></div></article>)}</div>
  </section>
  <section className="pc-models">
   <div className="pc-section-heading"><div><span className="pc-eyebrow">EXCAVATOR MODEL FINDER</span>
     <h2>Tell us the machine you're looking for.</h2>
     <p>These are model examples customers commonly request, <strong>not a claim that every model is in stock</strong>. We verify current availability, condition and price privately.</p></div></div>
   <div className="pc-models-grid">{Object.entries(excavatorModels).map(([brand,models])=>
    <div key={brand} className="pc-model-group"><h3>{brand}</h3><div>{models.map(value=><button type="button"
      key={value} onClick={()=>chooseModel(brand,value)}>{value}</button>)}</div></div>)}</div>
  </section>
  <section className="pc-enquiry-contact" id="pc-enquiry-form">
   <div className="pc-contact-copy"><span className="pc-eyebrow">DIRECT TO OUR TEAM</span>
    <h2>Request your quote</h2><p>Complete the short form and our staff will see your enquiry in their secure CHALIN03 inbox. We do not collect payment through this form.</p>
    <div className="pc-contact-method"><strong>Customer enquiries</strong>
      <a href="tel:+233249469080">Call +233 24 946 9080</a>
      <a target="_blank" rel="noreferrer" href="https://wa.me/233249469080">WhatsApp us</a></div>
    <div className="pc-contact-method"><strong>Sales & enquiries</strong>
      <a href="tel:+233540713654">Call 054 071 3654</a>
      <a target="_blank" rel="noreferrer" href="https://wa.me/233540713654">WhatsApp 054 071 3654</a></div>
   </div>
   <div className="pc-form-panel">
    {reference?<div className="pc-enquiry-success" role="status"><h3>Thank you. Your request is in.</h3>
      <p>Reference: <strong>{reference}</strong>. Our team will contact you. Keep the reference for follow-up.</p>
      <button type="button" onClick={()=>{setReference("");setMessage("");setModel("");}}>Send another enquiry</button></div>:
    <form className="pc-contact-form" onSubmit={submit}>
     <label>What are you interested in? *<select value={sector} onChange={e=>setSector(e.target.value)}>
       {sectors.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
     {model?<label>Selected model<input value={model} onChange={e=>setModel(e.target.value)}/></label>:null}
     <label>Your full name *<input required minLength={2} value={name} autoComplete="name" onChange={e=>setName(e.target.value)}/></label>
     <label>Phone / WhatsApp *<input required type="tel" value={phone} autoComplete="tel" onChange={e=>setPhone(e.target.value)}/></label>
     <label>Your town / location *<input required value={location} autoComplete="address-level2" onChange={e=>setLocation(e.target.value)}/></label>
     <label>Email (optional)<input type="email" value={email} autoComplete="email" onChange={e=>setEmail(e.target.value)}/></label>
     <label>Describe your requirements *<textarea required minLength={5} rows={5}
      placeholder="Machine model, intended work, approximate year, delivery location or spare-part number…"
      value={message} onChange={e=>setMessage(e.target.value)}/></label>
     {error?<p className="pc-alert" role="alert">{error}</p>:null}
     <button className="pc-primary-button" type="submit" disabled={sending}>{sending?"Sending…":"Send my enquiry →"}</button>
     <p className="pc-help-note">We only use these contact details to respond to your request. Prices and availability will be confirmed directly. Gold-sector transactions require legal compliance and verification.</p>
    </form>}
   </div>
  </section>
  <footer className="pc-footer"><Link to="/">← Return home</Link><Link to="/shop">Shop parts →</Link>
   <span>© {new Date().getFullYear()} CHALIN 03 COMPANY LIMITED</span></footer>
 <PublicContactPanel subject="General business quotation and enquiries"/>
 </main>;
}
