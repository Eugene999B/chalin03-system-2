import assert from "node:assert/strict";
import {PHOTO_LIBRARY,EXACT_MODEL_PHOTOS,REAL_TYPE_PHOTOS} from "../src/data/verifiedPublicPhotos.js";
const photoKeys=Object.keys(PHOTO_LIBRARY);
assert.ok(photoKeys.length>=25,"Expected real category and exact model photo library");
const urls=new Set();
for(const [key,photo] of Object.entries(PHOTO_LIBRARY)){
 const image=new URL(photo.src),original=new URL(photo.original),source=new URL(photo.source);
 assert.equal(image.hostname,"upload.wikimedia.org","Broken direct photo CDN for "+key);
 assert.equal(original.hostname,"upload.wikimedia.org","Missing direct original fallback for "+key);
 assert.equal(source.hostname,"commons.wikimedia.org","Photographer credit must have a source for "+key);
 assert.match(image.pathname,/^\/wikipedia\/commons\/thumb\/[a-f0-9]\/([a-f0-9]{2})\/.+\/960px-.+\.(?:jpg|JPG)$/i);
 assert.ok(!image.pathname.includes("Special:FilePath"),"Slow redirects must not be used");
 assert.ok(photo.alt&&photo.credit&&photo.license,"Real photo requires alt, photographer and license");
 assert.ok(photo.source.endsWith(image.pathname.split("/").at(-2)));
 urls.add(photo.src);
}
assert.ok(urls.size>=19,"Separate machine models and business sectors should have independent real photos");
for(const [model,p] of Object.entries(EXACT_MODEL_PHOTOS)){
 assert.ok(Object.values(PHOTO_LIBRARY).includes(p),"Unrecognized exact-model photo: "+model);
}
for(const [kind,p] of Object.entries(REAL_TYPE_PHOTOS)){
 assert.ok(Object.values(PHOTO_LIBRARY).includes(p),"Unrecognized type photograph: "+kind);
}
for(const key of ["excavators","parts","filters","hoses","machines","motorcycles","automobiles","gold","transport","hire"]){
 assert.ok(PHOTO_LIBRARY[key],"Homepage missing real equipment photograph "+key);
}
console.log("All "+urls.size+" unique real equipment photo CDNs have direct 960px routes and source attribution.");
