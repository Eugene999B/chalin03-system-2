import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

function sectionContainsPath(section, pathname) {
  return section.items.some((item) =>
    item.path === "/" ? pathname === "/" : pathname === item.path || pathname.startsWith(`${item.path}/`)
  );
}

export default function CompactSidebarNavigation({ sections, onNavigate }) {
  const location = useLocation();
  const activeSection = useMemo(
    () => sections.find((section) => sectionContainsPath(section, location.pathname))?.title || sections[0]?.title || "",
    [location.pathname, sections]
  );
  const [openSections, setOpenSections] = useState(() => new Set(activeSection ? [activeSection] : []));

  useEffect(() => {
    if (!activeSection) return;
    setOpenSections((current) => {
      if (current.has(activeSection)) return current;
      const next = new Set(current);
      next.add(activeSection);
      return next;
    });
  }, [activeSection]);

  function toggleSection(title) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  return (
    <nav className="compact-sidebar-navigation" aria-label="Workspace navigation">
      {sections.map((section) => {
        const isOpen = openSections.has(section.title);
        const isActive = section.title === activeSection;

        return (
          <section
            key={section.title}
            className={`compact-nav-section ${isActive ? "active-section" : ""}`}
          >
            <button
              type="button"
              className="compact-nav-section-button"
              onClick={() => toggleSection(section.title)}
              aria-expanded={isOpen}
            >
              <span>{section.title}</span>
              <small>{section.items.length}</small>
              <b>{isOpen ? "−" : "+"}</b>
            </button>

            {isOpen ? (
              <div className="compact-nav-items">
                {section.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/"}
                    className={({ isActive: linkActive }) =>
                      `premium-nav-link ${linkActive ? "active" : ""}`
                    }
                    onClick={onNavigate}
                    title={item.description}
                  >
                    <span className="premium-nav-icon">{item.icon}</span>
                    <span className="premium-nav-text">{item.title}</span>
                  </NavLink>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </nav>
  );
}
