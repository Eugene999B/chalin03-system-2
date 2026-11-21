import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const app=read("src/App.jsx");
const sector=read("src/pages/PublicSectorPage.jsx");
const help=read("src/pages/PublicHelpPage.jsx");
const home=read("src/pages/PublicCompanyHomePage.jsx");
const shop=read("src/pages/PublicShopPage.jsx");
const enquiry=read("src/pages/PublicEnquiryPage.jsx");
const contact=read("src/components/PublicContactPanel.jsx");
const api=read("src/api/apiBaseUrl.js");
const server=read("../backend/server.js");
const backend=read("../backend/routes/publicCommerceRoutes.js");
const redirects=read("public/_redirects");
for(const [route,page] of [
 ["/excavators","excavators"],["/heavy-machines","heavy-machines"],
 ["/motorcycles","motorcycles"],["/automobiles","automobiles"],
 ["/gold","gold"],["/machine-transport","machine-transport"],
 ["/equipment-hire-services","equipment-hire"]]){
 assert.ok(app.includes('path="'+route+'"'),"Missing dedicated route "+route);
 assert.ok(home.includes('"/'+page+'"')||home.includes('"/equipment-hire-services"'),"Homepage not linked to "+route);
 assert.ok(redirects.includes(route+" / 200"),"Pages refresh route missing "+route);
}
assert.ok(app.includes('path="/customer-help"'),"Public help route missing");
assert.ok(app.includes('path="help"'),"Protected staff help must remain available");
assert.ok(!app.includes('path="/help" element={<PublicHelpPage'),"Public help must not steal staff route");
assert.ok(home.includes('ch-home__market-showcase'));
assert.ok(home.includes('href="/shop"'));
assert.ok(home.includes('PublicContactPanel'));
for(const item of ["Caterpillar","Komatsu","Hitachi","Volvo","SANY","Kobelco","Doosan / Develon"]){
 assert.ok(sector.includes(item),"Missing model manufacturer "+item);
}
for(const item of ["wheel loaders","Bulldozers","Motorcycle","gold","Automobiles"]){
 assert.ok(sector.toLowerCase().includes(item.toLowerCase()),"Missing business option "+item);
}
assert.ok(sector.includes("not a live inventory listing"),"Excavator examples cannot be presented as real stock");
assert.ok(help.includes("Frequently asked questions"));
assert.ok(contact.includes('request_type:"message"'),"Messages must enter real staff inbox");
assert.ok(contact.includes("client_key:requestId"),"Messages must be idempotent");
assert.ok(contact.includes("website"),"Anti-spam form field missing");
assert.ok(shop.includes("pc-product-image__placeholder"),"Missing safe SKU illustration");
assert.ok(shop.includes("photoOnly")&&shop.includes("stockOnly"),"Missing marketplace filters");
assert.ok(backend.includes("has_photo:hasStoredPhoto"));
assert.ok(backend.includes("terms.every"));
assert.ok(backend.includes("onlyWithPhoto"));
for(const page of [home,shop,enquiry,help,sector]){
 assert.ok(!page.includes("WhatsApp Boss")&&!page.includes("WhatsApp the Boss"),"Unprofessional WhatsApp label remains");
}
for(const sub of ["homepage","spareparts","excavators","machines","motorcycles","automobiles","gold","transport","hire","help","work"]){
 assert.ok(api.includes('"'+sub+'.chalin03.com"'),"Official API host missing "+sub);
 assert.ok(server.includes('"https://'+sub+'.chalin03.com"'),"Authorized API CORS origin missing "+sub);
}
assert.ok(redirects.includes("/customer-help / 200"));
console.log("CHALIN03 dedicated division routes, messaging, image integrity and subdomain contracts passed.");
