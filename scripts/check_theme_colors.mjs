import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// Explicit exceptions are data/semantic contracts, not a blanket brand-color whitelist.
const exceptions = {
 'components/AttendanceTracker.tsx':'Peer-owned subject colors persisted as user data; fallback/default migration requires peer review',
 'components/CalendarView.tsx':'Peer-owned warning conflict border; user-assigned event colors remain data',
 'components/HabitCard.tsx':'Peer-owned good/bad habit semantic status; pending token migration',
 'components/QuickStreaks.tsx':'User-selectable Google Calendar color identifiers; do not rewrite persisted user data',
 'components/LiveVoiceModal.tsx':'Warning and error canvas states only',
};
const semantic = new Set(['#f59e0b','#ef4444','#fff','#ffffff','#000','#000000']);
const findings=[], classified=[];
function scan(dir) { for(const entry of readdirSync(dir,{withFileTypes:true})) {
 const path=join(dir,entry.name).replaceAll('\\','/'); if(entry.isDirectory())scan(path); else if(/\.(tsx?|css)$/.test(path)) {
 const lines=readFileSync(path,'utf8').split('\n');lines.forEach((line,index)=>{for(const match of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
 const record={path,line:index+1,color:match[0]};
 if(exceptions[path])classified.push({...record,reason:exceptions[path]});else if(!semantic.has(match[0].toLowerCase()))findings.push(record);
 }});
 } } }
scan('components');
for(const file of ['index.css']){readFileSync(file,'utf8').split('\n').forEach((line,index)=>{if(/#[0-9a-fA-F]{3,8}\b/.test(line))findings.push({path:file,line:index+1});});}
console.log(JSON.stringify({passed:!findings.length,findings,classified,limitations:'Source heuristic; no proof of runtime route coverage. Canonical styles/forest.css intentionally excluded.'},null,2));
process.exitCode=findings.length?1:0;
