'use strict';
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
require('./generate-icons').generateIcons();
execFileSync(process.platform==='win32'?'npx.cmd':'npx',['cap','sync','android'],{stdio:'inherit'});
fs.copyFileSync('mobile/driver-bridge.js','android/app/src/main/assets/driver-bridge.js');
fs.copyFileSync('navigation.js','android/app/src/main/assets/navigation.js');
for(const asset of ['location-input.js','shared-location.js'])fs.copyFileSync(asset,'android/app/src/main/assets/'+asset);
fs.copyFileSync('mobile/viewport.js','android/app/src/main/assets/viewport.js');
