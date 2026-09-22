/* SEO public homepage is intentionally served at the canonical domain root. */
import PublicPageMeta from "../components/PublicPageMeta";
import "../styles/publicCompanyHome.css";

const divisions = [
  {
    icon: "⚙️",
    title: "Spare Parts",
    description:
      "Structured parts sales, stock control, purchasing, customer accounts and reporting.",
  },
  {
    icon: "⛏️",
    title: "Mining Operations",
    description:
      "Site production, equipment, fuel, expenses, incidents and accountable operational control.",
  },
  {
    icon: "🚜",
    title: "Equipment Hire",
    description:
      "Equipment enquiries, quotations, contracts, assignments, invoices and fleet availability.",
  },
];

export default function PublicCompanyHomePage() {
  return (
    <main className="public-company-home">
      <PublicPageMeta
        title="Chalin 03 Company Limited | Ghana"
        description="Chalin 03 Company Limited provides spare-parts, mining-operations and equipment-hire services in Ghana."
        canonicalPath="/"
      />

      <header className="public-company-home__topbar">
        <a href="/" className="public-company-home__brand">
          <img src="/chalin03-logo.png" alt="Chalin 03 Company Limited logo" />
          <span>
            <small>Group Operations</small>
            <strong>Chalin 03 Company Limited</strong>
          </span>
        </a>
        <a className="public-company-home__login" href="/login">
          Staff Portal
        </a>
      </header>

      <section className="public-company-home__hero">
        <div>
          <p className="public-company-home__eyebrow">
            Professional business operations in Ghana
          </p>
          <h1>Chalin 03 Company Limited</h1>
          <p className="public-company-home__lead">
            Spare-parts sales, mining operations and equipment hire under one
            professional standard for accountable records and secure digital
            operations.
          </p>
          <div className="public-company-home__actions">
            <a href="#divisions">Explore Our Divisions</a>
            <a href="tel:+233249469080" className="secondary">
              Call +233 24 946 9080
            </a>
          </div>
        </div>

        <aside className="public-company-home__card">
          <img src="/chalin03-logo.png" alt="Chalin 03 logo" />
          <strong>Serving Ghana</strong>
          <span>Dunkwa Police Barrier, Ghana</span>
          <span>+233 24 946 9080</span>
        </aside>
      </section>

      <section id="divisions" className="public-company-home__section">
        <div className="public-company-home__section-head">
          <p className="public-company-home__eyebrow">Our business divisions</p>
          <h2>Independent operations, one professional standard.</h2>
        </div>

        <div className="public-company-home__grid">
          {divisions.map((division) => (
            <article key={division.title} className="public-company-home__division">
              <span className="public-company-home__icon" aria-hidden="true">
                {division.icon}
              </span>
              <h3>{division.title}</h3>
              <p>{division.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-company-home__assurance">
        <div>
          <p className="public-company-home__eyebrow">How we operate</p>
          <h2>Clear records and accountable control.</h2>
        </div>
        <p>
          Chalin 03 uses separated business workspaces and controlled access so
          each team works within its assigned responsibilities.
        </p>
      </section>

      <footer className="public-company-home__footer">
        <span>© Chalin 03 Company Limited</span>
        <a href="/company/">Company Overview</a>
      </footer>
    </main>
  );
}
