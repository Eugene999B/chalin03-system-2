import "../styles/realPhotos.css";
export default function RealPhoto({photo:image,className="",eager=false}){
 if(!image)return null;
 return <figure className={"real-photo "+className}>
  <img src={image.src} alt={image.alt} loading={eager?"eager":"lazy"} decoding="async" referrerPolicy="no-referrer" width="960" height="640"/>
  <figcaption><a href={image.source} rel="noopener noreferrer" target="_blank">Photo: {image.credit} · {image.license}</a></figcaption>
 </figure>;
}
