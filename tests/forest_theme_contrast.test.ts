import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const css=readFileSync('styles/forest.css','utf8');
const forestCss=css.replace(/\[data-theme="(?:ocean|plum|slate)"\]\s*\{[^}]+\}/g,'');
const vars=Object.fromEntries([...forestCss.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(match=>[match[1],match[2].trim()]));
function resolve(name:string):string { const value=vars[name]; if (!value) throw new Error('Missing theme token '+name); return value.startsWith('var(')?resolve(value.slice(4,-1)):value; }
function luminance(hex:string):number { const channels=hex.slice(1).match(/../g)!.map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4); return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722; }
function contrast(a:string,b:string):number { const x=luminance(a),y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
describe('Forest theme readability',()=>{
  for(const surface of ['base','surface','elevated']) {
    for(const foreground of ['text','muted','mint']) {
      it(foreground+' is readable on '+surface,()=>expect(contrast(resolve('--color-ideapad-'+foreground),resolve('--color-ideapad-'+surface))).toBeGreaterThanOrEqual(4.5));
    }
  }
  it('primary control text is readable',()=>expect(contrast('#ffffff',resolve('--color-mint-600'))).toBeGreaterThanOrEqual(4.5));
});
