/** Photographs of real equipment from Wikimedia Commons.
 * Commercial reuse requires each linked photo's attribution/license; see
 * the per-image credit links. They represent model/type references, NOT live
 * CHALIN03 stock, and never replace SKU-specific product photos.
 */
/**
 * Each filename/path has been checked against a real Wikimedia file and its
 * direct 960px thumbnail was loaded in a real production browser, 2026-11-21.
 * Thumb URLs avoid Special:FilePath redirects that had caused broken images.
 *
 * IMPORTANT: Model photographs illustrate genuine equipment types only.
 * They do NOT assert actual CHALIN03 stock or replace POS SKU photographs.
 * Preserve the linked Commons source + copyright/author attribution.
 */
const VERIFIED_COMMONS_PATHS=Object.freeze({
  "Caterpillar 320.jpg":"a/a2",
  "Small fuel filter.jpg":"1/1f",
  "Grease gun and attachment.jpg":"3/3d",
  "Claw hammer.JPG":"4/4f",
  "Shovel.jpg":"f/f4",
  "Excavator bucket.jpg":"a/a7",
  "Spanners.jpg":"1/16",
  "Spanner 2.jpg":"0/0d",
  "Socket wrench and sockets.JPG":"0/00",
  "Cummins Diesel engine piston head 10deg.jpg":"c/c7",
  "Crimped hose ends.JPG":"0/03",
  "Car battery.jpg":"4/4c",
  "Caterpillar 321D LCR on dirt lot in Campbell.jpg":"d/db",
  "Hydraulic hose fittings.JPG":"f/fc",
  "Caterpillar dozer.jpg":"4/4e",
  "Honda CG125.jpg":"4/43",
  "20200517 Toyota Hilux.jpg":"b/b3",
  "Gold bullion bars.jpg":"a/af",
  "Excavator On A Truck Bed.jpg":"a/aa",
  "Komatsu PC200.jpg":"2/2a",
  "Oil filter.JPG":"2/23",
  "Engine oil filter.JPG":"c/cb",
  "John Deere 624G Wheel Loader.jpg":"0/02",
  "Caterpillar 24h.jpg":"4/4d",
  "Road Roller.jpg":"4/46",
  "Hilux.jpg":"0/04",
  "Bajaj Boxer BM 150.jpg":"8/8e",
  "CAT 320.excavator.jpg":"8/8c",
  "Volvo EC210B.JPG":"0/0f",
  "Hitachi ZX 210 LC p1.JPG":"e/e5",
  "Kobelco SK210LC Dynamic Acera.JPG":"4/46",
  "Komatsu PC210LC p1.JPG":"4/46",
  "Kubota U35 and truck, Aulich utca drainage ditch construction, 2019 Isaszeg.jpg":"9/90",
  "KobelcoSK350LC-10-1.jpg":"5/5f"
});
function photo(file,credit,license,alt){
 const directory=VERIFIED_COMMONS_PATHS[file];
 if(!directory)throw new Error("Unverified photo not allowed: "+file);
 const encoded=encodeURIComponent(file.replace(/ /g,"_"));
 const slug=file.replace(/\.[^.]+$/,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")+".jpg";
 return Object.freeze({
  src:"https://upload.wikimedia.org/wikipedia/commons/thumb/"+directory+"/"+encoded+"/960px-"+encoded,
  localSrc:"/images/verified-reference/"+slug,
  original:"https://upload.wikimedia.org/wikipedia/commons/"+directory+"/"+encoded,
  source:"https://commons.wikimedia.org/wiki/File:"+encoded,
  credit,license,alt
 });
}
export const PHOTO_LIBRARY=Object.freeze({
  skuFuelFilter:photo("Small fuel filter.jpg","Cjp24","CC BY-SA 3.0","Real fuel filter reference; verify FF5544 part number before purchase"),
  skuGreaseGun:photo("Grease gun and attachment.jpg","Bryn Pinzgauer","CC BY 2.0","Real grease gun reference; confirm exact stocked model"),
  skuHammer:photo("Claw hammer.JPG","ایران پتک / Iran Potk","CC BY-SA 4.0","Real claw hammer reference; not proof of stocked hammer"),
  skuShovel:photo("Shovel.jpg","Rasbak","CC BY-SA 3.0","Real shovel reference; actual stock design may differ"),
  skuExcavatorBucket:photo("Excavator bucket.jpg","DeWitt Clinton","CC BY 2.0","Real excavator digging bucket reference; confirm Liugong fitment"),
  skuSpannerAssortment:photo("Spanners.jpg","ProjectManhattan","CC BY-SA 3.0","Real workshop spanners; size 13 not verified by photograph"),
  skuSpannerSingle:photo("Spanner 2.jpg","Zephyris","CC BY-SA 3.0","Real spanner; size 11 not verified by photograph"),
  skuSocketSet:photo("Socket wrench and sockets.JPG","Kae","CC BY-SA 3.0","Real socket wrench set reference; actual brand and contents may differ"),
  skuDieselPiston:photo("Cummins Diesel engine piston head 10deg.jpg","S. Diddy","CC BY 2.0","Real diesel engine piston reference; confirm actual piston set"),
  skuCrimpedHose:photo("Crimped hose ends.JPG","Jstapko","CC BY-SA 3.0","Real hydraulic hose reference; confirm actual hose type and dimensions"),
  skuCarBattery:photo("Car battery.jpg","Azorbli","CC BY-SA 4.0","Real automotive battery reference; not an Avatar battery"),
  homepageExcavator:photo("Caterpillar 321D LCR on dirt lot in Campbell.jpg","Grendelkhan","CC BY-SA 4.0","Real Caterpillar 321D LCR excavator on an open construction yard beneath a clear blue sky"),
  excavators:photo("Caterpillar 320.jpg","Bene Riobó","CC BY-SA 4.0","Real Caterpillar 320 excavator at work"),
  parts:photo("Hydraulic hose fittings.JPG","Jstapko / Wikimedia Commons","See source","Real hydraulic hose fittings"),
  machines:photo("Caterpillar dozer.jpg","Srđan Popović","CC BY-SA 4.0","Real Caterpillar bulldozer"),
  motorcycles:photo("Honda CG125.jpg","SEDJRO SETONDJI","CC BY-SA 4.0","Real Honda CG125 commuter motorcycle"),
  automobiles:photo("20200517 Toyota Hilux.jpg","Kahvilokki / Wikimedia Commons","See source","Real Toyota Hilux pickup truck"),
  gold:photo("Gold bullion bars.jpg","Wikimedia Commons","CC0 1.0","Photograph of real gold bullion bars"),
  transport:photo("Excavator On A Truck Bed.jpg","Ingolfson / Wikimedia Commons","See source","Excavator carried on a heavy transport truck"),
  hire:photo("Komatsu PC200.jpg","FBenjr123","CC BY-SA 4.0","Real Komatsu PC200 excavator at a worksite"),
  filters:photo("Oil filter.JPG","PHGCOM / Wikimedia Commons","See source","Photograph of a real oil filter"),
  hoses:photo("Hydraulic hose fittings.JPG","Jstapko / Wikimedia Commons","See source","Photograph of hydraulic hose fittings"),
  oilFilter:photo("Engine oil filter.JPG","Dvortygirl / Wikimedia Commons","See source","Photograph of a real engine oil filter"),
  loader:photo("John Deere 624G Wheel Loader.jpg","Royalbroil / Wikimedia Commons","See source","Real John Deere wheel loader"),
  dozer:photo("Caterpillar dozer.jpg","Srđan Popović","CC BY-SA 4.0","Real Caterpillar bulldozer"),
  grader:photo("Caterpillar 24h.jpg","Wikimedia Commons","CC BY-SA 4.0","Real Caterpillar motor grader"),
  roller:photo("Road Roller.jpg","Rajmishra757","CC BY-SA 4.0","Real construction road roller"),
  lowbed:photo("Excavator On A Truck Bed.jpg","Ingolfson / Wikimedia Commons","See source","Real excavator moved on a truck"),
  hilux:photo("Hilux.jpg","Duke Makangila","CC BY-SA 4.0","Real Toyota Hilux pickup"),
  bajaj:photo("Bajaj Boxer BM 150.jpg","Axxter99 / Wikimedia Commons","See source","Real Bajaj Boxer motorcycle"),
  honda:photo("Honda CG125.jpg","SEDJRO SETONDJI","CC BY-SA 4.0","Real Honda CG125"),
  komatsu:photo("Komatsu PC200.jpg","FBenjr123","CC BY-SA 4.0","Real Komatsu PC200 excavator"),
  cat320:photo("CAT 320.excavator.jpg","Justin Smith","CC BY-SA 3.0","Real Caterpillar 320 excavator"),
  volvo:photo("Volvo EC210B.JPG","Ghostrider / Wikimedia Commons","See source","Real Volvo EC210B excavator"),
  hitachiZX210:photo("Hitachi ZX 210 LC p1.JPG","Alf van Beem / Wikimedia Commons","CC0 1.0","Real Hitachi ZX210 LC excavator"),
  kobelcoSK210:photo("Kobelco SK210LC Dynamic Acera.JPG","AlfvanBeem / Wikimedia Commons","CC0 1.0","Real Kobelco SK210LC Dynamic Acera excavator"),
  komatsuPC210:photo("Komatsu PC210LC p1.JPG","AlfvanBeem / Wikimedia Commons","CC0 1.0","Real Komatsu PC210LC excavator"),
  kubotaU35:photo("Kubota U35 and truck, Aulich utca drainage ditch construction, 2019 Isaszeg.jpg","Globetrotter19 / Wikimedia Commons","CC BY-SA 3.0","Real Kubota U35 mini excavator at a worksite"),
  kobelcoSK350:photo("KobelcoSK350LC-10-1.jpg","Wikimedia Commons / CC0 contributor","CC0 1.0","Real Kobelco SK350LC-10 crawler excavator")
});
export const EXACT_MODEL_PHOTOS=Object.freeze({
  "Caterpillar|CAT 320":PHOTO_LIBRARY.cat320,
  "Komatsu|PC200":PHOTO_LIBRARY.komatsu,
  "Volvo|EC210":PHOTO_LIBRARY.volvo,
  "Hitachi|ZX210":PHOTO_LIBRARY.hitachiZX210,
  "Kobelco|SK210":PHOTO_LIBRARY.kobelcoSK210,
  "Komatsu|PC210":PHOTO_LIBRARY.komatsuPC210,
  "Kubota|U35":PHOTO_LIBRARY.kubotaU35,
  "Kobelco|SK350":PHOTO_LIBRARY.kobelcoSK350
});
export const REAL_TYPE_PHOTOS=Object.freeze({
  "Bulldozers":PHOTO_LIBRARY.dozer,
  "Wheel loaders":PHOTO_LIBRARY.loader,
  "Motor graders":PHOTO_LIBRARY.grader,
  "Compactors & rollers":PHOTO_LIBRARY.roller,
  "Low-bed trailers":PHOTO_LIBRARY.lowbed,
  "Commuter motorcycles":PHOTO_LIBRARY.honda,
  "Delivery motorcycles":PHOTO_LIBRARY.bajaj,
  "Pickups & 4×4s":PHOTO_LIBRARY.hilux
});


// Individually curated, different real photographs ONLY for the specific
// pictured part TYPE. Never claim they show the exact CHALIN03 stock SKU.
// Actual staff-uploaded photographs always take precedence in the shop.
export const SPAREPARTS_SKU_REFERENCE_PHOTOS=Object.freeze({
  20:PHOTO_LIBRARY.filters,             // Oil Filter LF3349 (model unverified)
  35:PHOTO_LIBRARY.oilFilter,           // China Oil Filter (Sany model unverified)
  21:PHOTO_LIBRARY.skuFuelFilter,      // Fuel Filter FF5544 (model unverified)
  115:PHOTO_LIBRARY.skuGreaseGun,      // Hand Grease Gun Long
  200:PHOTO_LIBRARY.skuHammer,         // Hammer
  138:PHOTO_LIBRARY.skuShovel,         // Shovel
  656:PHOTO_LIBRARY.skuExcavatorBucket,// Bucket - Liugong
  192:PHOTO_LIBRARY.skuSpannerAssortment, // Spanner 13
  193:PHOTO_LIBRARY.skuSpannerSingle,    // Spanner 11
  183:PHOTO_LIBRARY.skuSocketSet,      // Box Spanner Tool Set
  201:PHOTO_LIBRARY.skuDieselPiston,   // Piston Set
  97:PHOTO_LIBRARY.skuCrimpedHose,     // Black Hose
  378:PHOTO_LIBRARY.skuCarBattery,     // Battery Big Avatar (brand not verified)
});
