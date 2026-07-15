import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../styles/workspaceHelp.css";

const helpContent = {
  mining: {
    icon: "⛏️",
    title: "Mining Operations Guide",
    home: "/mining",
    sections: [
      [
        "1. Create Mining sites",
        "Only an administrator creates or edits Mining sites. Open Mining Sites, create the site code, name, location, material, production unit and target.",
      ],
      [
        "2. Record each shift",
        "Use Daily Site Logs for the supervisor, workforce, weather, opening notes and closing notes. Approve the log after checking it.",
      ],
      [
        "3. Record production and machines",
        "Production belongs to a Mining site. Equipment Operations records the excavator, operator, meters, working hours, idle time and breakdown time.",
      ],
      [
        "4. Control fuel and costs",
        "Fuel Management records receipts and machine issues. Mining Expenses records site operating costs. These records never use Spare Parts stores.",
      ],
      [
        "5. Review safety and reports",
        "Record incidents immediately, assign corrective action and close them only after review. Use Mining Documents for site reports and the Mining workbook.",
      ],
      [
        "6. Preserve audit evidence",
        "Use your own account, keep records under the correct site, review Activity Log entries, and never delete or rewrite approved operational history merely to hide an error.",
      ],
    ],
  },
  equipment_hire: {
    icon: "🚜",
    title: "Equipment Hire Guide",
    home: "/equipment-hire-operations",
    sections: [
      [
        "1. Create Hire bases and yards",
        "Only an administrator creates or edits Equipment Hire bases, yards, offices, workshops or depots. These are separate from Spare Parts stores.",
      ],
      [
        "2. Register customers and enquiries",
        "Create the customer, record the requested equipment, customer work site, charging method and expected dates.",
      ],
      [
        "3. Prepare quotation and contract",
        "Set the rate, minimum charge, mobilization, operator, fuel responsibility and terms. Approve the quotation before creating the contract.",
      ],
      [
        "4. Assign, dispatch and record work",
        "Assign only available Fleet equipment. Dispatch records the opening condition and meter. Job cards record approved billable hours.",
      ],
      [
        "5. Invoice, receive payment and return",
        "Create invoices from approved work, record deposits and payments, then complete a return inspection before releasing the machine.",
      ],
      [
        "6. Preserve audit evidence",
        "Use your own account, keep records under the correct Hire location, review Activity Log entries, and do not let the same person create and approve every sensitive action.",
      ],
    ],
  },
};

export default function WorkspaceHelpPage({ workspace }) {
  const { role } = useAuth();
  const content = helpContent[workspace] || helpContent.mining;

  return (
    <section className="workspace-help-page">
      <header>
        <div className="workspace-help-icon" aria-hidden="true">
          {content.icon}
        </div>
        <div>
          <p>Independent Business User Guide</p>
          <h1>{content.title}</h1>
          <span>
            Current access: {String(role || "staff").toUpperCase()}. Follow the
            workflow below without using Spare Parts stores.
          </span>
        </div>
      </header>

      <div className="workspace-help-grid">
        {content.sections.map(([title, description]) => (
          <article key={title}>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </div>

      <footer>
        <Link to={content.home}>← Return to workspace dashboard</Link>
        <span>
          Use controlled corrections and contact the system administrator before changing approved records.
        </span>
      </footer>
    </section>
  );
}
