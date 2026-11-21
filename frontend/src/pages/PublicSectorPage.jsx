import {useMemo,useState} from "react";
import {Link} from "react-router";
import PublicPageMeta from "../components/PublicPageMeta";
import PublicContactPanel from "../components/PublicContactPanel";
import "../styles/publicDivisions.css";

const excavatorModels={
 Caterpillar:["CAT 305","CAT 307","CAT 308","CAT 312","CAT 320","CAT 323","CAT 325","CAT 330","CAT 336","CAT 349"],
 Komatsu:["PC55","PC78","PC130","PC200","PC210","PC220","PC300","PC350","PC400"],
 Hitachi:["ZX55","ZX120","ZX200","ZX210","ZX240","ZX330","ZX350","ZX470"],
 Volvo:["EC140","EC210","EC220","EC250","EC300","EC350","EC380"],
 Hyundai:["R140","R210","R215","R220","R290","R330"],
 SANY:["SY75","SY135","SY215","SY245","SY365","SY500"],
 XCMG:["XE80","XE135","XE215","XE260","XE370"],
 "Doosan / Develon":["DX140","DX225","DX300","DX350"],
 JCB:["JS130","JS200","JS220","JS330"],
 Kobelco:["SK135","SK200","SK210","SK260","SK350"],
 LiuGong:["922E","925E","936E"],
 "John Deere":["135G","210G","350G"],
 Kubota:["U35","KX057"],
 CASE:["CX130","CX210"],
};
const typed=(icon,name,detail)=>({icon,name,detail});
const DIVISIONS={
 excavators:{
  eyebrow:"EXCAVATOR SALES & SOURCING",title:"Find an excavator built for the job.",
  lead:"Explore mini, medium and large excavator model references. Tell us the brand, model, year, preferred condition and budget. Our team confirms actual availability and supplies a quotation.",
  hero:"/images/home/v1/excavators.webp",heroAlt:"Excavator working at a site",
  intro:"Explore excavator models",note:"All models below are examples for enquiry, not a live inventory listing or an offer of a particular machine.",
  specialties:["Mini & compact excavators","Medium crawler excavators","Heavy crawler excavators","Long-reach applications","Site loading & transport"],
  sector:"excavators",icon:"🚜",
 },
 "heavy-machines":{
  eyebrow:"CONSTRUCTION & INDUSTRIAL EQUIPMENT",title:"Heavy machinery for serious work.",
  lead:"From earthmoving and roadworks to lifting, loading and site support, explore machinery types and send the specifications you need.",
  hero:"/images/home/v1/hire.webp",heroAlt:"Heavy site equipment at work",
  intro:"Machinery types",note:"These are categories available for enquiry and sourcing, not a claim that a specific machine is currently in stock.",
  specialties:["Earthmoving & quarry work","Road building","Loading & lifting","Transport & logistics"],
  sector:"heavy-machines",icon:"🏗️",
  items:[
   typed("🚜","Bulldozers","Tracked dozers for clearing, grading and pushing earth"),
   typed("🏗️","Wheel loaders","Loading soil, aggregate and bulk materials"),
   typed("🛣️","Motor graders","Road construction, reshaping and fine grading"),
   typed("⚙️","Compactors & rollers","Compaction for roads, foundations and earthworks"),
   typed("🚛","Articulated dump trucks","High-volume material haulage on rough terrain"),
   typed("🚧","Backhoe loaders","General-purpose trenching, loading and utility work"),
   typed("🏗️","Mobile cranes","Lifting operations with site-specific load plans"),
   typed("📦","Forklifts & telehandlers","Material handling and lifting on industrial sites"),
   typed("🚜","Skid-steer loaders","Compact loading and site preparation"),
   typed("🛠️","Crawler loaders","Tracked loading in difficult terrain"),
   typed("🚚","Low-bed trailers","Moving heavy equipment between job sites"),
   typed("⚒️","Rock breakers & attachments","Excavator attachments for specialized work"),
  ]
 },
 motorcycles:{
  eyebrow:"MOTORCYCLE SALES & SOURCING",title:"Two wheels. More ways to move.",
  lead:"Tell us what you need the bike for, your preferred engine capacity, budget and location. We will confirm current makes, registration details and condition.",
  hero:null,intro:"Motorcycle categories",sector:"motorcycles",icon:"🏍️",
  note:"These categories are for customer enquiries. Availability, brand, condition and price must be confirmed before a purchase.",
  specialties:["Daily commuting","Delivery & commercial","Off-road riding","Utility & cargo"],
  items:[
   typed("🏍️","Commuter motorcycles","Practical daily transport and fuel-efficient models"),
   typed("🛵","Automatic scooters","Simple city riding and convenient commuting"),
   typed("📦","Delivery motorcycles","Commercial bikes for dispatch and delivery work"),
   typed("🏞️","Trail & off-road bikes","Rough-road and utility riding"),
   typed("🛣️","Touring motorcycles","Long-distance and highway use"),
   typed("⚡","Sport motorcycles","Performance-oriented models on request"),
   typed("🛺","Three-wheelers","Cargo and commercial tricycle enquiries"),
   typed("🔧","Motorcycle parts & accessories","Accessories and service items by specification"),
  ]
 },
 automobiles:{
  eyebrow:"CAR SALES & SOURCING",title:"Your next vehicle starts here.",
  lead:"Explore vehicle types and tell us the make, model, year, condition, transmission and budget you prefer. We can discuss sourcing and quotation requirements.",
  hero:null,intro:"Explore vehicle types",sector:"automobiles",icon:"🚘",
  note:"Vehicle types are illustrative categories, not advertised cars in current stock. Photos, VIN and documents must be verified for any actual offer.",
  specialties:["Private & family vehicles","Commercial transport","Pickups & utility","Vehicle sourcing"],
  items:[
   typed("🚙","SUVs & crossovers","Family, utility and rough-road vehicle requests"),
   typed("🚘","Saloons & sedans","Everyday and executive cars"),
   typed("🚗","Hatchbacks","Compact, practical city vehicles"),
   typed("🛻","Pickups & 4×4s","Worksites, farms and field operations"),
   typed("🚐","Vans & minibuses","Passenger and business transport"),
   typed("🚌","Buses","Commercial passenger transport enquiries"),
   typed("🚛","Commercial trucks","Goods movement and heavy-duty road transport"),
   typed("🚗","Imported / used vehicles","Condition, inspection and documentation subject to verification"),
  ]
 },
 gold:{
  eyebrow:"PRECIOUS METALS ENQUIRIES",title:"Gold buying & refining enquiries.",
  lead:"Contact our team about gold-buying requirements and refining-related services. We will discuss documentation and legally permitted next steps before any engagement.",
  hero:null,intro:"How we handle enquiries",sector:"gold",icon:"◆",
  note:"Gold transactions are subject to applicable Ghana licensing, counterparty verification, identification and other legal requirements. This website is not an open offer to purchase gold.",
  specialties:["Buying enquiries","Refining enquiries","Documentation","Regulatory verification"],
  items:[
   typed("01","Tell us your requirements","Describe the proposed gold-related service and where it would take place"),
   typed("02","Verify eligibility","We check applicable licensing, identity and transaction requirements"),
   typed("03","Discuss the process","We explain the lawful next steps and any supporting information needed"),
   typed("04","Arrange a responsible follow-up","Only proceed after relevant documentation and compliance checks"),
  ]
 },
 "machine-transport":{
  eyebrow:"LIFTING, LOADING & HAULAGE",title:"Move heavy machines with a plan.",
  lead:"Request lifting and site-to-site transport for excavators and other heavy equipment. Send loading location, destination, machine dimensions and approximate weight.",
  hero:"/images/home/v1/hire.webp",heroAlt:"Heavy machine at a worksite",
  intro:"Transport services",sector:"machine-transport",icon:"🚚",
  note:"Transport availability, route suitability, permits, escort requirements and a final price depend on the specific movement.",
  specialties:["Lifting & loading","Low-bed haulage","Site-to-site movement","Delivery coordination"],
  items:[
   typed("🏗️","Machine lifting & loading","Plan loading with suitable equipment and site conditions"),
   typed("🚛","Low-bed transportation","Excavator and heavy equipment haulage between locations"),
   typed("📍","Site-to-site relocation","Coordinate collection, destination and access requirements"),
   typed("📋","Movement planning","Share weight, dimensions, route and required timing"),
  ]
 },
 "equipment-hire":{
  eyebrow:"EQUIPMENT HIRE & SITE SUPPORT",title:"The right machine when you need it.",
  lead:"Request a quotation for equipment hire, earthworks, trenches and site preparation. Describe the project, location, duration and preferred machine size.",
  hero:"/images/home/v1/hire.webp",heroAlt:"Excavator on an active worksite",
  intro:"Hire enquiries",sector:"equipment-hire",icon:"🚜",
  note:"Hire terms, machine and operator availability, fuel, mobilization and safety conditions are confirmed per project.",
  specialties:["Construction work","Earthmoving","Site preparation","Short- & long-term requests"],
  items:[
   typed("🚜","Excavator hire","Earthworks, trenching and foundation excavations"),
   typed("🏞️","Site clearing","Land preparation and access improvement"),
   typed("🛣️","Road & drainage projects","Construction and infrastructure support"),
   typed("🚚","Mobilization planning","Discuss equipment delivery and site access"),
  ]
 }
};
function hrefFor(sector,model){return "/enquire?sector="+encodeURIComponent(sector)+(model?"&model="+encodeURIComponent(model):"");}
export default function PublicSectorPage({sector="excavators"}){
 const data=DIVISIONS[sector]||DIVISIONS.excavators;
 const [search,setSearch]=useState("");
 const [brand,setBrand]=useState("all");
 const choices=useMemo(()=>sector==="excavators"?
  Object.entries(excavatorModels).flatMap(([maker,models])=>models.map(model=>({name:model,brand:maker,icon:"🚜",detail:"Ask for specifications, year, condition and a quotation"}))):
  (data.items||[]).map(item=>({...item,brand:"All types"})),[sector,data]);
 const results=useMemo(()=>choices.filter(item=>
  (brand==="all"||item.brand===brand) &&
  [item.name,item.brand,item.detail].join(" ").toLowerCase().includes(search.trim().toLowerCase())
 ),[choices,brand,search]);
 return <main className="division">
  <PublicPageMeta title={data.title+" | CHALIN03 Ghana"} description={data.lead} canonicalPath={"/"+sector}/>
  <div className="division__topbar"><span>CHALIN03 COMPANY LIMITED · DUNKWA, GHANA</span>
   <div><a href="tel:+233540713654">Call us</a><a href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">WhatsApp us</a></div></div>
  <header className="division__nav">
   <a className="division__logo" href="https://chalin03.com/"><img src="/chalin03-logo.png" width="43" height="43" alt=""/><strong>CHALIN<span>03</span></strong></a>
   <nav aria-label="Business navigation"><Link to="/shop">Spare parts market</Link><Link to="/excavators">Excavators</Link><Link to="/heavy-machines">Heavy machines</Link><Link to="/customer-help">Help</Link></nav>
   <Link className="division__nav-cta" to={hrefFor(sector)}>Request a quote ↗</Link>
  </header>
  <section className={"division__hero"+(!data.hero?" division__hero--graphic":"")}>
   <div className="division__hero-copy"><span className="division__eyebrow">{data.eyebrow}</span>
    <h1>{data.title}</h1><p>{data.lead}</p>
    <div className="division__hero-actions">
     <a className="division__button division__button--gold" href="#explore">Explore {sector==="excavators"?"models":"options"} ↓</a>
     <Link className="division__button division__button--line" to={hrefFor(sector)}>Get a quotation ↗</Link>
    </div>
    <span className="division__hero-note">Enquire online · Personal quotations · Ghana-wide enquiries</span>
   </div>
   {data.hero?<img className="division__hero-image" src={data.hero} alt={data.heroAlt} width="800" height="600" loading="eager" decoding="async"/>:
    <div className="division__hero-emblem" aria-hidden="true"><span>{data.icon}</span><strong>CHALIN03</strong></div>}
  </section>
  <section className="division__specialties" aria-label="Services"><strong>We can help with</strong>
   <div>{data.specialties.map(v=><span key={v}>{v}</span>)}</div>
  </section>
  <section className="division__explore" id="explore">
   <div className="division__section-title"><div><span className="division__eyebrow">EXPLORE OUR DIVISION</span>
    <h2>{data.intro}</h2><p>{data.note}</p></div>
    <Link to={hrefFor(sector)}>Need something else? Ask us ↗</Link></div>
   <div className="division__tools">
    <label htmlFor="division-search">Search types or models<input id="division-search" type="search" value={search}
     placeholder={sector==="excavators"?"Try CAT 320, Komatsu, ZX200…":"Find a service or vehicle type…"}
     onChange={e=>setSearch(e.target.value)}/></label>
    {sector==="excavators"?<label htmlFor="division-brand">Manufacturer
     <select id="division-brand" value={brand} onChange={e=>setBrand(e.target.value)}>
      <option value="all">All manufacturers</option>{Object.keys(excavatorModels).map(v=><option key={v} value={v}>{v}</option>)}
     </select></label>:null}
    <span>{results.length} reference {results.length===1?"option":"options"}</span>
   </div>
   {results.length?<div className="division__grid">{results.map(item=>
    <article className="division__card" key={item.brand+"-"+item.name}>
     <span className="division__card-mark" aria-hidden="true">{item.icon}</span>
     <div><small>{sector==="excavators"?item.brand:data.eyebrow}</small>
      <h3>{item.name}</h3><p>{item.detail}</p></div>
     <Link to={hrefFor(sector,sector==="excavators"?item.brand+" "+item.name:item.name)}>Ask about this ↗</Link>
    </article>)}</div>:<div className="division__empty">No examples match. You can still send us your exact specifications.</div>}
  </section>
  <section className="division__trust"><div><span className="division__eyebrow">OUR PROCESS</span>
    <h2>Tell us what you need. We verify the details.</h2><p>Share the model, intended work, location and budget. Our staff will discuss actual availability, condition, documentation and the next steps. No machine is sold or reserved by completing an enquiry.</p></div>
    <div><Link className="division__button division__button--gold" to={hrefFor(sector)}>Send a website enquiry</Link>
     <a className="division__button division__button--line" href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">WhatsApp us</a></div>
  </section>
  <footer className="division__footer"><a href="https://chalin03.com/">CHALIN03 Home</a><Link to="/shop">Spare parts market</Link><Link to="/customer-help">Help & contact</Link>
   <small>© {new Date().getFullYear()} CHALIN03 COMPANY LIMITED · Pictures and listed models do not confirm actual inventory.</small></footer>
  <PublicContactPanel subject={data.title}/>
 </main>;
}
