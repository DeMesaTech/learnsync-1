// Screenshots of the three dashboards and the subject lists (light + dark, desktop + phone) for visual review.
import {launch,newPage,sessionFor,shot} from './lib.mjs';
const list=[
 ['student1@example.com','student',['/student','/student/subjects']],
 ['faculty1@example.com','faculty',['/faculty','/faculty/subjects']],
 ['admin@example.com','admin',['/admin']],
];
const browser=await launch();
for(const [email,role,paths] of list){
  const state=await sessionFor(browser,email);
  for(const [scheme,width] of [['light',1280],['dark',1280],['light',375]]){
    const page=await newPage(browser,{width,height:width===375?812:900,scheme,state});
    for(const p of paths){await page.goto(p);await page.waitForLoadState('networkidle');await page.waitForTimeout(300);await shot(page,`${role}-${p.split('/').filter(Boolean).pop()}-${scheme}-${width}`,width===375)}
    await page.context().close();
  }
}
await browser.close();
