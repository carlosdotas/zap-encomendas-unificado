'use strict';
// Test-only copies of the actual web frontend. Never packaged into the public APK.
const fs=require('node:fs'),path=require('node:path');const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'android/app/src/androidTest/assets/ime-web');fs.mkdirSync(out,{recursive:true});
for(const name of ['index.html','navigation.js','location-input.js','shared-location.js'])fs.copyFileSync(path.join(root,name),path.join(out,name));
for(const [name,url]of Object.entries({
 'react.js':'https://unpkg.com/react@18/umd/react.production.min.js',
 'react-dom.js':'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
 'babel.js':'https://unpkg.com/@babel/standalone/babel.min.js',
 'leaflet.js':'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
 'leaflet.css':'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
}))execFileSync('curl',['-fsSL','--max-time','120',url,'-o',path.join(out,name)],{stdio:'inherit'});
console.log('Fixtures IME prontas: frontend real com APIs simuladas, sem contas de produção.');
