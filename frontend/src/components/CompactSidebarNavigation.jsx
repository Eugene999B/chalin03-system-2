import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router";

function sectionContainsPath(section, pathname) {
  return section.items.some((item) =>
    item.path === "/"
      ? pathname === "/"
      : pathname === item.path || pathname.startsWith(`${item.path}/`)
  );
}

function readMobileNavigationMode() {
  return typeof window !== "undefined"
    ? window.matchMedia("(max-width: 920px)").matches
    : false;
}

export default function CompactSidebarNavigation({ sections, onNavigate }) {
  const location = useLocation();
  const activeSection = useMemo(
    () =>
      sections.find((section) =>
        sectionContainsPath(section, location.pathname)
      )?.title ||
      sections[0]?.title ||
      "",
    [location.pathname, sections]
  );

  const [isMobileNavigation, setIsMobileNavigation] = useState(
    readMobileNavigationMode
  );
  const [openSections, setOpenSections] = useState(
    () => new Set(activeSection ? [activeSection] : [])
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 920px)");
    const updateMode = () => setIsMobileNavigation(media.matches);

    updateMode();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", updateMode);
      return () => media.removeEventListener("change", updateMode);
    }

    media.addListener(updateMode);
    return () => media.removeListener(updateMode);
  }, []);

  useEffect(() => {
    if (!activeSection) return;

    setOpenSections((current) => {
      if (isMobileNavigation) {
        return new Set([activeSection]);
      }

      if (current.has(activeSection)) return current;

      const next = new Set(current);
      next.add(activeSection);
      return next;
    });
  }, [activeSection, isMobileNavigation]);

  function toggleSection(title) {
    setOpenSections((current) => {
      const isAlreadyOpen = current.has(title);

      if (isMobileNavigation) {
        return isAlreadyOpen ? new Set() : new Set([title]);
      }

      const next = new Set(current);
      if (isAlreadyOpen) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  return (
    <nav
      className={`compact-sidebar-navigation ${
        isMobileNavigation ? "is-mobile-navigation" : ""
      }`}
      aria-label="Workspace navigation"
    >
      {sections.map((section) => {
        const isOpen = openSections.has(section.title);
        const isActive = section.title === activeSection;
        const sectionId = `compact-nav-${section.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")}`;

        return (
          <section
            key={section.title}
            className={`compact-nav-section ${
              isActive ? "active-section" : ""
            }`}
          >
            <button
              type="button"
              className="compact-nav-section-button"
              onClick={() => toggleSection(section.title)}
              aria-expanded={isOpen}
              aria-controls={sectionId}
            >
              <span>{section.title}</span>
              <small>{section.items.length}</small>
              <b>{isOpen ? "−" : "+"}</b>
            </button>

            {isOpen ? (
              <div className="compact-nav-items" id={sectionId}>
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
                    <span className="premium-nav-icon" aria-hidden="true" />
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
