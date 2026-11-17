"use strict";

const sharp = require("sharp");

function escapeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function label(value, maxLength=38) {
  const str=String(value??"").replace(/[\x00-\x1f\x7f]/g," ").trim();
  return escapeText(str.length>maxLength?str.slice(0,maxLength-1)+"…":str);
}
function nonnegative(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,n):0;}
function money(value){return nonnegative(value).toLocaleString("en-GH",{maximumFractionDigits:0});}
const colors={navy:"#0c2c3b",sea:"#078579",gold:"#c5a05b",paper:"#f7f9f7",muted:"#647c85"};
function barChart(chart) {
  const points=(Array.isArray(chart.points)?chart.points:[]).slice(0,9);
  const max=Math.max(1,...points.map(p=>nonnegative(p.value)));
  const rows=points.map((p,i)=>{
    const y=137+i*30,bar=Math.round(nonnegative(p.value)/max*450);
    return '<text x="36" y="'+(y+12)+'" font-family="Arial" font-size="14" fill="'+colors.navy+'">'+label(p.label,25)+'</text>'+
      '<rect x="309" y="'+y+'" width="450" height="17" rx="5" fill="#e4eceb"/>'+
      '<rect x="309" y="'+y+'" width="'+bar+'" height="17" rx="5" fill="'+(i%2?colors.sea:"#164c5c")+'"/>'+
      '<text x="950" y="'+(y+13)+'" text-anchor="end" font-family="Arial" font-size="15" font-weight="bold" fill="'+colors.navy+'">'+label(money(p.value),20)+'</text>';
  }).join("");
  return rows||'<text x="42" y="180" font-family="Arial" font-size="18" fill="#637781">No matching records for this period</text>';
}
function lineChart(chart) {
  const points=(Array.isArray(chart.points)?chart.points:[]).slice(0,31);
  const max=Math.max(1,...points.map(p=>nonnegative(p.value)));
  const coords=points.map((p,i)=>({
    x:42+(points.length===1?444:i*875/(points.length-1)),
    y:345-nonnegative(p.value)/max*188,
  }));
  const lines=[0,1,2,3,4].map(i=>
    '<line x1="42" x2="917" y1="'+(157+i*47)+'" y2="'+(157+i*47)+'" stroke="#dce8e6" stroke-dasharray="5 6"/>'
  ).join("");
  const polyline=coords.map(p=>p.x+","+p.y).join(" ");
  const text=points.length?
    '<polyline fill="none" stroke="'+colors.sea+'" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round" points="'+polyline+'"/>'+
    coords.filter((_,i)=>i===0||i===coords.length-1||i%Math.max(1,Math.ceil(coords.length/10))===0)
      .map(p=>'<circle cx="'+p.x+'" cy="'+p.y+'" r="5" fill="white" stroke="'+colors.sea+'" stroke-width="3"/>').join("")+
    '<text x="42" y="388" font-family="Arial" font-size="13" fill="'+colors.muted+'">'+label(points[0].label,20)+'</text>'+
    '<text x="917" y="388" text-anchor="end" font-family="Arial" font-size="13" fill="'+colors.muted+'">'+label(points[points.length-1].label,20)+'</text>':
    '<text x="40" y="210" font-family="Arial" font-size="18" fill="'+colors.muted+'">No matching records</text>';
  return lines+text;
}
function svgMarkup(chart) {
  const kind=chart.kind==="line"?"line":"bar";
  const headline=label(chart.title,65);
  const note=label(chart.note||chart.unit||"Original recorded evidence",120);
  const body=kind==="line"?lineChart(chart):barChart(chart);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="420" viewBox="0 0 1000 420">'+
    '<rect width="1000" height="420" fill="'+colors.paper+'"/>'+
    '<rect x="0" y="0" width="1000" height="8" fill="'+colors.sea+'"/>'+
    '<text x="35" y="45" font-family="Arial" font-size="12" letter-spacing="2" font-weight="bold" fill="'+colors.sea+'">CHALIN03 / VISUAL ANALYSIS</text>'+
    '<text x="35" y="85" font-family="Arial" font-size="26" font-weight="bold" fill="'+colors.navy+'">'+headline+'</text>'+
    '<text x="35" y="111" font-family="Arial" font-size="14" fill="'+colors.muted+'">'+note+'</text>'+
    body+
    '<line x1="36" y1="400" x2="964" y2="400" stroke="#cadbd8"/>'+
    '<text x="36" y="414" font-family="Arial" font-size="10" fill="'+colors.muted+'">SOURCE-SCOPED  •  GHANA CEDIS WHERE APPLICABLE</text>'+
    '</svg>';
}
async function renderBusinessChartPng(chart) {
  if(!chart||typeof chart!=="object")throw new TypeError("Chart evidence required");
  return sharp(Buffer.from(svgMarkup(chart))).png({compressionLevel:8}).toBuffer();
}
module.exports={renderBusinessChartPng,svgMarkup};
