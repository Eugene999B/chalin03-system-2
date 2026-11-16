import { useState } from "react";
import PublicPageMeta from "../components/PublicPageMeta";
import "../styles/publicCompanyHome.css";

const PHONE = "+233249469080";
const DISPLAY_PHONE = "+233 24 946 9080";
// Versioned WebP files live on CHALIN03's Cloudflare Pages domain.
const PHOTO = {
  hero: "/images/home/v1/hero-desktop.webp",
  heroMobile: "/images/home/v1/hero-mobile.webp",
  equipment: "/images/home/v1/excavators.webp",
  parts: "/images/home/v1/parts.webp",
  hire: "/images/home/v1/hire.webp",
};
const ENQUIRIES = {
  excavators: "Hello CHALIN03, I would like to ask about excavators for sale. Can you help with available machines and prices?",
  parts: "Hello CHALIN03, I need spare parts for an excavator. I can share the model and part number.",
  hire: "Hello CHALIN03, I would like to enquire about hiring an excavator for a project.",
  general: "Hello CHALIN03, I would like to make an enquiry.",
};
function whatsApp(message) {
  return "https://wa.me/233249469080?text=" + encodeURIComponent(message);
}

const services = [
  {
    number: "01",
    id: "excavators",
    label: "BUY",
    title: "Excavators for sale",
    copy: "Find a machine that fits your work and your budget. Ask us about available options.",
    action: "Enquire about excavators",
    image: PHOTO.equipment,
    alt: "Excavator working on a real construction site",
    message: ENQUIRIES.excavators,
  },
  {
    number: "02",
    id: "spare-parts",
    label: "PARTS",
    title: "Excavator spare parts",
    copy: "Engine, hydraulic and undercarriage parts. Tell us the model or part number.",
    action: "Find a part",
    image: PHOTO.parts,
    alt: "Real mechanical parts and tools inside a working parts workshop",
    message: ENQUIRIES.parts,
  },
  {
    number: "03",
    id: "hire",
    label: "HIRE",
    title: "Need a machine on site?",
    copy: "Ask about excavator hire for earthworks, site preparation and other projects.",
    action: "Ask about hiring",
    image: PHOTO.hire,
    alt: "Excavator in use on a construction and demolition site",
    message: ENQUIRIES.hire,
  },
];

export default function PublicCompanyHomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <main className="ch-home" id="top">
      <PublicPageMeta
        title="Excavators, Spare Parts & Equipment Hire | CHALIN03 Ghana"
        description="Find affordable excavators, ask for excavator spare parts and enquire about equipment hire with CHALIN03 in Ghana."
        canonicalPath="/"
      />
      <div className="ch-home__utility">
        <span>Dunkwa Police Barrier, Ghana</span>
        <a href={"tel:" + PHONE}>Talk to us: {DISPLAY_PHONE}</a>
      </div>
      <header className="ch-home__header">
        <a className="ch-home__brand" href="#top" onClick={closeMenu} aria-label="CHALIN03 homepage">
          <img src="/chalin03-logo.png" alt="" width="48" height="48" />
          <span><strong>CHALIN<span>03</span></strong><small>Company Limited</small></span>
        </a>

        <button
          className="ch-home__menu-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="ch-home-menu"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span /><span /><span />
        </button>
        <nav
          id="ch-home-menu"
          className={"ch-home__nav" + (menuOpen ? " is-open" : "")}
          aria-label="Main navigation"
        >
          <a href="#excavators" onClick={closeMenu}>Excavators</a>
          <a href="#spare-parts" onClick={closeMenu}>Spare parts</a>
          <a href="#hire" onClick={closeMenu}>Hiring</a>
          <a href="#about" onClick={closeMenu}>About</a>
          <a href="#contact" onClick={closeMenu}>Contact</a>
          <a className="ch-home__staff-link" href="/login" onClick={closeMenu}>Staff login <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <section className="ch-home__hero" aria-labelledby="ch-home-hero-title">
        <picture className="ch-home__hero-art">
          <source media="(max-width: 760px)" srcSet={PHOTO.heroMobile} />
          <img
            className="ch-home__hero-image"
            src={PHOTO.hero}
            alt="A yellow excavator with a large digging bucket at an active worksite"
            width="1600"
            height="980"
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        <div className="ch-home__hero-content">
          <span className="ch-home__overline"><span className="ch-home__overline-line" /> EQUIPMENT & PARTS · GHANA</span>
          <h1 id="ch-home-hero-title">Built for the <em>work ahead.</em></h1>
          <p>Excavators at fair prices. Parts to keep them running. People ready to help you find what you need.</p>
          <div className="ch-home__hero-actions">
            <a className="ch-home__button ch-home__button--gold" href="#excavators">Explore our services <span aria-hidden="true">↗</span></a>
            <a className="ch-home__button ch-home__button--outline" href={"tel:" + PHONE}>Call our team</a>
          </div>
          <div className="ch-home__hero-footnote">Based at Dunkwa Police Barrier <span aria-hidden="true">•</span> Serving enquiries across Ghana</div>
        </div>
        <a className="ch-home__hero-scroll" href="#services">Discover more <span aria-hidden="true">↓</span></a>
      </section>

      <section className="ch-home__intro" id="services" aria-label="What we offer">
        <span className="ch-home__section-tag">WHAT WE DO</span>
        <div className="ch-home__intro-row">
          <h2>Good equipment.<br/><span>Good people.</span></h2>
          <p>Buying, fixing or hiring? Start here. We’ll help you work out the next step.</p>
        </div>
        <div className="ch-home__service-grid">
          {services.map((service) => (
            <article className="ch-home__service-card" id={service.id} key={service.id}>
              <div className="ch-home__service-picture">
                <img src={service.image} alt={service.alt} width="960" height="720" loading="lazy" decoding="async" />
                <span className="ch-home__service-number">{service.number} / {service.label}</span>
              </div>
              <div className="ch-home__service-body">
                <h3>{service.title}</h3>
                <p>{service.copy}</p>
                <a href={whatsApp(service.message)} target="_blank" rel="noopener noreferrer">
                  {service.action} <span aria-hidden="true">↗</span>
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="ch-home__parts-strip" aria-labelledby="ch-home-parts-title">
        <div>
          <span className="ch-home__section-tag">SPARE PARTS</span>
          <h2 id="ch-home-parts-title">Got a part number?</h2>
          <p>Send it to us with your machine model. We’ll help you check the right part.</p>
          <a className="ch-home__text-link" href={whatsApp(ENQUIRIES.parts)} target="_blank" rel="noopener noreferrer">
            Ask about a part <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="ch-home__parts-list" aria-label="Spare parts enquiries">
          <span>Hydraulics</span><span>Engine parts</span><span>Undercarriage</span><span>Filters & seals</span>
        </div>
      </section>

      <section className="ch-home__about" id="about">
        <div className="ch-home__about-copy">
          <span className="ch-home__section-tag">ABOUT CHALIN03</span>
          <h2>Here when the job needs to get done.</h2>
          <p>We work with customers looking for machinery, spare parts and practical support. If you're unsure what you need, get in touch and tell us about the job.</p>
          <a href={"tel:" + PHONE} className="ch-home__text-link">Speak with our team <span aria-hidden="true">↗</span></a>
        </div>
        <div className="ch-home__about-image">
          <img src={PHOTO.equipment} alt="Excavator working in an earthmoving area" width="960" height="720" loading="lazy" decoding="async" />
          <div className="ch-home__about-caption"><span>CHALIN03</span><strong>Let's get to work.</strong></div>
        </div>
      </section>

      <section className="ch-home__contact" id="contact">
        <span className="ch-home__section-tag">LET'S TALK</span>
        <h2>Tell us what you're looking for.</h2>
        <p>An excavator, a spare part or a machine for hire — give us a call or send a message.</p>
        <div className="ch-home__contact-actions">
          <a className="ch-home__button ch-home__button--gold" href={"tel:" + PHONE}>Call {DISPLAY_PHONE}</a>
          <a className="ch-home__button ch-home__button--outline" href={whatsApp(ENQUIRIES.general)} target="_blank" rel="noopener noreferrer">Send an enquiry <span aria-hidden="true">↗</span></a>
        </div>
        <span className="ch-home__contact-location">Dunkwa Police Barrier · Ghana</span>
      </section>

      <footer className="ch-home__footer">
        <div className="ch-home__footer-top">
          <div>
            <strong>CHALIN<span>03</span></strong>
            <p>Excavators · Spare parts · Equipment hire</p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#excavators">Excavators</a>
            <a href="#spare-parts">Spare parts</a>
            <a href="#hire">Hiring</a>
            <a href="/login">Staff login</a>
          </nav>
        </div>
        <div className="ch-home__footer-bottom">
          <span>© {new Date().getFullYear()} CHALIN03 Company Limited</span>
          <span>Photography is illustrative; ask us for current machines and stock.</span>
          <a href="#top">Back to top ↑</a>
        </div>
      </footer>
    </main>
  );
}
