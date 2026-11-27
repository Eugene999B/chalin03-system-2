import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import photos from "../src/data/catalogueReferencePhotos.json" with {type:"json"};
import {referenceSkuPhoto} from "../src/data/catalogueReferencePhotos.js";

const backendIdentities=JSON.parse(readFileSync(new URL("../../backend/data/catalogueReferenceIdentities.json",import.meta.url)));
assert.deepEqual(backendIdentities,Object.fromEntries(Object.entries(photos).map(([id,{name,size}])=>[id,{name,size}])));
const hashes=new Set();
for(const [id,photo] of Object.entries(photos)){
 assert.equal(referenceSkuPhoto({id,name:photo.name,size:photo.size}),photo);
 assert.equal(referenceSkuPhoto({id,name:photo.name,size:"a different fitment"}),null);
 assert.equal(referenceSkuPhoto({id,name:"a different product",size:photo.size}),null);
 assert.equal(new URL(photo.source).hostname,"commons.wikimedia.org");
 assert.equal(new URL(photo.licenseUrl).hostname,"creativecommons.org");
 assert.ok(photo.credit&&photo.license&&photo.alt&&photo.evidence&&photo.changes);
 assert.match(photo.localSrc,new RegExp("^/images/catalogue/"+id+"-960[.]webp$"));
 const bytes=readFileSync(new URL("../public"+photo.localSrc,import.meta.url));
 assert.equal(bytes.toString("ascii",8,12),"WEBP");
 const hash=createHash("sha256").update(bytes).digest("hex");
 assert.ok(!hashes.has(hash),"Do not repeat a photo across Main Store SKUs");
 hashes.add(hash);
}
for(const id of [20,21,192,193,378]){
 assert.equal(photos[id],undefined,"The mismatched reference must remain unpublished");
}
const site=readFileSync(new URL("../src/pages/IndependentPartsMarket.jsx",import.meta.url),"utf8");
assert.ok(site.includes("REAL REFERENCE PHOTO — EXACT STOCK ITEM TO CONFIRM"));
assert.ok(site.includes('product.photo_status==="honest_reference"'));
console.log("SKU references passed identity, rights, asset format and duplicate checks.");
