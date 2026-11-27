"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const read=p=>fs.readFileSync(path.resolve(__dirname,"../../",p),"utf8");
const app=read("frontend/src/App.jsx");
test("only Staff hostname mounts the dedicated research portal; Work keeps operational routes",()=>{
 assert.match(app,/window\.location\.hostname === "staff\.chalin03\.com" \? <StaffBusinessPortal \/> : <Routes>/);
 assert.match(app,/<AuthProvider>/);
 for(const route of ["new-sale","debts","sales-history","exports","users-settings"])assert.ok(app.includes('path="'+route+'"'));
 assert.match(app,/<WorkspaceShell allowedWorkspaces=\{SPARE_PARTS_WORKSPACE\}>/);
});
test("Staff research preserves administrator access control and uses only its scoped calculation endpoint",()=>{
 const portal=read("frontend/src/pages/StaffBusinessPortal.jsx"),component=read("frontend/src/components/StaffSalesResearch.jsx"),routes=read("backend/routes/settingsRoutes.js");
 assert.match(portal,/user\.is_original_system_administrator!==true/);
 assert.match(component,/axiosClient\.get\("\/settings\/staff-sales-research"\)/);
 assert.doesNotMatch(portal,/localStorage|setPercent|assumed_partner/);
 assert.doesNotMatch(component,/setPercent|assumed_partner/);
 assert.match(routes,/router\.get\("\/staff-sales-research",requireAuth,requireRole\("admin"\),ownershipReadAccess/);
 assert.match(routes,/req\.get\("origin"\)!=="https:\/\/staff\.chalin03\.com"/);
});
