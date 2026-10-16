import { Link } from "react-router";
import PublicPageMeta from "../components/PublicPageMeta";
import "../styles/equipmentBusinessExperience.css";

const divisions = [
  {
    key: "hire",
    eyebrow: "Equipment Hire Operations",
    title: "Hire equipment with complete operational control",
    description:
      "Manage enquiries, quotations, contracts, dispatch, job cards, billing, returns and fleet availability.",
    icon: "🏗️",
    points: ["Enquiries & quotations", "Contracts & dispatch", "Invoices & returns"],
  },
  {
    key: "finance",
    eyebrow: "Equipment Installment Finance",
    title: "Manage credit sales from application to ownership",
    description:
      "Handle KYC, affordability, approvals, deposits, installments, collections, delivery and ownership transfer.",
    icon: "🏦",
    points: ["Credit applications & KYC", "Installments & collections", "Delivery & ownership"],
  },
];

export default function EquipmentBusinessLandingPage() {
  const loginRoute = "/login?workspace=equipment_hire";

  return (
    <div className="equipment-business-public">
      <PublicPageMeta
        title="Equipment Business | Chalin 03 Company Limited"
        description="Equipment Hire Operations and Equipment Installment Finance are managed as two independent, secure staff divisions in Chalin 03."
        canonicalPath="/equipment-hire"
      />

      <header className="equipment-business-public__topbar">
        <a className="equipment-business-public__brand" href="/company/">
          <img src="/chalin03-logo.png" alt="Chalin 03 Company Limited" />
          <span>
            <small>Chalin 03 Company Limited</small>
            <strong>Equipment Business</strong>
          </span>
        </a>

        <nav aria-label="Equipment Business navigation">
          <a href="/company/">Company Overview</a>
          <Link className="is-primary" to={loginRoute}>
            Staff Login
          </Link>
        </nav>
      </header>

      <main>
        <section className="equipment-business-public__hero">
          <div className="equipment-business-public__hero-copy">
            <p className="equipment-business-public__eyebrow">
              Professional equipment operations in Ghana
            </p>
            <h1>
              Two divisions.
              <span>One trusted Equipment Business.</span>
            </h1>
            <p className="equipment-business-public__intro">
              Equipment Hire and Installment Finance use the same protected platform
              while keeping their staff, workflows, documents, balances and reports
              completely independent.
            </p>

            <div className="equipment-business-public__trust">
              <span>🛡️ Secure &amp; isolated</span>
              <span>👤 Role-based access</span>
              <span>📊 Clear accountability</span>
            </div>
          </div>

          <aside className="equipment-business-public__why">
            <small>Why two divisions?</small>
            <h2>Clear ownership of every transaction</h2>
            <div>
              <span aria-hidden="true">01</span>
              <p>
                <strong>Hire work stays in Hire</strong>
                Contracts, dispatch, job cards, invoices and returns never become
                Finance accounts.
              </p>
            </div>
            <div>
              <span aria-hidden="true">02</span>
              <p>
                <strong>Finance work stays in Finance</strong>
                Applications, installments, collections and ownership never become
                Hire jobs.
              </p>
            </div>
          </aside>
        </section>

        <section className="equipment-business-public__choice" aria-labelledby="equipment-business-choice-title">
          <div className="equipment-business-public__section-heading">
            <p>Choose your staff division</p>
            <h2 id="equipment-business-choice-title">
              Sign in once. Open only the work assigned to your role.
            </h2>
          </div>

          <div className="equipment-business-public__division-grid">
            {divisions.map((division) => (
              <article
                key={division.key}
                className={`equipment-business-public__division is-${division.key}`}
              >
                <div className="equipment-business-public__division-heading">
                  <span aria-hidden="true">{division.icon}</span>
                  <div>
                    <small>{division.eyebrow}</small>
                    <h3>{division.title}</h3>
                  </div>
                </div>

                <p>{division.description}</p>

                <ul>
                  {division.points.map((point) => (
                    <li key={point}>
                      <span aria-hidden="true">✓</span>
                      {point}
                    </li>
                  ))}
                </ul>

                <Link to={loginRoute}>
                  Sign in to Equipment Business
                  <span aria-hidden="true">→</span>
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="equipment-business-public__support">
          <div>
            <small>Need help?</small>
            <strong>Use the main Chalin 03 login whenever you need to start again.</strong>
          </div>
          <Link to="/login">
            Back to Main Login
            <span aria-hidden="true">↪</span>
          </Link>
        </section>
      </main>

      <footer className="equipment-business-public__footer">
        <span>© 2026 Chalin 03 Company Limited</span>
        <span>Dunkwa Police Barrier, Ghana</span>
      </footer>
    </div>
  );
}
