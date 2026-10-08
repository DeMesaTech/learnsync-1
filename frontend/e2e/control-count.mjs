// Control-count audit: how many visible interactive controls a page body offers (read-only; run against development data).
// Counts links, buttons, inputs, selects, textareas and <summary> inside .content, and reports the subject tabs separately.
import {launch,newPage,sessionFor} from './lib.mjs';

const browser=await launch();
const count=page=>page.evaluate(()=>{
  const visible=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!e.closest('[hidden],details:not([open]) > :not(summary)')};
  const root=document.querySelector('.content');if(!root)return null;
  const all=[...root.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary')].filter(visible);
  const tabs=all.filter(e=>e.closest('nav[aria-label="Subject sections"]')).length;
  return {total:all.length,tabs,body:all.length-tabs};
});
const rows=[];
try{
  const F=await sessionFor(browser,'faculty1@example.com');
  const f=await newPage(browser,{state:F,width:1440,height:900});
  await f.goto('/faculty/subjects');await f.waitForLoadState('networkidle');
  const href=await f.locator('a[href*="/faculty/offerings/"]').first().getAttribute('href');
  const base=href.match(/.*?offerings\/[^/]+/)[0];
  const faculty={'faculty dashboard':'/faculty','classwork: lessons':base+'/classwork?type=lesson','classwork: quizzes':base+'/classwork?type=quiz','classwork: activities':base+'/classwork?type=activity','gradebook':base+'/gradebook','stream':base+'/stream','people':base};
  for(const [label,url] of Object.entries(faculty)){await f.goto(url);await f.waitForLoadState('networkidle');await f.waitForTimeout(500);rows.push([label,await count(f)])}
  const S=await sessionFor(browser,'student1@example.com');
  const s=await newPage(browser,{state:S,width:1440,height:900});
  await s.goto('/student/subjects');await s.waitForLoadState('networkidle');
  const sh=await s.locator('a[href*="/student/offerings/"]').first().getAttribute('href');
  const sbase=sh.match(/.*?offerings\/[^/]+/)[0];
  const student={'student dashboard':'/student','classwork: lessons':sbase+'/classwork?type=lesson','classwork: quizzes':sbase+'/classwork?type=quiz','stream':sbase+'/stream','grades':sbase+'/results'};
  for(const [label,url] of Object.entries(student)){await s.goto(url);await s.waitForLoadState('networkidle');await s.waitForTimeout(500);rows.push(['student '+label,await count(s)])}
  for(const [label,c] of rows)console.log(`${label.padEnd(34)} total ${String(c?.total).padStart(3)}  body ${String(c?.body).padStart(3)}  subject tabs ${c?.tabs}`);
}catch(e){console.log('SCRIPT ERROR:',e.message);process.exitCode=1}
await browser.close();
