import {useState} from "react";
import PublicPageMeta from "../components/PublicPageMeta";
import PublicContactPanel from "../components/PublicContactPanel";
import RealPhoto from "../components/RealPhoto";
import {PHOTO_LIBRARY} from "../data/verifiedPublicPhotos";
import {siteHref} from "../config/officialSites";
import "../styles/companyExperienceV3.css";
import "../styles/chalin03PublicRefresh.css";

const SALES_PHONE="+233540713654",MAIN_PHONE="+233249469080";
const WHATSAPP="https://wa.me/233540713654?text="+encodeURIComponent("Hello CHALIN03, I would like to make an enquiry.");
const divisions=[
 {id:"excavators",index:"01",site:"excavators",label:"EQUIPMENT SALES",title:"Excavators",description:"Real machines for real work. Explore makes and model references, then request a verified quotation.",photo:PHOTO_LIBRARY.homepageExcavator,cta:"Explore excavators"},
 {id:"heavy",index:"02",site:"machines",label:"HEAVY MACHINERY",title:"Heavy-duty machines",description:"Dozers, loaders, graders, rollers and site equipment. Find the type suited to your job.",photo:PHOTO_LIBRARY.machines,cta:"Explore heavy machines"},
 {id:"transport",index:"03",site:"transport",label:"HAULAGE & LIFTING",title:"Machine transport",description:"Planning a move? Enquire about loading, low-bed haulage and machine relocation.",photo:PHOTO_LIBRARY.transport,cta:"Plan a movement"},
 {id:"vehicles",index:"04",site:"automobiles",label:"AUTOMOTIVE",title:"Automobiles",description:"Explore vehicles for individuals, companies and work sites. Discuss available specifications directly.",photo:PHOTO_LIBRARY.automobiles,cta:"Explore vehicles"},
 {id:"motorcycles",index:"05",site:"motorcycles",label:"TWO-WHEEL TRANSPORT",title:"Motorcycles",description:"Commuter and commercial motorcycles, sourced and verified to your requirements.",photo:PHOTO_LIBRARY.motorcycles,cta:"Explore motorcycles"},
 {id:"gold",index:"06",site:"gold",label:"PRECIOUS METALS",title:"Gold buying & refining",description:"A confidential route for gold-related enquiries, subject to applicable Ghanaian verification and regulation.",photo:PHOTO_LIBRARY.gold,cta:"Learn about the process"},
 {id:"hire",index:"07",site:"hire",label:"PROJECT SUPPORT",title:"Equipment hire",description:"The right equipment for earthworks and site preparation, with quotations matched to your project.",photo:PHOTO_LIBRARY.hire,cta:"Explore hire services"},
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
    <a href={siteHref("help")}>Help & contact</a>
    <a className="ce-work-link" href={siteHref("work")}>Staff portal</a>
   </nav>
  </header>
  <section className="ce-hero">
   <div className="ce-hero__copy"><div className="ce-eyebrow">Dunkwa, Ghana</div>
    <h1>CHALIN03<br/>Company Limited</h1>
    <p>Equipment sales and hire, spare parts, and machine transport from Dunkwa, Ghana.</p>
    <div className="ce-hero__actions">
     <a className="ce-button ce-button--gold" href="#our-businesses">Explore our businesses <span aria-hidden="true">↗</span></a>
     <a className="ce-button ce-button--light" href={WHATSAPP} target="_blank" rel="noopener noreferrer">WhatsApp us</a>
    </div>

   </div>
   <div className="ce-hero__visual"><RealPhoto photo={PHOTO_LIBRARY.homepageExcavator} eager className="ce-hero__photo"/>

   </div>
  </section>
  <section className="ce-trustline" aria-label="Company commitments">
   <div><strong>Direct enquiries</strong><span>Talk to the people behind the business</span></div>
   <div><strong>Distinct divisions</strong><span>A dedicated site for each service</span></div>
   <div><strong>Real information</strong><span>Verified prices, photos and availability</span></div>
  </section>
  <section className="ce-market" id="spare-parts">
   <div className="ce-market__info"><div className="ce-eyebrow ce-eyebrow--dark"><span/> OUR ONLINE SPARE-PARTS SHOP</div>
    <h2>Main Store spare parts</h2>
    <p>A dedicated market built around your actual Main Store products. Search by item or specification, use filters and sorting, see selling prices and submit your order to the CHALIN03 team for confirmation.</p>
    <div className="ce-market__features"><span>Live Main Store prices</span><span>Detailed product search</span><span>Organized shop departments</span><span>Easy order requests</span></div>
    <a className="ce-button ce-button--dark" href={siteHref("parts")}>Enter the spare-parts shop <span aria-hidden="true">↗</span></a>
    <small>All products and shop departments live at <strong>spareparts.chalin03.com</strong>.</small>
   </div>
   <div className="ce-market__media">
    <RealPhoto photo={PHOTO_LIBRARY.hoses} className="ce-market__primary"/>
    <RealPhoto photo={PHOTO_LIBRARY.filters} className="ce-market__secondary"/>
    <div className="ce-market__overprint"><small>CHALIN03</small><strong>THE PARTS<br/>MARKET</strong></div>
   </div>
  </section>
  <section className="ce-divisions" id="our-businesses">
   <div className="ce-section-head"><div className="ce-eyebrow ce-eyebrow--dark"><span/> BUSINESS DIVISIONS</div>
    <h2>Our businesses</h2>
    <p>Each division has its own dedicated website with relevant information and a direct route to our team. Images represent the type of equipment shown, not verified CHALIN03 stock.</p>
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
  <section className="ce-approach"><div><span className="ce-eyebrow">THE CHALIN03 APPROACH</span>
     <h2>Strong machines.<br/>Straightforward conversations.</h2>
     <p>Browse real machine references and parts listings. Send the details that matter. Our staff confirms current availability, identity, condition, delivery and a quotation before you make any commitment.</p>
     <a href={siteHref("help")} className="ce-button ce-button--gold">Visit customer help <span aria-hidden="true">↗</span></a>
   </div>
   <RealPhoto photo={PHOTO_LIBRARY.transport}/>
  </section>
  <section className="ce-contact" id="contact"><div><div className="ce-eyebrow ce-eyebrow--dark"><span/> SPEAK TO US</div>
   <h2>Tell us what<br/>you are looking for.</h2><p>Our team is available for parts requests, machine enquiries and service quotations. You can message us directly here on the website.</p></div>
   <div className="ce-contact__links">
    <a href={WHATSAPP} target="_blank" rel="noopener noreferrer"><span>DIRECT WHATSAPP</span><strong>WhatsApp us</strong><span aria-hidden="true">↗</span></a>
    <a href={"tel:"+MAIN_PHONE}><span>PRIMARY CONTACT</span><strong>+233 24 946 9080</strong><span aria-hidden="true">↗</span></a>
    <a href={"tel:"+SALES_PHONE}><span>SALES & SUPPORT</span><strong>054 071 3654</strong><span aria-hidden="true">↗</span></a>
   </div>
  </section>
  <footer className="ce-footer"><div><Brand inverse/><p>Dunkwa Police Barrier · Ghana</p><p>Real equipment, practical services, and people ready to help.</p></div>
   <div className="ce-footer__links"><strong>DISCOVER</strong><a href={siteHref("parts")}>Spare-parts shop</a><a href={siteHref("excavators")}>Excavators</a><a href={siteHref("machines")}>Heavy machinery</a><a href={siteHref("automobiles")}>Automobiles</a><a href={siteHref("motorcycles")}>Motorcycles</a></div>
   <div className="ce-footer__links"><strong>MORE SERVICES</strong><a href={siteHref("gold")}>Gold & refining enquiries</a><a href={siteHref("transport")}>Machine transport</a><a href={siteHref("hire")}>Equipment hire</a><a href={siteHref("help")}>Help centre</a><a href={siteHref("work")}>Staff login</a></div>
   <div className="ce-footer__end"><span>© {new Date().getFullYear()} CHALIN03 COMPANY LIMITED</span><span>Equipment photos are references. Current stock is confirmed by our staff.</span></div>
  </footer>
  <PublicContactPanel subject="CHALIN03 company website customer enquiry"/>
 </main>;
}
