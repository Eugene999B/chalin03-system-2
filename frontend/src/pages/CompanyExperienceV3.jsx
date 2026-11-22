import {useState} from "react";
import PublicPageMeta from "../components/PublicPageMeta";
import PublicContactPanel from "../components/PublicContactPanel";
import RealPhoto from "../components/RealPhoto";
import {PHOTO_LIBRARY} from "../data/verifiedPublicPhotos";
import {siteHref} from "../config/officialSites";
import "../styles/companyExperienceV3.css";
import "../styles/chalin03PublicRefresh.css";
import "../styles/chalin03PublicRebuild.css";

const SALES_PHONE="+233540713654",MAIN_PHONE="+233249469080";
const WHATSAPP="https://wa.me/"+MAIN_PHONE.slice(1)+"?text="+encodeURIComponent("Hello CHALIN03, I would like to make an enquiry.");
const divisions=[
 {id:"parts",site:"parts",label:"SPARE PARTS & LUBRICANTS",title:"Spare Parts Shop",description:"Browse genuine Main Store listings for filters, lubricants, tools and machine parts. Search products, compare GHS prices and send an enquiry.",photo:PHOTO_LIBRARY.parts,cta:"Browse spare parts"},
 {id:"excavators",site:"excavators",label:"EQUIPMENT SALES",title:"Excavators",description:"Real machines for real work. Explore makes and model references, then request a verified quotation.",photo:PHOTO_LIBRARY.homepageExcavator,cta:"Explore excavators"},
 {id:"heavy",site:"machines",label:"HEAVY MACHINERY",title:"Heavy-duty machines",description:"Dozers, loaders, graders, rollers and site equipment. Find the type suited to your job.",photo:PHOTO_LIBRARY.machines,cta:"Explore heavy machines"},
 {id:"transport",site:"transport",label:"HAULAGE & LIFTING",title:"Machine transport",description:"Planning a move? Enquire about loading, low-bed haulage and machine relocation.",photo:PHOTO_LIBRARY.transport,cta:"Plan a movement"},
 {id:"vehicles",site:"automobiles",label:"AUTOMOTIVE",title:"Automobiles",description:"Explore vehicles for individuals, companies and work sites. Discuss available specifications directly.",photo:PHOTO_LIBRARY.automobiles,cta:"Explore vehicles"},
 {id:"motorcycles",site:"motorcycles",label:"TWO-WHEEL TRANSPORT",title:"Motorcycles",description:"Commuter and commercial motorcycles, sourced and verified to your requirements.",photo:PHOTO_LIBRARY.motorcycles,cta:"Explore motorcycles"},
 {id:"gold",site:"gold",label:"PRECIOUS METALS",title:"Gold buying & refining",description:"A confidential route for gold-related enquiries, subject to applicable Ghanaian verification and regulation.",photo:PHOTO_LIBRARY.gold,cta:"Learn about the process"},
 {id:"hire",site:"hire",label:"PROJECT SUPPORT",title:"Equipment hire",description:"The right equipment for earthworks and site preparation, with quotations matched to your project.",photo:PHOTO_LIBRARY.hire,cta:"Explore hire services"},
];
function Brand({inverse=false}){
 return <a className={"ce-brand"+(inverse?" ce-brand--light":"")} href={siteHref("company")} aria-label="CHALIN03 main homepage">
  <img src="/chalin03-logo.png" width="50" height="50" alt=""/>
  <span><strong>CHALIN<span>03</span></strong><small>COMPANY LIMITED · GHANA</small></span></a>;
}
export default function CompanyExperienceV3(){
 const [menuOpen,setMenuOpen]=useState(false);
 return <main className="ce-site" id="top">
  <PublicPageMeta title="CHALIN03 Company Limited | Excavators, Parts, Machines & More" description="CHALIN03 Ghana — independent excavator sales, spare-parts marketplace, heavy-duty machinery, motorcycles, automobiles, gold-sector enquiries and machine transport." canonicalPath="/"/>
  <div className="ce-topline"><span>DUNKWA POLICE BARRIER · GHANA</span><span>CALL OUR TEAM <a href={"tel:"+SALES_PHONE}>054 071 3654</a></span></div>
  <header className="ce-header">
   <Brand/>
   <button className="ce-menu-button" aria-label={menuOpen?"Close navigation":"Open navigation"} aria-expanded={menuOpen} onClick={()=>setMenuOpen(v=>!v)}><span/><span/><span/></button>
   <nav className={menuOpen?"is-open":""} aria-label="Company navigation">
    <a href="#our-businesses" onClick={()=>setMenuOpen(false)}>Our businesses</a>
    <a href={siteHref("parts")}>Spare-parts shop</a>
    <a href={siteHref("excavators")}>Excavators</a>
    <a href={siteHref("machines")}>Heavy machines</a>
    <a href="#message" onClick={()=>setMenuOpen(false)}>Send a message</a>
    <a className="ce-work-link" href={siteHref("work")}>Staff portal</a>
   </nav>
  </header>
  <section className="ce-hero">
   <div className="ce-hero__copy"><div className="ce-eyebrow">Dunkwa, Ghana</div>
    <h1>CHALIN03<br/>Company Limited</h1>
    <p>Excavators, spare parts, heavy machinery, motorcycles, automobiles and equipment hire — plus machine transport and responsible gold-sector enquiries, from Dunkwa, Ghana.</p>
    <div className="ce-hero__actions">
     <a className="ce-button ce-button--gold" href="#our-businesses">Find a business <span aria-hidden="true">↓</span></a>
     <a className="ce-button ce-button--light" href={WHATSAPP} target="_blank" rel="noopener noreferrer">WhatsApp us</a>
    </div>

   </div>
   <div className="ce-hero__visual"><RealPhoto photo={PHOTO_LIBRARY.homepageExcavator} eager className="ce-hero__photo"/>

   </div>
  </section>
  <nav className="ce-trustline" aria-label="Quick links">
   <a href={siteHref("parts")}><strong>Shop spare parts <span aria-hidden="true">↗</span></strong><span>Search Main Store stock and GHS prices</span></a>
   <a href={siteHref("excavators")}><strong>Find an excavator <span aria-hidden="true">↗</span></strong><span>Browse machine types and makes</span></a>
   <a href={siteHref("transport")}><strong>Move a machine <span aria-hidden="true">↗</span></strong><span>Enquire about lifting and haulage</span></a>
  </nav>
  <section className="ce-divisions" id="our-businesses">
   <div className="ce-section-head"><div className="ce-eyebrow ce-eyebrow--dark"><span/> BUSINESS DIVISIONS</div>
    <h2>Our businesses</h2>
    <p>Browse machine and vehicle types, find project services or speak to the relevant team.</p>
   </div>
   <div className="ce-division-grid">{divisions.map(d=><article className="ce-division" key={d.id}>
     <div className="ce-division__media">
      <RealPhoto photo={d.photo}/>
     </div>
     <div className="ce-division__body">
      <span>{d.label}</span><h3>{d.title}</h3><p>{d.description}</p>
      <a href={siteHref(d.site)}>{d.cta} <span aria-hidden="true">↗</span></a>
     </div>
    </article>)}</div>
  </section>

  <section className="ce-approach" aria-labelledby="ce-approach-title">
   <div className="ce-section-head"><div className="ce-eyebrow ce-eyebrow--dark"><span/> HOW IT WORKS</div><h2 id="ce-approach-title">A clear route from enquiry to action.</h2><p>Explore the options, share your requirements and verify the details before you commit.</p></div>
   <div className="ce-approach__grid">
    <article><span>01 / EXPLORE</span><h3>Find the right business</h3><p>Browse parts, equipment and vehicle types — or tell us what you are sourcing.</p></article>
    <article><span>02 / DISCUSS</span><h3>Share the specifics</h3><p>Give us the model, job, location and budget. We can clarify compatibility and logistics.</p></article>
    <article><span>03 / VERIFY</span><h3>Confirm before proceeding</h3><p>Our team verifies availability, condition, documentation and quotation.</p></article>
   </div>
  </section>
  <section className="ce-contact" id="contact"><div><div className="ce-eyebrow ce-eyebrow--dark"><span/> SPEAK TO US</div>
   <h2>Tell us what<br/>you are looking for.</h2><p>Our team is available for parts requests, machine enquiries and service quotations. You can message us directly here on the website.</p></div>
   <div className="ce-contact__links">
    <a href={WHATSAPP} target="_blank" rel="noopener noreferrer"><span>DIRECT WHATSAPP</span><strong>WhatsApp us</strong><span aria-hidden="true">↗</span></a>
    <a href={"tel:"+MAIN_PHONE}><span>PRIMARY CONTACT</span><strong>+233 24 946 9080</strong><span aria-hidden="true">↗</span></a>
    <a href={"tel:"+SALES_PHONE}><span>SALES & SUPPORT</span><strong>054 071 3654</strong><span aria-hidden="true">↗</span></a>
   </div>
  </section>

  <section className="ce-message" id="message" aria-labelledby="ce-message-title">
   <div className="ce-message__intro"><div className="ce-eyebrow ce-eyebrow--dark"><span/> DIRECT ENQUIRIES</div>
    <h2 id="ce-message-title">Send us a message.</h2>
    <p>Questions about spare parts, excavators, transport, vehicles, heavy machinery or gold-sector services? Describe your requirements and our team can follow up.</p>
    <p className="ce-message__notice">Photos are references unless explicitly verified as actual CHALIN03 stock.</p>
   </div>
   <PublicContactPanel subject="CHALIN03 company website customer enquiry" whatsAppUrl={WHATSAPP} inline/>
  </section>
  <footer className="ce-footer"><div><Brand inverse/><p>Dunkwa Police Barrier · Ghana</p><p>Real equipment, practical services, and people ready to help.</p></div>
   <div className="ce-footer__links"><strong>DISCOVER</strong><a href={siteHref("parts")}>Spare-parts shop</a><a href={siteHref("excavators")}>Excavators</a><a href={siteHref("machines")}>Heavy machinery</a><a href={siteHref("automobiles")}>Automobiles</a><a href={siteHref("motorcycles")}>Motorcycles</a></div>
   <div className="ce-footer__links"><strong>MORE SERVICES</strong><a href={siteHref("gold")}>Gold & refining enquiries</a><a href={siteHref("transport")}>Machine transport</a><a href={siteHref("hire")}>Equipment hire</a><a href={siteHref("help")}>Help centre</a><a href={siteHref("work")}>Staff login</a></div>
   <div className="ce-footer__end"><span>© {new Date().getFullYear()} CHALIN03 COMPANY LIMITED</span><span>Equipment photos are references. Current stock is confirmed by our staff.</span></div>
  </footer>
 </main>;
}
