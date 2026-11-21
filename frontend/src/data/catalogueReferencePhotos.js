import photos from "./catalogueReferencePhotos.json" with {type:"json"};

const pendingReview={
 20:["Oil Filter (LF3349)","All"],
 21:["Fuel Filter (FF5544)","All"],
 192:["Spanner 13","All"],
 193:["Spanner 11","All"],
 378:["BATTERY-BIG AVATAR","All"],
 572:["Box Spanner 29","None"],
 573:["Box Spanner 29","None"],
 644:["Track Adjustment Seal","All"],
 679:["Track Adjustment Seal","All"]
};
function matchesProduct(product,name,size){
 return name===product.name?.trim()&&size===(product.size||"").trim();
}
export function referenceSkuPhoto(product){
 const photo=photos[product.id];
 return photo&&matchesProduct(product,photo.name,photo.size)?photo:null;
}
export function photoNeedsReview(product){
 const entry=pendingReview[product.id];
 return product.photo_status==="needs_review"||Boolean(entry&&matchesProduct(product,...entry));
}
