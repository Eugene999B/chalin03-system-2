import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {safePhotoFilename,identifyProductPhotoFilename,photoShotListCsv} from "../src/utils/verifiedPhotoUploads.js";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const products=[
 {id:25,name:"1105 Engine",size:"Small China",category:"Engines & components",selling_price:7000,quantity:177,is_visible:true,existing_image:false},
 {id:66,name:"Air condition Filter",size:"All",category:"Filters & servicing",selling_price:400,quantity:3,is_visible:true,existing_image:false},
 {id:157,name:"Accelerator Motor",size:"Sany",category:"Electrical",selling_price:2000,quantity:7,is_visible:true,existing_image:true},
 {id:250,name:"Not Published",size:"XCMG",category:"Other",selling_price:100,quantity:2,is_visible:false,existing_image:false}
];
assert.equal(safePhotoFilename(products[0]),"SKU-25_1105-engine.jpg");
assert.equal(safePhotoFilename(products[1]),"SKU-66_air-condition-filter.jpg");
const get=(n)=>identifyProductPhotoFilename(n,products);
assert.equal(get("SKU-25_1105-engine.JPG").id,25);
assert.equal(get("CHALIN03_SKU-66_air-condition-filter.webp").id,66);
assert.equal(get("ID-25.jpg").id,25);
assert.equal(get("25__1105_Engine.png").id,25);
assert.ok(get("1105 Engine.jpg").error,"Unlabelled filename must not be blindly attached");
assert.ok(get("70 Pin Long.jpg").error,"Number in product name is not the SKU ID");
assert.ok(get("SKU-999_any.jpg").error,"Non-existent SKU must not upload");
assert.ok(get("SKU-157_accelerator.jpg").error,"Batch must not overwrite existing photos");
assert.ok(get("SKU-25_engine.svg").error,"SVG must not be accepted as photograph");
const csv=photoShotListCsv(products);
assert.ok(csv.includes("SKU-25_1105-engine.jpg"));
assert.ok(csv.includes("SKU-66_air-condition-filter.jpg"));
assert.ok(!csv.includes("SKU-157"),"Existing photos do not need another shoot");
assert.ok(!csv.includes("SKU-250"),"Hidden items should not be in the published photo queue");
assert.ok(csv.includes('"1105 Engine"'));
for(const required of ["compressProductPhoto","photoShotListCsv","identifyProductPhotoFilename","onChanged","confirm("]){
 assert.ok(read("src/components/VerifiedPhotoStudio.jsx").includes(required),"Photo review component missing "+required);
}
const staff=read("src/pages/WebsiteCommerceControlPage.jsx");
assert.ok(staff.includes("VerifiedPhotoStudio"));
assert.ok(staff.includes("photoStudioOpen"));
assert.ok(staff.includes("setPhotoApproved"));
assert.ok(staff.includes("existing_image:true"));
assert.ok(staff.includes("wc-product-thumb"));
assert.ok(!staff.includes("Optional existing approved photo URL"),"Generic URL field must not bypass exact item proof");
assert.ok(read("src/styles/verifiedPhotoStudio.css").includes("photo-studio__preview"));
assert.ok(read("../backend/routes/publicCommerceRoutes.js").includes("WEBSITE_PRODUCT_IMAGE_UPDATED"));
console.log("CHALIN03 SKU-verified photo studio matching, human approval and safe upload contracts passed.");
