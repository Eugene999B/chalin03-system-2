"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {category,safeImageUrl,safeProduct,samePhone,MAIN_STORE}=require("../routes/publicCommerceRoutes");
const {schema}=require("../scripts/migratePublicCommerceSchema");
const root=path.resolve(__dirname,"..");
function read(file){return fs.readFileSync(path.join(root,file),"utf8");}
test("spreadsheet main store is the only live public price source",()=>{
 assert.equal(MAIN_STORE,1);
 const route=read("routes/publicCommerceRoutes.js");
 assert.match(route,/FROM products p/);
 assert.match(route,/p\.branch_id=\?/);
 assert.match(route,/p\.is_active=1/);
 assert.match(route,/selling_price/);
 assert.match(route,/COALESCE\(c\.is_visible,1\)=1/);
 assert.doesNotMatch(route,/p\.cost_price/);
});
test("real product categories cover different spare-parts classes",()=>{
 assert.equal(category("FUEL FILTER","Filter"),"Filters & servicing");
 assert.equal(category("Excavator Hydraulic Oil","Lubricant & Oil"),"Oils, grease & fluids");
 assert.equal(category("Hammer 4 lb","Spanner"),"Tools & workshop");
 assert.equal(category("Engine piston","Engine"),"Engines & components");
 assert.equal(category("Excavator track shoe","Undercarriage"),"Undercarriage & ground-engaging");
 assert.equal(category("Electric starter","Electrical"),"Electrical & starting");
});
test("public product format hides stock counts, cost and unknown or zero price",()=>{
 const row={id:41,name:"Hammer",category:"Tools",size:"4 lb",selling_price:42.5,quantity:7,branch_id:1,is_featured:1};
 const result=safeProduct(row);
 assert.equal(result.price,42.5);
 assert.equal(result.in_stock,true);
 assert.equal(result.featured,true);
 assert.equal(result.image_is_illustrative,true);
 assert.equal(result.image_url,null);
 assert.equal(result.has_photo,false);
 const photographed=safeProduct({...row,has_inventory_photo:1});
 assert.equal(photographed.image_url,"/api/public-commerce/products/41/photo");
 assert.equal(photographed.has_photo,true);
 assert.equal("quantity" in result,false);
 assert.equal("cost_price" in result,false);
 const zero=safeProduct({...row,selling_price:0});
 assert.equal(zero.price,null);
 assert.equal(zero.in_stock,false);
});
test("untrusted photo URLs are rejected",()=>{
 assert.equal(safeImageUrl("http://example.com/product.jpg"),null);
 assert.equal(safeImageUrl("https://evil.test/pixel"),null);
 assert.equal(safeImageUrl("file:///etc/passwd"),null);
 assert.equal(safeImageUrl("/images/home/v1/parts.webp"),"/images/home/v1/parts.webp");
});
test("customer phone validation matches local Ghana and international forms",()=>{
 assert.equal(samePhone("0249469080","+233 24 946 9080"),true);
 assert.equal(samePhone("0200000000","0240000000"),false);
});
test("new website schema is isolated from core accounting tables",()=>{
 const script=read("scripts/migratePublicCommerceSchema.js");
 assert.match(script,/mysql\.createConnection\(expected\)/);
 assert.doesNotMatch(script,/pool\.getConnection/);
 assert.match(script,/CHALIN03_SIGNED_BACKUP_CONFIRMED/);
 assert.match(script,/MIGRATION_BACKUP_SHA256/);
 const orchestrator=read("scripts/runPublicCommerceProductionPredeploy.js");
 assert.match(orchestrator,/runReadyCashCompanyWideSaleGuardMigration\.js/);
 assert.match(orchestrator,/migratePublicCommerceSchema\.js/);
 assert.match(orchestrator,/spawnSync\(process\.execPath/);
 assert.match(orchestrator,/result\.status!==0/);
 assert.equal(schema.length,3);
 assert.ok(schema.every(statement=>/^CREATE TABLE IF NOT EXISTS website_/i.test(statement)));
 assert.match(schema[1],/UNIQUE KEY uq_web_request_client_key/);
 assert.match(schema[1],/UNIQUE KEY uq_web_request_sale/);
 assert.match(schema[2],/FOREIGN KEY\(request_id\)/);
 const predeploy=JSON.parse(fs.readFileSync(path.resolve(root,"../railway.json"),"utf8")).deploy.preDeployCommand;
 assert.deepEqual(predeploy,["node scripts/runPublicCommerceProductionPredeploy.js"]);
});
test("a website request never decrements store stock or inserts POS sales",()=>{
 const r=read("routes/publicCommerceRoutes.js");
 assert.doesNotMatch(r,/UPDATE products SET quantity/);
 assert.doesNotMatch(r,/INSERT INTO sales/);
 assert.doesNotMatch(r,/INSERT INTO sale_items/);
 assert.match(r,/sale\.payment_type!==declared/);
 assert.match(r,/sale\.is_voided/);
 assert.match(r,/samePhone\(sale\.customer_phone,request\.customer_phone\)/);
 assert.match(r,/expected\.some/);
 assert.match(r,/linked_sale_id IS NULL/);
 assert.match(r,/rateLimit/);
});
test("staff catalogue photo upload is restricted and does not overwrite master images",()=>{
 const r=read("routes/publicCommerceRoutes.js");
 assert.match(r,/products\/:id\/photo",requireAuth,requireAdmin/);
 assert.match(r,/website_catalog_controls\(product_id,branch_id,image_url,updated_by\)/);
 assert.match(r,/normalizeStoredImage\(value\)/);
 assert.match(r,/sharp\(original/);
 assert.doesNotMatch(r,/UPDATE products SET image_url/);
 const server=read("server.js");
 assert.match(server,/app\.use\("\/api\/public-commerce", publicCommerceRoutes\)/);
});

test("website staff request SQL interpolates clauses rather than escaped literals",()=>{
 const route=read("routes/publicCommerceRoutes.js");
 const escaped=String.fromCharCode(92)+"$"+"{";
 assert.equal(route.includes(escaped+"where}"),false);
 assert.equal(route.includes(escaped+'ids.map(()=>"?").join(",")}'),false);
 assert.ok(route.includes('WHERE ${where}'));
 assert.ok(route.includes('IN (${ids.map(()=>"?").join(",")})'));
});

test("marketplace never invents an exact product photo when none is stored",()=>{
 const route=read("routes/publicCommerceRoutes.js");
 assert.match(route,/hasStoredPhoto\\?"\\/api\\/public-commerce\\/products\\/"/);
 assert.match(route,/image_url:hasStoredPhoto/);
 assert.match(route,/terms\\.every/);
 assert.match(route,/onlyWithPhoto/);
 assert.match(route,/onlyInStock/);
});
