import {launch,newPage,shot} from './lib.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const browser=await launch();
const url=pathToFileURL(resolve('../docs/reference/dashboard-prototype.html')).href;
const p=await newPage(browser,{width:1280,height:900});
await p.goto(url);await p.waitForTimeout(800);
for(const role of ['Faculty','Admin']){await p.getByRole('button',{name:role,exact:true}).first().click();await p.waitForTimeout(600);await shot(p,'proto-'+role.toLowerCase(),false)}
await p.getByRole('button',{name:'Student',exact:true}).first().click();
const sel=p.locator('select').first();console.log(await sel.locator('option').allTextContents());
await sel.selectOption({label:'My Classes'}).catch(()=>{});await p.waitForTimeout(500);await shot(p,'proto-subjects',false);
const m=await newPage(browser,{width:375,height:812});await m.goto(url);await m.waitForTimeout(800);await shot(m,'proto-mobile',false);
await browser.close();
