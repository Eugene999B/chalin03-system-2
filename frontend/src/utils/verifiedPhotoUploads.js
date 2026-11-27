/**
 * CHALIN03 verified product photo workflow.
 * Filenames identify a POS product ID; no visual similarity guess is allowed.
 * Product photos require human confirmation before they can be uploaded.
 */
export function safePhotoFilename(product){
  const id=Number(product.id);
  const short=String(product.name||"product").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48);
  return "SKU-"+id+"_"+(short||"product")+".jpg";
}
export function identifyProductPhotoFilename(filename,products){
  const name=String(filename||"");
  const match=name.match(/^(?:CHALIN03[-_])?(?:SKU|PRODUCT|ID)[-_](\d{1,9})(?=[_.-])|^(\d{1,9})__(?=.+\.(?:jpg|jpeg|png|webp)$)/i);
  if(!match)return {error:"Rename this photograph with the SKU number first, e.g. SKU-25_1105-engine.jpg"};
  const id=Number(match[1]||match[2]);
  const product=products.find(item=>Number(item.id)===id);
  if(!product)return {error:"SKU #"+id+" was not found in the current Main Store catalogue."};
  if(!/\.(?:jpe?g|png|webp)$/i.test(name))return {error:"Only genuine JPEG, PNG or WebP photos can be uploaded."};
  if(product.existing_image)return {error:"SKU #"+id+" already has a photo. Replace it individually after checking the existing image."};
  return {id,product};
}
export function photoShotListCsv(products){
  const fields=["Product ID","Name","Size / Machine","Shop category","Selling price (GHS)","Stock","Expected photo filename","Photo status"];
  const rows=products.filter(p=>p.is_visible!==false&&!p.existing_image)
    .slice().sort((a,b)=>String(a.category).localeCompare(String(b.category))||String(a.name).localeCompare(String(b.name)))
    .map(p=>[p.id,p.name,p.size||"",p.category||"",p.selling_price??"",p.quantity??"",safePhotoFilename(p),"TAKE ACTUAL ITEM PHOTO"]);
  const escape=value=>'"'+String(value??"").replaceAll('"','""')+'"';
  return [fields,...rows].map(row=>row.map(escape).join(",")).join("\r\n")+"\r\n";
}
export function downloadPhotoShotList(products){
  const bytes="\ufeff"+photoShotListCsv(products);
  const objectUrl=URL.createObjectURL(new Blob([bytes],{type:"text/csv;charset=utf-8"}));
  try{
    const element=document.createElement("a");
    element.href=objectUrl;element.download="CHALIN03_Main_Store_Verified_Photo_Shot_List.csv";
    document.body.append(element);element.click();element.remove();
  }finally{
    setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
  }
}
const MAX_SOURCE_BYTES=16*1024*1024;
export async function compressProductPhoto(file){
  if(!file||!["image/jpeg","image/png","image/webp"].includes(file.type)){
    throw new Error("Select a real JPEG, PNG or WebP photograph.");
  }
  if(file.size>MAX_SOURCE_BYTES)throw new Error("Photograph too large; select a file under 16 MB.");
  const src=URL.createObjectURL(file);
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{
      img.onload=resolve;img.onerror=()=>reject(new Error("The selected photograph could not be opened."));
      img.src=src;
    });
    if(img.width<200||img.height<200)throw new Error("This photo is too small. Use a clear photo at least 200 pixels wide and tall.");
    const canvas=document.createElement("canvas");
    const ctx=canvas.getContext("2d",{alpha:false});
    if(!ctx)throw new Error("Your browser cannot prepare product photos.");
    for(const side of [1100,900,750,600]){
      const factor=Math.min(1,side/Math.max(img.width,img.height));
      canvas.width=Math.max(1,Math.round(img.width*factor));
      canvas.height=Math.max(1,Math.round(img.height*factor));
      ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      for(const quality of [.83,.75,.66,.56,.46]){
        const data=canvas.toDataURL("image/jpeg",quality);
        // Base64 data body < 1.3 million bytes and decoded file < 900 KB.
        if(data.length<1160000)return data;
      }
    }
    throw new Error("This photograph could not be reduced to the safe upload size.");
  }finally{URL.revokeObjectURL(src);}
}
