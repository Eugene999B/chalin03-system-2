import {useMemo,useState} from "react";
import PublicPageMeta from "../components/PublicPageMeta";
import PublicContactPanel from "../components/PublicContactPanel";
import {siteHref,sectorHref} from "../config/officialSites";
import "../styles/independentHelpCentre.css";
import "../styles/chalin03PublicRefresh.css";
const answers=[
 ["Ordering","How do I order spare parts?","Visit the dedicated spare-parts shop, find your item using search or shop departments, add it to your basket, and submit your request. Staff will confirm availability, fitment, final total and how to pay before completing any sale."],
 ["Ordering","Does the website accept online payments?","No. CHALIN03 currently accepts basket and quotation requests. Our staff verifies the actual transaction before any payment. Never send payment simply because someone sends you a link."],
 ["Ordering","Are listed spare-parts prices final?","Prices are shown from the Main Store's selling-price register. The team confirms product fit, availability and applicable charges before a sale."],
 ["Photographs","Why is a product missing its actual photo?","Some inventory records do not yet have their own verified item photograph. Rather than display a misleading photo of another part, we identify the product and let you request the exact item photograph from our team."],
 ["Machinery","Can I buy an excavator directly on the website?","The excavator website contains a model reference finder. Send the machine model, required work, location, year, condition and budget. Actual stock, hours, documentation and quotations are confirmed directly with the team."],
 ["Machinery","Are all excavator models shown available?","No. The models shown are reference examples, not verified stock listings. Only a specific confirmed quotation should be treated as an available machine."],
 ["Machinery","Can you supply bulldozers, graders and loaders?","The dedicated heavy-machinery website lets you explore those types and submit specifications. Staff will confirm availability and quote for your requirement."],
 ["Vehicles","Can I enquire about cars and motorcycles?","Yes. Cars and motorcycles each have their own CHALIN03 website. Share your preferred model, budget, condition and location for staff follow-up."],
 ["Transport","Do you arrange excavator lifting or relocation?","You can ask about machine loading, lifting and low-bed haulage. Include collection and delivery locations, machine dimensions and weight, site access, and preferred time."],
 ["Gold","What are the requirements for gold buying or refining?","Gold-related discussions require applicable Ghanaian licensing, identity and transaction verification. A website enquiry is neither a binding purchase offer nor confirmation that a transaction is lawful."],
 ["Support","Where do website messages go?","They enter the protected CHALIN03 customer-enquiries workspace. Our team can follow up using the phone and location details you provided. The form is not an instant messaging service."],
 ["Support","How can I reach the team directly?","Use the Message us button, WhatsApp +233 54 071 3654, or call +233 24 946 9080. Keep any website request reference for follow-up."]
];
const groups=["All topics","Ordering","Photographs","Machinery","Vehicles","Transport","Gold","Support"];
export default function IndependentHelpCentre(){
 const [term,setTerm]=useState(""),[group,setGroup]=useState("All topics");
 const shown=useMemo(()=>answers.filter(([g,q,a])=>(group==="All topics"||g===group)&&[q,a,g].join(" ").toLowerCase().includes(term.toLowerCase())),[term,group]);
 return <main className="hc-site">
  <PublicPageMeta title="CHALIN03 Help Centre | Orders, Equipment, Transport & Support" description="Dedicated CHALIN03 customer help. Find answers about spare-parts orders, machine enquiries, vehicle sourcing, transport and speaking directly to our team." canonicalPath="/customer-help"/>
  <div className="hc-topline">CHALIN03 CUSTOMER SUPPORT · GHANA <a href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">WHATSAPP US ↗</a></div>
  <header className="hc-nav"><a href={siteHref("company")} className="hc-brand"><img src="/chalin03-logo.png" alt="" width="45" height="45"/><span><strong>CHALIN<span>03</span></strong><small>HELP CENTRE</small></span></a><nav aria-label="Customer help navigation"><a href={siteHref("company")}>Company</a><a href={siteHref("parts")}>Parts shop</a><a href={siteHref("excavators")}>Excavators</a><a href={siteHref("work")}>Staff sign in</a></nav></header>
  <section className="hc-hero"><div className="hc-hero__intro"><span>CHALIN03 CUSTOMER CARE</span><h1>How can we<br/><em>help you?</em></h1><p>Get useful answers, find the right business website, or send a message directly to our team.</p>
   <label htmlFor="hc-query">Search the help centre<input id="hc-query" type="search" value={term} onChange={e=>setTerm(e.target.value)} placeholder="Try spare parts, delivery, excavators, payment…"/></label></div>
   <div className="hc-hero__shape" aria-hidden="true"><strong>CHALIN<br/><span>03</span></strong><small>HERE TO HELP YOU MOVE FORWARD.</small></div>
  </section>
  <section className="hc-shortcuts"><a href={siteHref("parts")}><span>01 · SHOP</span><strong>Find spare parts</strong><small>Browse our actual Main Store catalogue</small><b>↗</b></a>
   <a href={siteHref("excavators")}><span>02 · EQUIPMENT</span><strong>Find an excavator</strong><small>Explore model references and quotations</small><b>↗</b></a>
   <a href={sectorHref("general")}><span>03 · CONTACT</span><strong>Send an enquiry</strong><small>Ask our team your exact question</small><b>↗</b></a></section>
  <section className="hc-faq" id="questions"><div className="hc-faq__intro"><span>CUSTOMER QUESTIONS</span><h2>Clear answers,<br/>right here.</h2><p>Select a topic or search above for help.</p>
   <div className="hc-topics">{groups.map(g=><button key={g} className={g===group?"selected":""} type="button" onClick={()=>setGroup(g)}>{g}</button>)}</div></div>
   <div className="hc-answers"><span>{shown.length} helpful answers</span>{shown.map(([g,q,a])=><details key={q}><summary><small>{g}</small><strong>{q}</strong></summary><p>{a}</p></details>)}
   {!shown.length?<p>No help article matches. Try another term or message our team.</p>:null}</div>
  </section>
  <section className="hc-contact"><div><span>STILL NEED HELP?</span><h2>We want to hear from you.</h2><p>Use the Message us button or contact our sales team. We'll follow up using the details you provide.</p></div><div><a href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">WhatsApp us ↗</a><a href="tel:+233540713654">Call 054 071 3654 ↗</a></div></section>
  <footer className="hc-footer"><a href={siteHref("company")}>CHALIN03 Company</a><a href={siteHref("parts")}>Spare-parts market</a><a href={siteHref("work")}>Staff portal</a><small>© {new Date().getFullYear()} CHALIN03 COMPANY LIMITED</small></footer>
  <PublicContactPanel subject="CHALIN03 customer help and support"/>
 </main>;
}
