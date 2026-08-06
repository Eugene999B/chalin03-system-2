import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

const app = read("src/chalin-one/public-site/PublicWebsiteApp.jsx");
const navigation = read("src/chalin-one/public-site/PublicNavigation.jsx");
const css = read("src/chalin-one/public-site/publicNavigation.css");
const publicService = read("../backend/services/publicContentService.js");
const navigationService = read(
  "../backend/services/contentStudioNavigationService.js"
);

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("public shell renders governed header and footer hierarchy", () => {
  assert.match(app, /PublicNavigation/);
  assert.match(app, /PublicFooterNavigation/);
  assert.match(app, /items=\{navigation\}/);
  assert.doesNotMatch(app, /headerItems\.map|footerItems\.map/);
});

check("tree builder filters location, duplicates, orphans and cycles", () => {
  assert.match(navigation, /buildPublicNavigationTree/);
  assert.match(navigation, /rawItem\?\.location !== location/);
  assert.match(navigation, /byKey\.has\(key\)/);
  assert.match(navigation, /!byKey\.has\(item\.parent_key\)/);
  assert.match(navigation, /item\.parent_key === item\.key/);
  assert.match(navigation, /ancestors\.includes\(item\.key\)/);
  assert.match(navigation, /MAX_NAVIGATION_DEPTH = 4/);
});

check("frontend and backend enforce the same supported navigation depth", () => {
  assert.match(navigation, /MAX_NAVIGATION_DEPTH = 4/);
  assert.match(navigationService, /MAX_PARENT_DEPTH = 4/);
  assert.match(
    navigationService,
    /const itemId = Number\(result\.insertId\);\s*await assertNoNavigationCycle\(connection, itemId, snapshot\.parent_id\);/
  );
  assert.match(navigationService, /NAVIGATION_DEPTH_EXCEEDED/);
});

check("navigation remains inside the public renderer and sanitizes targets", () => {
  assert.match(navigation, /PUBLIC_ROOT = "\/website"/);
  assert.match(navigation, /directResources/);
  assert.match(navigation, /url\.username \|\| url\.password/);
  assert.match(navigation, /\["http:", "https:"\]/);
  assert.match(navigation, /raw\.startsWith\("\/\/"\)/);
  assert.match(navigation, /opens_new_tab/);
  assert.match(navigation, /rel=\{openNewTab \? "noreferrer"/);
});

check("desktop and mobile menus expose accessible controls", () => {
  assert.match(navigation, /aria-expanded=\{open\}/);
  assert.match(navigation, /aria-controls=\{submenuId\}/);
  assert.match(navigation, /aria-label=\{`\$\{open \? "Close" : "Open"\}/);
  assert.match(navigation, /event\.key === "Escape"/);
  assert.match(navigation, /pointerdown/);
  assert.match(navigation, /location\.pathname/);
  assert.match(navigation, /onFocusCapture/);
  assert.match(navigation, /onBlurCapture/);
});

check("menu lifecycle uses stable callbacks and complete effect dependencies", () => {
  assert.match(navigation, /useCallback/);
  assert.match(navigation, /const closeAll = useCallback/);
  assert.match(navigation, /const toggleKey = useCallback/);
  assert.match(navigation, /\[closeAll, location\.pathname\]/);
  assert.match(navigation, /\}, \[closeAll\]\);/);
});

check("active child routes activate their parent branch", () => {
  assert.match(navigation, /branchIsActive/);
  assert.match(navigation, /node\.children\.some/);
  assert.match(navigation, /data-active=\{active \? "true" : "false"\}/);
  assert.match(navigation, /cleanPath\.startsWith/);
  assert.match(
    css,
    /\.pw-nav-group\[data-active="true"\] > \.pw-nav-parent-row > \.pw-nav-parent-link/
  );
});

check("responsive hierarchy styles support dropdown and nested mobile layouts", () => {
  assert.match(css, /\.pw-submenu\[data-open="true"\]/);
  assert.match(css, /\.pw-submenu \.pw-submenu/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /position: static/);
  assert.match(css, /\.pw-footer-navigation/);
  assert.match(css, /@media \(max-width: 390px\)/);
});

check("bootstrap serializer preserves parent and new-tab governance fields", () => {
  assert.match(publicService, /parent\.navigation_key AS parent_key/);
  assert.match(publicService, /parent_key: row\.parent_key \|\| null/);
  assert.match(publicService, /opens_new_tab: booleanValue\(row\.opens_new_tab\)/);
  assert.match(publicService, /ORDER BY n\.navigation_location, n\.sort_order, n\.id/);
});

check("fallback navigation remains available without published header records", () => {
  assert.match(navigation, /FALLBACK_HEADER_ITEMS/);
  for (const label of ["Divisions", "Projects", "Equipment", "News"]) {
    assert.match(navigation, new RegExp(`label: "${label}"`));
  }
});

console.log(`\nCHALIN ONE public navigation hierarchy: ${passed}/10 checks passed.`);
