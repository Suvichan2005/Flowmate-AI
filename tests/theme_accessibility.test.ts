import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const css=readFileSync('styles/forest.css','utf8');
function tokens(id:string) {
 const common=css.replace(/(?:\[data-theme="(?:forest|ocean|plum|slate)"\])\s*\{[^}]+\}/g,'');
 const selected=css.match(new RegExp('\\[data-theme="'+id+'"\\]\\s*\\{([^}]+)'))![1];
 const vars=Object.fromEntries([...((common+';'+selected).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g))].map(m=>[m[1],m[2].trim()]));
 function resolve(name:string):string { const value=vars[name];if(!value)throw Error(name);return value.startsWith('var(')?resolve(value.slice(4,-1)):value; }
 return resolve;
}
function lum(hex:string){const c=hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];}
function contrast(a:string,b:string){const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
describe.each(['forest','ocean','plum','slate'])('%s semantic accessibility',id=>{
 const resolve=tokens(id);
 it('resolves every semantic token',()=>{for(const name of ['surface-canvas','surface-sidebar','surface-primary','surface-secondary','surface-raised','surface-selected','text-primary','text-secondary','text-muted','border-subtle','border-strong','accent-primary','accent-hover','accent-muted','accent-contrast','focus-ring','chart-series-1','chart-series-2','chart-series-3','chart-series-4','graph-node-primary','graph-node-secondary','graph-node-muted','graph-edge-primary','graph-edge-muted','status-warning','status-error','status-success'])expect(resolve('--'+name)).toMatch(/^#[0-9a-f]{6}$/);});
 for(const surface of ['surface-canvas','surface-primary','surface-raised','surface-selected'])it('normal text contrast on '+surface,()=>{for(const text of ['text-primary','text-secondary','text-muted','accent-primary'])expect(contrast(resolve('--'+text),resolve('--'+surface))).toBeGreaterThanOrEqual(4.5);});
 it('focus/control boundary contrast',()=>expect(contrast(resolve('--focus-ring'),resolve('--surface-raised'))).toBeGreaterThanOrEqual(3));
});
describe('Pre-paint bootstrap',()=>{
 const script=readFileSync('public/theme-init.js','utf8');
 it.each(['forest','ocean','plum','slate','invalid',null])('restores safely from %s',stored=>{const document={documentElement:{dataset:{} as Record<string,string>}};runInNewContext(script,{document,localStorage:{getItem:()=>stored}});expect(document.documentElement.dataset.theme).toBe(stored&&['forest','ocean','plum','slate'].includes(stored)?stored:'forest');});
 it('survives denied storage',()=>{const document={documentElement:{dataset:{} as Record<string,string>}};runInNewContext(script,{document,localStorage:{getItem:()=>{throw Error('denied')}}});expect(document.documentElement.dataset.theme).toBe('forest');});
});
