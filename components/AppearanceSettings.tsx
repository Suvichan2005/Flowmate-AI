import React, { useState } from 'react';
import { applyTheme, canPersistTheme, themeIds, useTheme } from '../services/theme';
const swatches = ['--theme-forest-950','--theme-forest-800','--theme-mint-300'];
export default function AppearanceSettings() {
 const selected = useTheme();
 const [warning,setWarning] = useState('');
 function select(id: typeof selected) { applyTheme(id); setWarning(canPersistTheme() ? '' : 'Browser storage is unavailable. This preview will not survive a restart.'); }
 return <section aria-labelledby="appearance-heading">
 <h2 id="appearance-heading" className="text-lg font-semibold text-slate-200 mb-2">Appearance</h2>
 <p className="text-sm text-slate-300 mb-4">Choose a complete palette. Saved on this device across your accounts. Forest is the default.</p>
 <div role="radiogroup" aria-label="Application palette" className="theme-presets">
 {themeIds.map((id,index) => <button key={id} type="button" role="radio" aria-checked={selected===id} tabIndex={selected===id ? 0 : -1} className="theme-choice" onClick={()=>select(id)} onKeyDown={event=>{
 const delta = event.key==='ArrowRight'||event.key==='ArrowDown' ? 1 : event.key==='ArrowLeft'||event.key==='ArrowUp' ? -1 : 0;
 if (delta || event.key==='Home' || event.key==='End') { event.preventDefault(); const next=event.key==='Home'?0:event.key==='End'?themeIds.length-1:(index+delta+themeIds.length)%themeIds.length; select(themeIds[next]); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus(); }
 }}>
 <span className="theme-swatch" data-theme={id} aria-hidden="true">{swatches.map(token=><span key={token} style={{backgroundColor:`var(${token})`}} />)}</span>
 <span className="font-medium">{id[0].toUpperCase()+id.slice(1)}</span><span className="ml-2 text-sm">{selected===id?'Selected':''}</span>
 </button>)}
 </div><p role="status" className="text-sm text-slate-300 mt-2">{warning || `Current palette: ${selected}.`}</p>
 </section>;
}
