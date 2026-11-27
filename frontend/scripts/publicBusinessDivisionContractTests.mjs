import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=read("src/App.jsx"),sector=read("src/pages/IndependentDivisionWebsite.jsx");
const help=read("src/pages/IndependentHelpCentre.jsx");
const home=read("src/pages/CompanyExperienceV3.jsx");
const shop=read("src/pages/IndependentPartsMarket.jsx");
const enquiry=read("src/pages/IndependentQuotePage.jsx");
const contact=read("src/components/PublicContactPanel.jsx");
const host=read("src/config/officialSites.js");
const middleware=read("functions/_middleware.js");
const backend=read("../backend/routes/publicCommerceRoutes.js");
const admin=read("src/pages/WebsiteCommerceControlPage.jsx");
const redirects=read("public/_redirects");
for(const route of ["/excavators","/heavy-machines","/motorcycles","/automobiles","/gold","/machine-transport","/equipment-hire-services"]){
 assert.ok(app.includes('path="'+route+'"'),"Missing division route "+route);
 assert.ok(redirects.includes(route+" / 200"),"Refresh must retain division route "+route);
}
for(const p of ["IndependentPartsMarket","IndependentDivisionWebsite","IndependentQuotePage","IndependentHelpCentre","CompanyExperienceV3"]){
 assert.ok(app.includes(p),"Actual active website missing "+p);
}
assert.ok(app.includes('path="help"'),"Protected staff help must remain");
assert.ok(app.includes('path="/customer-help"'),"Independent public help route missing");
for(const item of ["Caterpillar","Komatsu","Hitachi","Volvo","SANY","Kobelco","Doosan / Develon","Bulldozers","Wheel loaders","Motor graders"]){
 assert.ok(sector.includes(item),"Reference catalogue missing "+item);
}
assert.ok(sector.includes("not live inventory")||sector.includes("not a guarantee")||sector.includes("not verified stock"),"Stock disclaimer missing");
assert.ok(home.includes('ce-trustline')&&home.includes('siteHref("parts")'),"Separate featured market missing from homepage");
assert.ok(home.includes('ce-division-grid')&&home.includes("RealPhoto"),"Distinct real-photo business divisions missing");
assert.ok(home.includes('const divisions=[\n {id:"parts",site:"parts"'),"Spare Parts Shop must be the first business card on the homepage");
assert.ok(home.includes('photo:PHOTO_LIBRARY.parts,cta:"Browse spare parts"'),"Spare Parts Shop must show its real reference photo and shop link");
assert.ok(shop.includes('pm-departments')&&shop.includes('pm-grid'),"Shop departments/grid missing");
assert.ok(shop.includes('photosrc(product.image_url)')&&backend.includes('row.id+"/photo?v="'),"SKU-specific photos must be linked to product records");
assert.ok(shop.includes('href={askPhoto(p)}')&&shop.includes('Product #"+product.id'),"SKU-specific enquiry missing");
assert.ok(shop.includes("price_asc")&&shop.includes("price_desc")&&shop.includes("onlyStock")&&shop.includes("photoFilter"),"Search and filters missing");
assert.ok(contact.includes('request_type:"message"')&&contact.includes("client_key:requestId"));
assert.ok(enquiry.includes('/public-commerce/requests'));
assert.ok(help.includes("hc-faq")&&help.includes("search"));
assert.ok(admin.includes("existing_image"),"Admin product photography queue missing");
assert.ok(backend.includes('has_photo:photo.status==="verified_exact"')&&backend.includes("terms.every"),"Live marketplace backend filters missing");
for(const source of [home,shop,sector,help,enquiry]){
 assert.ok(!source.includes("WhatsApp Boss")&&!source.includes("WhatsApp the Boss"),"Unprofessional text remains");
}
for(const sub of ["homepage","spareparts","excavators","machines","motorcycles","automobiles","gold","transport","hire","help","work"]){
 assert.ok(host.includes(sub+".chalin03.com"),"Official site missing: "+sub);
 assert.ok(middleware.includes('"'+sub+'.chalin03.com"'),"Canonical origin boundary missing "+sub);
}
assert.ok(middleware.includes('request.method!=="GET"')&&middleware.includes("409"),"Cross-origin POST must not redirect");
assert.ok(redirects.includes("/customer-help / 200"));
console.log("CHALIN03 independent official sites, real photographs and secure market contracts passed.");
