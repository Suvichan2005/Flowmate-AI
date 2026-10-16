import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
it('offline navigation awaits missing root before falling back to cached index',async()=>{
 const handlers:Record<string,Function>={};const response={status:200,synthetic:'cached-index'};
 runInNewContext(readFileSync('public/sw.js','utf8'),{self:{addEventListener:(name:string,fn:Function)=>handlers[name]=fn},location:{origin:'http://localhost'},console,URL,Response,fetch:()=>Promise.reject(Error('offline')),caches:{match:async(path:string)=>path==='/index.html'?response:undefined}});
 let promise:Promise<unknown>|undefined;
 handlers.fetch({request:{url:'http://localhost/settings',mode:'navigate',headers:{get:()=>null}},respondWith:(value:Promise<unknown>)=>promise=value});
 expect(await promise).toBe(response);
});
it('precache contains theme bootstrap without the unavailable production index.css path',()=>{
 const worker=readFileSync('public/sw.js','utf8');expect(worker).toContain("'/theme-init.js'");expect(worker).not.toContain("'/index.css'");
});
