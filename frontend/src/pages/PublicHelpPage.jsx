import {Link} from "react-router";
import PublicPageMeta from "../components/PublicPageMeta";
import PublicContactPanel from "../components/PublicContactPanel";
import "../styles/publicDivisions.css";
import "../styles/publicHelp.css";

const questions=[
 ["How do I order spare parts?","Visit the spare-parts market, search by product name, specification or category, add the correct items to your basket, and submit an order request. Our team confirms fitment, quantity, price and payment arrangements before a sale is completed."],
 ["Are the prices final?","Spare-parts prices are taken from the Main Store product register. Availability, correct item specification and any applicable charges are verified by staff before payment. Excavators, vehicles and specialist services are quotation-only."],
 ["Can I pay on the website?","No. The public website currently accepts order and quotation requests, not online payments. Never send money based solely on an unverified message."],
 ["Can you help me choose the right excavator?","Yes. Tell us the work you need to perform, preferred brand and size, delivery location, budget and any models you have in mind. The models displayed are enquiry examples, not a promise of current stock."],
 ["Do you lift and transport excavators?","You can request a quotation for machine loading, lifting and transport. Please include collection location, delivery location, machine model, weight and preferred date. We verify suitable transport arrangements and any required approvals."],
 ["Can I ask about cars or motorcycles?","Yes. Visit the dedicated automobiles or motorcycles pages and send your desired make, model, condition and budget. We confirm available options and documentation individually."],
 ["How do I contact CHALIN03?","Use the Message us form on this website, WhatsApp us or call +233 54 071 3654. Please keep any website request reference you receive for follow-up."],
 ["What happens to messages I send?","Messages and quotation requests go to the protected website-orders and customer-enquiries workspace. Staff follow up using the details you submit; this is not an instant live-chat service."],
 ["What about gold buying and refining?","Gold-related enquiries are subject to applicable licensing, identity, counterparty and other regulatory compliance checks. We do not promise a transaction or give a binding offer through the website."],
];
export default function PublicHelpPage(){
 return <main className="division help-public">
  <PublicPageMeta title="Help & Contact | CHALIN03 Ghana" description="Get answers about spare-parts orders, excavator sales, machinery, transport, vehicles, gold enquiries and contacting CHALIN03." canonicalPath="/help"/>
  <div className="division__topbar"><span>CHALIN03 CUSTOMER HELP · DUNKWA POLICE BARRIER</span>
   <div><a href="tel:+233540713654">Call us</a><a href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">WhatsApp us</a></div></div>
  <header className="division__nav"><a className="division__logo" href="https://chalin03.com/"><img src="/chalin03-logo.png" alt="" width="43" height="43"/><strong>CHALIN<span>03</span></strong></a>
   <nav aria-label="Help navigation"><Link to="/shop">Spare parts market</Link><Link to="/excavators">Excavators</Link><Link to="/heavy-machines">Heavy machines</Link></nav>
   <Link to="/enquire" className="division__nav-cta">Send enquiry ↗</Link></header>
  <section className="help-public__hero"><span className="division__eyebrow">HOW CAN WE HELP?</span>
   <h1>Answers when you need them.</h1>
   <p>Find guidance about products, equipment enquiries, customer requests and getting in touch with the CHALIN03 team.</p>
   <div><a className="division__button division__button--gold" href="#questions">Browse questions</a>
    <Link className="division__button division__button--line" to="/enquire">Send a detailed enquiry</Link></div>
  </section>
  <section className="help-public__main" id="questions"><div><span className="division__eyebrow">HELP CENTRE</span>
   <h2>Frequently asked questions</h2><p>Select a question to see the answer.</p></div>
   <div className="help-public__faq">{questions.map(([q,a])=><details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
  </section>
  <section className="help-public__actions"><article><span>01</span><h3>Browse spare parts</h3><p>Live priced items, search, categories and order requests.</p><Link to="/shop">Open the market ↗</Link></article>
   <article><span>02</span><h3>Explore our businesses</h3><p>Excavators, heavy machines, motorcycles, cars and more.</p><Link to="/excavators">Explore excavators ↗</Link></article>
   <article><span>03</span><h3>Message us directly</h3><p>Use the customer message form or WhatsApp our sales team.</p><a href="https://wa.me/233540713654" target="_blank" rel="noopener noreferrer">WhatsApp us ↗</a></article></section>
  <footer className="division__footer"><a href="https://chalin03.com/">CHALIN03 Home</a><Link to="/enquire">Contact & enquiries</Link><Link to="/shop">Market</Link><small>© {new Date().getFullYear()} CHALIN03 COMPANY LIMITED</small></footer>
  <PublicContactPanel subject="Customer support and website help"/>
 </main>;
}
