"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const app=fs.readFileSync(path.resolve(__dirname,"../../frontend/src/App.jsx"),"utf8");
test("work and staff use the same protected application route tree",()=>{
 assert.match(app,/\["work\.chalin03\.com", "staff\.chalin03\.com"\]\.includes\(hostname\)/);
 assert.doesNotMatch(app,/StaffBusinessPortal/);
 assert.match(app,/<AuthProvider>/);
 assert.match(app,/path="new-sale"/);
 assert.match(app,/path="debts"/);
 assert.match(app,/path="sales-history"/);
 assert.match(app,/path="exports"/);
 assert.match(app,/path="users-settings"/);
 assert.match(app,/<WorkspaceShell allowedWorkspaces=\{SPARE_PARTS_WORKSPACE\}>/);
});
