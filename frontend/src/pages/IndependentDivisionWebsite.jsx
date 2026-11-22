import {useMemo,useState} from "react";
import PublicPageMeta from "../components/PublicPageMeta";
import PublicContactPanel from "../components/PublicContactPanel";
import RealPhoto from "../components/RealPhoto";
import {PHOTO_LIBRARY,EXACT_MODEL_PHOTOS,REAL_TYPE_PHOTOS} from "../data/verifiedPublicPhotos";
import {siteHref,sectorHref} from "../config/officialSites";
import "../styles/independentDivisionWebsite.css";
import "../styles/chalin03PublicRefresh.css";

const modelFamilies={
 "Caterpillar":["CAT 305","CAT 307","CAT 308","CAT 312","CAT 315","CAT 318","CAT 320","CAT 323","CAT 325","CAT 330","CAT 336","CAT 340","CAT 349","CAT 352","CAT 374","CAT 395"],
 "Komatsu":["PC30","PC55","PC78","PC88","PC130","PC160","PC200","PC210","PC220","PC240","PC300","PC350","PC400","PC450","PC490","PC650"],
 "Hitachi":["ZX55","ZX75","ZX85","ZX120","ZX135","ZX160","ZX200","ZX210","ZX240","ZX250","ZX330","ZX350","ZX470","ZX490","ZX690"],
 "Volvo":["EC55","EC75","EC140","EC210","EC220","EC250","EC300","EC350","EC380","EC480","EC530"],
 "Hyundai":["R80","R140","R160","R210","R215","R220","R290","R330","HX145","HX220","HX300"],
 "SANY":["SY35","SY55","SY75","SY95","SY135","SY155","SY215","SY245","SY265","SY365","SY500"],
 "XCMG":["XE35","XE55","XE80","XE135","XE155","XE215","XE260","XE305","XE370","XE490"],
 "Doosan / Develon":["DX55","DX140","DX180","DX225","DX255","DX300","DX350","DX420","DX530"],
 "JCB":["JS55","JS85","JS130","JS145","JS160","JS200","JS220","JS330"],
 "Kobelco":["SK55","SK75","SK135","SK200","SK210","SK260","SK350","SK500"],
 "LiuGong":["906","908","915","920","922E","925E","936E","950E"],
 "John Deere":["60G","85G","135G","160G","210G","245G","300G","350G","470G"],
 "Kubota":["KX033","KX057","U35","U55","KX080"],
 "CASE":["CX55","CX130","CX160","CX210","CX250","CX300","CX350"],
 "Sumitomo":["SH75","SH130","SH200","SH210","SH240","SH350"],
 "Bobcat":["E35","E50","E55","E85","E145"],
 "Liebherr":["R 914","R 920","R 924","R 926","R 930","R 936","R 950"],
};
const option=(name,description,photo=null)=>({name,description,photo});
const divisionData={
 excavators:{
  tone:"amber",line:"EXCAVATOR SALES & SOURCING",lead:"Excavators for your next big job.",intro:"Find the machine type and model that fits your project. Browse real photographed references where available, then send the requirements for a current quotation.",
  photo:PHOTO_LIBRARY.excavators,headline:"Excavators, built for the heavy work.",site:"excavators",sector:"excavators",
  servicePoints:["Crawler excavators","Mini excavators","Large-scale earthmoving","Demolition & specialty machines"],
  catalogTitle:"Explore excavator makes & models",catalogIntro:"The model list is a reference library, not live inventory. We verify actual makes, year, condition, hours, documentation and price for each enquiry.",
  steps:["Select a machine model","Share intended work and location","Confirm availability & condition","Receive a verified private quotation"]
 },
 "heavy-machines":{
  tone:"copper",line:"HEAVY-DUTY EQUIPMENT",lead:"Build, lift and move more.",intro:"Heavy-duty machinery has its own dedicated CHALIN03 website — explore equipment for construction, roadworks, mining support and materials handling.",
  photo:PHOTO_LIBRARY.machines,headline:"The strength behind every serious project.",site:"machines",sector:"heavy-machines",
  servicePoints:["Earthmoving","Road building","Lifting & loading","Specialist equipment"],
  catalogTitle:"Explore heavy machines",catalogIntro:"Each type below is available for enquiry. Exact equipment listings and photographs are confirmed with the team.",
  options:[
   option("Bulldozers","Crawler dozers for grading, clearing and pushing material.",REAL_TYPE_PHOTOS["Bulldozers"]),
   option("Wheel loaders","Material loading and movement on sites.",REAL_TYPE_PHOTOS["Wheel loaders"]),
   option("Motor graders","Road shaping, profiling and fine grading.",REAL_TYPE_PHOTOS["Motor graders"]),
   option("Compactors & rollers","Soil, asphalt and foundation compaction.",REAL_TYPE_PHOTOS["Compactors & rollers"]),
   option("Backhoe loaders","Multi-purpose digging and loading equipment."),
   option("Skid-steer loaders","Compact site movement and utility work."),
   option("Articulated dump trucks","Haulage of soil and aggregates."),
   option("Mobile cranes","Heavy-duty lifting by project specification."),
   option("Forklifts & telehandlers","Industrial material handling and lifting."),
   option("Excavator breakers & attachments","Tooling for specialized ground conditions."),
   option("Low-bed trailers","Heavy equipment transportation.",REAL_TYPE_PHOTOS["Low-bed trailers"]),
   option("Crawler loaders","Tracked loading in difficult conditions.")
  ],steps:["Choose the machinery type","Send site & workload details","Confirm availability & specification","Receive the individual quotation"]
 },
 automobiles:{
  tone:"navy",line:"AUTOMOBILE SALES & SOURCING",lead:"Find a vehicle that works for you.",intro:"An independent automobile website for pickup trucks, family vehicles, commercial fleets and sourcing requests.",
  photo:PHOTO_LIBRARY.automobiles,headline:"Cars and commercial vehicles for the road ahead.",site:"automobiles",sector:"automobiles",
  servicePoints:["Pickups & 4×4s","SUVs & family vehicles","Passenger cars","Business transport"],
  catalogTitle:"Explore vehicle types",catalogIntro:"Vehicle types are enquiry options, not promises of cars in stock. We verify photos, VIN, condition, year and documents before a sale.",
  options:[
   option("Pickups & 4×4s","Hilux-style utility pickups and work vehicles.",REAL_TYPE_PHOTOS["Pickups & 4×4s"]),
   option("SUVs & crossovers","Family and rough-road vehicles."),
   option("Saloons & sedans","Everyday and executive cars."),
   option("Hatchbacks","Compact practical city transport."),
   option("Vans & minibuses","Business and group transport."),
   option("Commercial trucks","Cargo movement and transport businesses."),
   option("Passenger buses","Group and commercial services."),
   option("Imported & used vehicles","Enquiries including verified inspection and documents.")
  ],steps:["Describe your preferred vehicle","Share year, condition & budget","Review available verified options","Confirm documentation & quotation"]
 },
 motorcycles:{
  tone:"red",line:"MOTORCYCLE SALES & SOURCING",lead:"Ride for work. Ride for life.",intro:"A specialist motorcycle site with the models and kinds of bikes people actually need — for commuting, dispatch, commercial use and everyday riding.",
  photo:PHOTO_LIBRARY.motorcycles,headline:"Two wheels. Endless possibilities.",site:"motorcycles",sector:"motorcycles",
  servicePoints:["Commuter bikes","Delivery motorcycles","Scooters","Utility & trail bikes"],
  catalogTitle:"Explore motorcycle types",catalogIntro:"The bikes pictured are real examples, not a guarantee of current CHALIN03 stock. We verify engine capacity, documentation and condition.",
  options:[
   option("Commuter motorcycles","Fuel-efficient daily transport and traditional road bikes.",REAL_TYPE_PHOTOS["Commuter motorcycles"]),
   option("Delivery motorcycles","Utility and dispatch motorcycles.",REAL_TYPE_PHOTOS["Delivery motorcycles"]),
   option("Automatic scooters","Convenient urban commuting."),
   option("Trail & off-road bikes","Rugged options for uneven terrain."),
   option("Touring motorcycles","Long-distance riding."),
   option("Sport motorcycles","Performance-focused bikes by request."),
   option("Cargo tricycles","Three-wheel cargo and commercial vehicles."),
   option("Motorcycle service parts","Parts and accessories by exact specification.")
  ],steps:["Pick your motorcycle type","Share engine size and budget","Verify available models","Confirm documents & price"]
 },
 gold:{
  tone:"gold",line:"GOLD-SECTOR ENQUIRIES",lead:"Gold buying & refining enquiries.",intro:"Discuss gold-related transactions and refining requirements through our dedicated contact channel, with responsible verification and applicable Ghanaian regulatory requirements.",
  photo:PHOTO_LIBRARY.gold,headline:"A clear process for precious-metal enquiries.",site:"gold",sector:"gold",
  servicePoints:["Buying enquiries","Refining enquiries","Documentation","Regulatory checks"],
  catalogTitle:"How enquiries are handled",catalogIntro:"This website does not offer binding precious-metal purchases or represent that a proposed transaction has regulatory approval.",
  options:[
   option("Buying enquiries","Begin with the proposed quantity, location and transaction details."),
   option("Refining service enquiries","Ask about lawful refining arrangements and service requirements."),
   option("Counterparty verification","Identity and supporting documentation are reviewed."),
   option("Compliance review","Any engagement must meet applicable Ghana licensing and regulatory rules.")
  ],steps:["Describe your enquiry","Discuss identity & documentation","Confirm legally permitted terms","Arrange a verified follow-up"]
 },
 "machine-transport":{
  tone:"orange",line:"HEAVY EQUIPMENT TRANSPORT",lead:"Move your machines with confidence.",intro:"Specialist enquiries for excavator lifting, low-bed transport, loading and site-to-site relocation across agreed locations.",
  photo:PHOTO_LIBRARY.transport,headline:"Heavy machines. Expert movement.",site:"transport",sector:"machine-transport",
  servicePoints:["Excavator lifting","Loading & recovery","Low-bed haulage","Site delivery"],
  catalogTitle:"Transport and lifting requests",catalogIntro:"Transport arrangements depend on the machine, load specifications, route, site access and applicable permits.",
  options:[
   option("Excavator lifting & loading","Plan safe movement onto transport vehicles."),
   option("Low-bed haulage","Move construction machinery between sites.",REAL_TYPE_PHOTOS["Low-bed trailers"]),
   option("Machine relocation","Coordinate pickup, delivery, loading and offloading."),
   option("Transport planning","Share weight, dimensions, route and time window.")
  ],steps:["Send pickup & delivery towns","Share weight and dimensions","Review vehicle & route suitability","Receive the transportation quotation"]
 },
 "equipment-hire":{
  tone:"green",line:"EQUIPMENT HIRE & SITE SUPPORT",lead:"The machine you need, when you need it.",intro:"Enquire about excavator hire and construction site support, with equipment requirements and availability confirmed per project.",
  photo:PHOTO_LIBRARY.hire,headline:"More work completed, one hire at a time.",site:"hire",sector:"equipment-hire",
  servicePoints:["Short-term hire","Long-term hire","Earthworks","Mobilization support"],
  catalogTitle:"Equipment hire requests",catalogIntro:"Hire quotes depend on confirmed machine/operator availability, site conditions, fuel terms and duration.",
  options:[
   option("Excavator hire","Earthmoving, excavation and foundation works.",PHOTO_LIBRARY.komatsu),
   option("Site clearing","Land clearing and preparation."),
   option("Roadwork support","Earthworks and drainage preparation."),
   option("Equipment mobilization","Delivery planning, loading and site access.",PHOTO_LIBRARY.transport)
  ],steps:["Describe your project","Set your site and duration","Confirm suitable equipment","Receive tailored hire terms"]
 }
};
function Brand(){
 return <a className="bd-brand" href={siteHref("company")}><img src="/chalin03-logo.png" alt="" width="44" height="44"/><span><strong>CHALIN<span>03</span></strong><small>BUSINESS DIVISIONS</small></span></a>;
}
export default function IndependentDivisionWebsite({sector="excavators"}){
 const data=divisionData[sector]||divisionData.excavators;
 const [search,setSearch]=useState("");
 const [maker,setMaker]=useState("all");
 const [menuOpen,setMenuOpen]=useState(false);
 const available=useMemo(()=>sector==="excavators"?
  Object.entries(modelFamilies).flatMap(([brand,models])=>models.map(name=>({brand,name,photo:EXACT_MODEL_PHOTOS[brand+"|"+name]||null,description:"Contact us for exact specifications, availability and price."}))):
  (data.options||[]).map(i=>({...i,brand:"Equipment types"})),[sector,data]);
 const results=useMemo(()=>available.filter(i=>(maker==="all"||i.brand===maker)&&
  (i.name+" "+i.brand+" "+i.description).toLowerCase().includes(search.toLowerCase().trim())),[available,maker,search]);
 const enquiry=sectorHref(data.sector);
 return <main className={"bd-site bd-site--"+data.tone}>
  <PublicPageMeta title={data.lead+" | CHALIN03 Ghana"} description={data.intro} canonicalPath={sector==="equipment-hire"?"/equipment-hire-services":"/"+sector}/>
  <div className="bd-topline"><span>CHALIN03 COMPANY LIMITED · GHANA</span><div><a href="tel:+233540713654">054 071 3654</a><a href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">WHATSAPP US</a></div></div>
  <header className="bd-header"><Brand/>
   <button className="bd-menu-btn" type="button" onClick={()=>setMenuOpen(v=>!v)} aria-label={menuOpen?"Close navigation":"Open navigation"} aria-expanded={menuOpen}><span/><span/><span/></button>
   <nav className={menuOpen?"is-open":""} aria-label="Division website navigation">
    <a href={siteHref(data.site)} onClick={()=>setMenuOpen(false)}>Overview</a><a href="#catalog" onClick={()=>setMenuOpen(false)}>{sector==="excavators"?"Models":"Explore types"}</a>
    <a href={siteHref("parts")}>Spare-parts shop</a><a href={siteHref("help")}>Help</a><a className="bd-nav-cta" href={enquiry}>Request a quote ↗</a>
   </nav>
  </header>
  <section className="bd-hero"><div className="bd-hero__copy">
    <div className="bd-kicker">{data.line}</div>
    <h1>{data.lead}</h1><p>{data.intro}</p>
    <div className="bd-hero__buttons"><a className="bd-button bd-button--primary" href="#catalog">Explore {sector==="excavators"?"excavators":"options"} ↓</a>
     <a className="bd-button bd-button--outline" href={enquiry}>Get a private quote ↗</a></div>
    <div className="bd-hero__bottom">DUNKWA, GHANA <span/> DIRECT CUSTOMER ENQUIRIES</div>
   </div>
   <div className="bd-hero__photo"><RealPhoto photo={data.photo} eager/><div className="bd-photo-overprint"><span>CHALIN03</span><strong>{data.headline}</strong></div></div>
  </section>
  <section className="bd-capabilities" aria-label="This business specializes in"><strong>WHAT WE CAN HELP WITH</strong>
   {data.servicePoints.map(point=><span key={point}>{point}</span>)}</section>
  <section className="bd-catalog" id="catalog"><div className="bd-section-heading"><div>
    <span className="bd-kicker">EXPLORE THIS DIVISION</span><h2>{data.catalogTitle}</h2><p>{data.catalogIntro}</p>
   </div><a href={enquiry}>Need something else? Send an enquiry ↗</a></div>
   <div className="bd-filters"><label htmlFor="bd-find">Search {sector==="excavators"?"models and manufacturers":"equipment or service types"}
    <input id="bd-find" type="search" placeholder={sector==="excavators"?"Try Komatsu PC200, CAT 320, ZX210…":"What kind are you looking for?"}
      value={search} onChange={e=>setSearch(e.target.value)}/></label>
    {sector==="excavators"?<label htmlFor="bd-maker">Manufacturer
     <select id="bd-maker" value={maker} onChange={e=>setMaker(e.target.value)}>
      <option value="all">All manufacturers</option>{Object.keys(modelFamilies).map(brand=><option key={brand} value={brand}>{brand}</option>)}
     </select></label>:null}
    <div className="bd-results"><strong>{results.length}</strong><span>reference {results.length===1?"option":"options"}</span></div>
   </div>
   {results.length?<div className="bd-products">
    {results.map(item=><article key={item.brand+"-"+item.name} className="bd-item">
     {item.photo?<RealPhoto photo={item.photo} className="bd-item__photo"/>:
      <div className="bd-item__text-photo"><small>CHALIN03 REFERENCE</small><strong>{item.name}</strong><span>Verified individual photograph not yet available</span></div>}
     <div className="bd-item__body"><span className="bd-item__meta">{item.brand}</span><h3>{item.name}</h3><p>{item.description}</p>
      <a href={sectorHref(data.sector,sector==="excavators"?item.brand+" "+item.name:item.name)}>Enquire about {item.name} <span>↗</span></a></div>
    </article>)}</div>:
    <div className="bd-no-results"><h3>Nothing matches that search yet.</h3><p>Send us the exact machine or service you need. Our staff can review your request.</p><a href={enquiry}>Send the enquiry →</a></div>}
  </section>
  <section className="bd-process"><div><div className="bd-kicker">HOW TO WORK WITH US</div><h2>From your requirements<br/>to the next step.</h2>
    <p>These pages show real examples and the service types we handle. Photos are not proof of inventory or a promised transaction — our team verifies details before confirmation.</p></div>
   <ol>{data.steps.map((step,i)=><li key={step}><span>{String(i+1).padStart(2,"0")}</span><strong>{step}</strong></li>)}</ol></section>
  <section className="bd-contact"><div><div className="bd-kicker">CONTACT THIS DIVISION</div><h2>Let's talk about your requirements.</h2>
    <p>Share the work, machine, budget and location. Our team will follow up with the appropriate information.</p></div>
   <div className="bd-contact__actions"><a href={enquiry}>Send an enquiry on this website ↗</a><a href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">WhatsApp us ↗</a><a href="tel:+233540713654">Call 054 071 3654 ↗</a></div></section>
  <footer className="bd-footer"><Brand/><nav aria-label="CHALIN03 other website links"><a href={siteHref("company")}>Company home</a><a href={siteHref("parts")}>Spare-parts shop</a><a href={siteHref("help")}>Help centre</a><a href={siteHref("work")}>Staff sign in</a></nav>
    <small>© {new Date().getFullYear()} CHALIN03 COMPANY LIMITED · Reference photographs are credited and do not represent confirmed stock.</small></footer>
  <PublicContactPanel subject={data.line+" enquiry"}/>
 </main>;
}
