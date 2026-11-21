import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SPAREPARTS_SKU_REFERENCE_PHOTOS,PHOTO_LIBRARY} from "../src/data/verifiedPublicPhotos.js";

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const site=fs.readFileSync(path.join(root,"src/pages/IndependentPartsMarket.jsx"),"utf8");
const style=fs.readFileSync(path.join(root,"src/styles/independentPartsMarket.css"),"utf8");
const refs=Object.entries(SPAREPARTS_SKU_REFERENCE_PHOTOS);
assert.equal(refs.length,13,"Only the manually reviewed real reference-photo matches may be prepublished");
assert.equal(new Set(refs.map(([id])=>id)).size,refs.length);
assert.equal(new Set(refs.map(([,p])=>p.src)).size,refs.length,"Do not repeat a photo across different Main Store SKUs");
for(const [id,photo] of refs){
 assert.ok(/^[1-9]\d{0,9}$/.test(id));
 assert.equal(new URL(photo.src).hostname,"upload.wikimedia.org");
 assert.equal(new URL(photo.source).hostname,"commons.wikimedia.org");
 assert.ok(photo.license&&photo.credit&&photo.alt&&photo.localSrc,"Each real photo needs source, license, author and caption");
 assert.ok(Object.values(PHOTO_LIBRARY).includes(photo),"Only accepted licensed photographs from source library may appear");
}
assert.ok(site.indexOf("p.image_url?<img")<site.indexOf("!p.image_url&&SPAREPARTS_SKU_REFERENCE_PHOTOS[p.id]"),"Actual SKU photo must take precedence over example");
assert.ok(site.includes("REAL PART-TYPE PHOTO · ACTUAL STOCK TO CONFIRM"));
assert.ok(site.includes('!p.image_url?<a href={askPhoto(p)}'));
assert.ok(style.includes(".pm-product__reference-photo"));
assert.ok(style.includes(".pm-product__reference-badge"));
console.log("CHALIN03 13 unique genuine licensed parts reference photos never replace verified Main Store inventory photographs.");
