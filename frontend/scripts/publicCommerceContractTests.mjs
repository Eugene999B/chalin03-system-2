import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const app=read("src/App.jsx");
const shop=read("src/pages/IndependentPartsMarket.jsx");
const enquiry=read("src/pages/IndependentQuotePage.jsx");
const admin=read("src/pages/WebsiteCommerceControlPage.jsx");
const homepage=read("src/pages/CompanyExperienceV3.jsx");
const layout=read("src/components/Layout.jsx");
const pos=read("src/pages/NewSalePage.jsx");
const frontCatalog=read("src/security/sparePartsPageAccess.js");
const backendCatalog=read("../backend/security/sparePartsPageCatalog.js");
assert.ok(app.includes('path="/shop" element={<IndependentPartsMarket />} />'));
assert.ok(app.includes('path="/enquire" element={<IndependentQuotePage />} />'));
assert.ok(app.includes('path="online-orders"'));
assert.ok(app.includes('path="online-catalogue"'));
for(const term of ["/public-commerce/products","/public-commerce/requests","price_asc","price_desc","onlyPhotos","onlyStock","customer_email","customer_location","client_key:requestKey","No online payment"]){
 assert.ok(shop.includes(term),"Missing market feature: "+term);
}
for(const term of ["Gold buying & refining","Automobiles","Motorcycles","machine-transport","054 071 3654"]){
 assert.ok(enquiry.includes(term),"Missing quote option: "+term);
}
assert.match(enquiry,/licensing|regulatory|verification/i);
assert.match(admin,/\/staff\/requests/);
assert.match(admin,/\/staff\/products/);
assert.match(admin,/\/fulfill/);
assert.match(admin,/Record paid sale in POS/);
assert.match(admin,/uploadPhoto/);
assert.match(admin,/image_data_url/);
assert.match(pos,/chalin03_web_order_prefill/);
assert.match(pos,/chalin03_web_order_checkout/);
assert.match(pos,/websiteOrderLinked/);
assert.match(pos,/savedReceipt\.sale_id/);
assert.match(pos,/Do not record payment again/);
assert.match(layout,/path: "\/online-orders"/);
assert.match(layout,/path: "\/online-catalogue"/);
assert.match(layout,/if \(cleared\) navigate\("\/"/);
for(const code of ["page.spare_parts.online_orders.view","page.spare_parts.online_catalogue.view"]){
 assert.ok(frontCatalog.includes(code));
 assert.ok(backendCatalog.includes(code));
}
for(const term of ['ce-market','ce-division','siteHref("parts")','siteHref("excavators")','siteHref("work")','PublicContactPanel']){
 assert.ok(homepage.includes(term),"Missing redesigned company feature "+term);
}
const seo=read("public/sitemap.xml");
const publishedHosts=new Set([...seo.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g)]
 .map(match=>new URL(match[1]).hostname));
assert.ok(publishedHosts.has("spareparts.chalin03.com"));
assert.ok(publishedHosts.has("help.chalin03.com"));
for(const file of ["src/styles/independentPartsMarket.css","src/styles/websiteCommerceStaff.css"]){
 const css=read(file);assert.ok(css.includes("@media(max-width:"));assert.ok(css.includes("min-width:0"));
}
console.log("CHALIN03 public shop, enquiry, staff controls, stock safety and homepage contracts passed.");
