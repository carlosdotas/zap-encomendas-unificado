'use strict';
// Reuse the page's original SVG paths. No tracing or approximation is involved.
const fs=require('node:fs');
const path=require('node:path');
const {Resvg}=require('@resvg/resvg-js');
const root=path.resolve(__dirname,'..');
function generateIcons(){
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const match=html.match(/function Logo\(\)\{return \((<svg[\s\S]*?<\/svg>)\);\}/);
 if(!match)throw Error('SVG do componente Logo não encontrado');
 const svg=match[1].replace(/ className="[^"]*"/g,'').replace(/strokeWidth=/g,'stroke-width=').replace(/strokeLinejoin=/g,'stroke-linejoin=').replace(/strokeLinecap=/g,'stroke-linecap=');
 const content=svg.slice(svg.indexOf('>')+1,svg.lastIndexOf('</svg>'));
 const assets=path.join(root,'mobile/assets');fs.mkdirSync(assets,{recursive:true});fs.writeFileSync(path.join(assets,'logo.svg'),svg+'\n');
 const elements=[...content.matchAll(/<(circle|path)\b([^>]*?)\/?\s*>/g)].map(([,tag,raw])=>{
  const attrs=Object.fromEntries([...raw.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  if(tag==='circle'){const x=Number(attrs.cx),y=Number(attrs.cy),r=Number(attrs.r);attrs.d=`M${x-r},${y} A${r},${r} 0,1 0 ${x+r},${y} A${r},${r} 0,1 0 ${x-r},${y} Z`;}
  return attrs;
 });
 if(elements.length!==9)throw Error('Estrutura inesperada do logo; revise a conversão antes de gerar os ícones');
 const escape=s=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
 const vectorPaths=(items,monochrome=false)=>items.map((a,i)=>{
  const fill=monochrome?(i===4||a.fill==='none'?'#00000000':'#FFFFFFFF'):(a.fill==='none'?'#00000000':a.fill||'#000000');
  const fields=[`android:pathData="${escape(a.d)}"`,`android:fillColor="${fill}"`];
  if(a.stroke||(monochrome&&i===4)){
   fields.push(`android:strokeColor="${monochrome?'#FFFFFFFF':a.stroke}"`,`android:strokeWidth="${monochrome&&i===4?'24':a['stroke-width']||'1'}"`);
   if(a['stroke-linejoin'])fields.push(`android:strokeLineJoin="${a['stroke-linejoin']}"`);
  }
  return '        <path '+fields.join(' ')+'/>';
 }).join('\n');
 const res=path.join(root,'android/app/src/main/res');
 const vector=(paths)=>`<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n    <group android:scaleX="0.066" android:scaleY="0.066" android:translateX="21" android:translateY="21">\n${paths}\n    </group>\n</vector>\n`;
 fs.writeFileSync(path.join(res,'drawable/ic_zap_launcher.xml'),vector(vectorPaths(elements)));
 fs.writeFileSync(path.join(res,'drawable/ic_zap_monochrome.xml'),vector(vectorPaths(elements.slice(1),true)));
 // Notification icons must be monochrome; retain arrows and parcel contours.
 fs.writeFileSync(path.join(res,'drawable/ic_zap_notification.xml'),`<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="1000" android:viewportHeight="1000">\n${vectorPaths(elements.slice(1),true)}\n</vector>\n`);
 fs.writeFileSync(path.join(res,'values/ic_launcher_background.xml'),'<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#FAF7F2</color></resources>\n');
 for(const filename of ['ic_launcher.xml','ic_launcher_round.xml'])fs.writeFileSync(path.join(res,'mipmap-anydpi-v26',filename),`<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@drawable/ic_zap_launcher"/>\n    <monochrome android:drawable="@drawable/ic_zap_monochrome"/>\n</adaptive-icon>\n`);
 const imageSvg=(viewBox,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="${viewBox}">${body}</svg>`;
 const foreground=imageSvg('0 0 108 108',`<g transform="translate(21 21) scale(.066)">${content}</g>`);
 const legacy=imageSvg('-70 -70 1140 1140',`<rect x="-70" y="-70" width="1140" height="1140" fill="#faf7f2"/>${content}`);
 const render=(xml,size)=>new Resvg(xml,{fitTo:{mode:'width',value:size}}).render().asPng();
 for(const [density,scale] of Object.entries({mdpi:1,hdpi:1.5,xhdpi:2,xxhdpi:3,xxxhdpi:4})){
  const directory=path.join(res,'mipmap-'+density);
  for(const filename of ['ic_launcher.png','ic_launcher_round.png'])fs.writeFileSync(path.join(directory,filename),render(legacy,48*scale));
  fs.writeFileSync(path.join(directory,'ic_launcher_foreground.png'),render(foreground,108*scale));
 }
 const artifacts=path.join(root,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
 const preview=imageSvg('18 18 72 72',`<defs><clipPath id="mask"><circle cx="54" cy="54" r="36"/></clipPath></defs><g clip-path="url(#mask)"><rect width="108" height="108" fill="#faf7f2"/><g transform="translate(21 21) scale(.066)">${content}</g></g>`);
 fs.writeFileSync(path.join(artifacts,'icone-zap.png'),render(preview,512));
 console.log('Ícones Android gerados a partir do SVG original da página.');
}
if(require.main===module)generateIcons();
module.exports={generateIcons};
