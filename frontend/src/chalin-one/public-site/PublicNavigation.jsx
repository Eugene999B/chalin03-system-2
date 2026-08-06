import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";
import "./publicNavigation.css";

const PUBLIC_ROOT = "/website";
const MAX_NAVIGATION_DEPTH = 4;

const FALLBACK_HEADER_ITEMS = Object.freeze([
  { key: "fallback-divisions", label: "Divisions", url: "/divisions" },
  { key: "fallback-projects", label: "Projects", url: "/projects" },
  { key: "fallback-equipment", label: "Equipment", url: "/equipment" },
  { key: "fallback-news", label: "News", url: "/news" },
]);

function safeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^(mailto:|tel:)/i.test(raw) && !/\s/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function publicNavigationPath(rawValue) {
  const raw = String(rawValue || "").trim();
  const external = safeExternalUrl(raw);
  if (external) return { external: true, href: external };
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;

  const [pathname, suffix = ""] = raw.split(/(?=[?#])/);
  const clean = pathname.replace(/^\/+|\/+$/g, "");
  if (!clean) return { external: false, href: PUBLIC_ROOT };
  if (clean.startsWith("website/")) {
    return { external: false, href: `/${clean}${suffix}` };
  }

  const first = clean.split("/")[0];
  const directResources = new Set([
    "news",
    "divisions",
    "leadership",
    "projects",
    "equipment",
    "locations",
    "faqs",
    "vacancies",
    "tenders",
    "testimonials",
    "forms",
  ]);
  const target = directResources.has(first)
    ? `${PUBLIC_ROOT}/${clean}`
    : `${PUBLIC_ROOT}/pages/${clean}`;
  return { external: false, href: `${target}${suffix}` };
}

function sortNavigation(items) {
  return [...items].sort((left, right) => {
    const order = Number(left.sort_order || 0) - Number(right.sort_order || 0);
    if (order !== 0) return order;
    return String(left.label || "").localeCompare(String(right.label || ""));
  });
}

export function buildPublicNavigationTree(items, location) {
  const candidates = [];
  const byKey = new Map();

  for (const rawItem of Array.isArray(items) ? items : []) {
    const key = String(rawItem?.key || "").trim();
    const label = String(rawItem?.label || "").trim();
    if (!key || !label || rawItem?.location !== location || byKey.has(key)) continue;
    const item = {
      ...rawItem,
      key,
      label,
      parent_key: String(rawItem?.parent_key || "").trim() || null,
      children: [],
    };
    candidates.push(item);
    byKey.set(key, item);
  }

  const childrenByParent = new Map();
  const roots = [];
  for (const item of candidates) {
    if (!item.parent_key) {
      roots.push(item);
      continue;
    }
    if (item.parent_key === item.key || !byKey.has(item.parent_key)) {
      continue;
    }
    const children = childrenByParent.get(item.parent_key) || [];
    children.push(item);
    childrenByParent.set(item.parent_key, children);
  }

  function materialize(item, ancestors = [], depth = 0) {
    if (depth >= MAX_NAVIGATION_DEPTH || ancestors.includes(item.key)) {
      return { ...item, children: [] };
    }
    const children = sortNavigation(childrenByParent.get(item.key) || [])
      .filter((child) => !ancestors.includes(child.key))
      .map((child) => materialize(child, [...ancestors, item.key], depth + 1));
    return { ...item, children };
  }

  return sortNavigation(roots).map((item) => materialize(item));
}

function targetIsActive(target, pathname) {
  const descriptor = publicNavigationPath(target);
  if (!descriptor || descriptor.external) return false;
  const cleanTarget = descriptor.href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const cleanPath = String(pathname || "").replace(/\/+$/, "") || "/";
  if (cleanTarget === PUBLIC_ROOT) return cleanPath === PUBLIC_ROOT;
  return cleanPath === cleanTarget || cleanPath.startsWith(`${cleanTarget}/`);
}

function branchIsActive(node, pathname) {
  return (
    targetIsActive(node.url, pathname) ||
    node.children.some((child) => branchIsActive(child, pathname))
  );
}

function navigationClass({ isActive }, baseClass) {
  return `${baseClass}${isActive ? " active" : ""}`;
}

function NavigationLink({ item, className, onNavigate }) {
  const descriptor = publicNavigationPath(item.url);
  if (!descriptor) return <span className={className}>{item.label}</span>;
  if (descriptor.external) {
    const openNewTab = item.opens_new_tab === true;
    return (
      <a
        className={className}
        href={descriptor.href}
        target={openNewTab ? "_blank" : undefined}
        rel={openNewTab ? "noreferrer" : undefined}
        onClick={onNavigate}
      >
        {item.label}
        {openNewTab ? <span className="pw-nav-external" aria-label="opens in a new tab">↗</span> : null}
      </a>
    );
  }
  return (
    <NavLink
      className={(state) => navigationClass(state, className)}
      to={descriptor.href}
      end={descriptor.href === PUBLIC_ROOT}
      onClick={onNavigate}
    >
      {item.label}
    </NavLink>
  );
}

function NavigationBranch({ node, pathname, openKeys, toggleKey, closeAll, depth = 0 }) {
  const hasChildren = node.children.length > 0;
  const open = openKeys.has(node.key);
  const active = branchIsActive(node, pathname);
  const submenuId = `pw-submenu-${node.key.replace(/[^a-z0-9_-]/gi, "-")}`;

  if (!hasChildren) {
    return (
      <li className={`pw-nav-branch pw-nav-depth-${depth}`}>
        <NavigationLink
          item={node}
          className={depth === 0 ? "pw-nav-link" : "pw-submenu-link"}
          onNavigate={closeAll}
        />
      </li>
    );
  }

  return (
    <li
      className={`pw-nav-branch pw-nav-group pw-nav-depth-${depth}`}
      data-open={open ? "true" : "false"}
      data-active={active ? "true" : "false"}
      onMouseEnter={() => toggleKey(node.key, true)}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) toggleKey(node.key, false);
      }}
      onFocusCapture={() => toggleKey(node.key, true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) toggleKey(node.key, false);
      }}
    >
      <div className="pw-nav-parent-row">
        {node.url ? (
          <NavigationLink
            item={node}
            className={depth === 0 ? "pw-nav-link pw-nav-parent-link" : "pw-submenu-link pw-nav-parent-link"}
            onNavigate={closeAll}
          />
        ) : (
          <button
            type="button"
            className={depth === 0 ? "pw-nav-link pw-nav-label-button" : "pw-submenu-link pw-nav-label-button"}
            onClick={() => toggleKey(node.key)}
          >
            {node.label}
          </button>
        )}
        <button
          type="button"
          className="pw-submenu-toggle"
          aria-expanded={open}
          aria-controls={submenuId}
          aria-label={`${open ? "Close" : "Open"} ${node.label} submenu`}
          onClick={() => toggleKey(node.key)}
        >
          <span aria-hidden="true">⌄</span>
        </button>
      </div>
      <ul id={submenuId} className="pw-submenu" data-open={open ? "true" : "false"}>
        {node.children.map((child) => (
          <NavigationBranch
            key={child.key}
            node={child}
            pathname={pathname}
            openKeys={openKeys}
            toggleKey={toggleKey}
            closeAll={closeAll}
            depth={depth + 1}
          />
        ))}
      </ul>
    </li>
  );
}

export function PublicNavigation({ items, menuOpen, onMenuClose }) {
  const location = useLocation();
  const navigationRef = useRef(null);
  const onMenuCloseRef = useRef(onMenuClose);
  const [openKeys, setOpenKeys] = useState(() => new Set());
  const publishedTree = useMemo(
    () => buildPublicNavigationTree(items, "header"),
    [items]
  );
  const tree = useMemo(
    () =>
      publishedTree.length > 0
        ? publishedTree
        : buildPublicNavigationTree(
            FALLBACK_HEADER_ITEMS.map((item, index) => ({
              ...item,
              location: "header",
              sort_order: index,
            })),
            "header"
          ),
    [publishedTree]
  );

  useEffect(() => {
    onMenuCloseRef.current = onMenuClose;
  }, [onMenuClose]);

  const closeAll = useCallback(() => {
    setOpenKeys((current) => (current.size === 0 ? current : new Set()));
    onMenuCloseRef.current?.();
  }, []);

  const toggleKey = useCallback((key, forced) => {
    setOpenKeys((current) => {
      const next = new Set(current);
      const shouldOpen = forced === undefined ? !next.has(key) : forced;
      if (shouldOpen) next.add(key);
      else next.delete(key);
      if (
        next.size === current.size &&
        [...next].every((item) => current.has(item))
      ) {
        return current;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    closeAll();
  }, [closeAll, location.pathname]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!navigationRef.current?.contains(event.target)) closeAll();
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeAll();
        navigationRef.current?.querySelector("button, a")?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeAll]);

  return (
    <nav
      ref={navigationRef}
      id="public-website-navigation"
      className="pw-navigation"
      data-open={menuOpen ? "true" : "false"}
      aria-label="Public website navigation"
    >
      <ul className="pw-navigation-list">
        {tree.map((node) => (
          <NavigationBranch
            key={node.key}
            node={node}
            pathname={location.pathname}
            openKeys={openKeys}
            toggleKey={toggleKey}
            closeAll={closeAll}
          />
        ))}
      </ul>
    </nav>
  );
}

function FooterBranch({ node, depth = 0 }) {
  return (
    <li className={`pw-footer-nav-branch pw-footer-nav-depth-${depth}`}>
      <NavigationLink item={node} className="pw-footer-nav-link" />
      {node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <FooterBranch key={child.key} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function PublicFooterNavigation({ items }) {
  const tree = useMemo(() => buildPublicNavigationTree(items, "footer"), [items]);
  if (tree.length === 0) return null;
  return (
    <ul className="pw-footer-navigation">
      {tree.map((node) => <FooterBranch key={node.key} node={node} />)}
    </ul>
  );
}

export { MAX_NAVIGATION_DEPTH };
