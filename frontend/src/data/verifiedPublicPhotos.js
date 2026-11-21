/** Photographs of real equipment from Wikimedia Commons.
 * Commercial reuse requires each linked photo's attribution/license; see
 * the per-image credit links. They represent model/type references, NOT live
 * CHALIN03 stock, and never replace SKU-specific product photos.
 */
function photo(file,credit,license,alt){
 const encoded=encodeURIComponent(file.replace(/ /g,"_"));
 return Object.freeze({
  src:"https://commons.wikimedia.org/wiki/Special:FilePath/"+encoded+"?width=960",
  source:"https://commons.wikimedia.org/wiki/File:"+encoded,
  credit,license,alt
 });
}
export const PHOTO_LIBRARY=Object.freeze({
  excavators:photo("Caterpillar 320.jpg","Bene Riobó","CC BY-SA 4.0","Real Caterpillar 320 excavator at work"),
  parts:photo("Hydraulic hose fittings.JPG","Jstapko / Wikimedia Commons","See source","Real hydraulic hose fittings"),
  machines:photo("Caterpillar dozer.jpg","Srđan Popović","CC BY-SA 4.0","Real Caterpillar bulldozer"),
  motorcycles:photo("Honda CG125.jpg","SEDJRO SETONDJI","CC BY-SA 4.0","Real Honda CG125 commuter motorcycle"),
  automobiles:photo("20200517 Toyota Hilux.jpg","Kahvilokki / Wikimedia Commons","See source","Real Toyota Hilux pickup truck"),
  gold:photo("Gold bullion bars.jpg","Wikimedia Commons","CC0 1.0","Photograph of real gold bullion bars"),
  transport:photo("Excavator On A Truck Bed.jpg","Ingolfson / Wikimedia Commons","See source","Excavator carried on a heavy transport truck"),
  hire:photo("Komatsu PC200 excavator (34970228724).jpg","Bob Adams / Wikimedia Commons","See source","Real Komatsu PC200 excavator at a site"),
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
  komatsu:photo("Komatsu PC200.jpg","Wikimedia Commons","See source","Real Komatsu PC200 excavator"),
  cat320:photo("CAT 320.excavator.jpg","Justin Smith","CC BY-SA 3.0","Real Caterpillar 320 excavator"),
  volvo:photo("Volvo EC210B.JPG","Ghostrider / Wikimedia Commons","See source","Real Volvo EC210B excavator")
});
export const EXACT_MODEL_PHOTOS=Object.freeze({
  "Caterpillar|CAT 320":PHOTO_LIBRARY.cat320,
  "Komatsu|PC200":PHOTO_LIBRARY.komatsu,
  "Volvo|EC210":PHOTO_LIBRARY.volvo
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
