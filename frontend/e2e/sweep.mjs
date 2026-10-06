// Accessibility / theme / mobile sweep: axe-core (WCAG 2 A/AA), whole-page overflow and small targets,
// for each role's main pages, light + dark, 1280px + 375px. Screenshots of light desktop + mobile.
import {writeFileSync} from 'node:fs';
import {launch,newPage,sessionFor,shot,axe,layout} from './lib.mjs';

const OFFERING=process.env.OFFERING??'dbe0fd57-e56c-486d-be77-275dfb54b967';
const roles={
  admin:{email:'admin@example.com',pages:async()=>['/admin','/admin/academics','/admin/subjects','/admin/accounts','/admin/issues','/admin/audit','/account']},
  faculty:{email:'faculty1@example.com',pages:async page=>{
    const o=`/faculty/offerings/${OFFERING}`;
    const ids=await page.evaluate(async o=>{const j=u=>fetch('/api/teach/offerings/'+o+u).then(r=>r.json());
      const items=await j('/items'),as=await j('/assessments');return {lesson:items.find(i=>i.kind==='lesson')?.id,ref:items.find(i=>i.kind==='reference')?.id,quiz:as.find(a=>a.kind==='online_quiz')?.id,act:as.find(a=>a.kind==='activity')?.id}},OFFERING);
    return ['/faculty','/faculty/subjects',o,`${o}/syllabus`,`${o}/content`,`${o}/content/${ids.lesson}/edit`,`${o}/content/${ids.ref}/edit`,`${o}/assessments`,`${o}/assessments/${ids.quiz}/edit`,`${o}/assessments/${ids.quiz}/scores`,`${o}/assessments/${ids.act}/scores`,`${o}/attendance`,`${o}/gradebook`,`${o}/class-standing`,`${o}/progress`,`${o}/announcements`,'/faculty/issues','/account']}},
  student:{email:'student1@example.com',pages:async page=>{
    const o=`/student/offerings/${OFFERING}`;
    const ids=await page.evaluate(async o=>{const items=await fetch('/api/learn/offerings/'+o+'/items').then(r=>r.json());const work=await fetch('/api/learn/offerings/'+o+'/assessments').then(r=>r.json());
      return {lesson:items.find(i=>i.kind==='lesson')?.id,quiz:work.find(w=>w.kind==='online_quiz'&&w.state==='available')?.id??work.find(w=>w.kind==='online_quiz')?.id,act:work.find(w=>w.kind==='activity')?.id}},OFFERING);
    return ['/student','/student/subjects',`${o}/syllabus`,`${o}/lessons`,`${o}/lessons/${ids.lesson}`,`${o}/study`,`${o}/work`,`${o}/work/${ids.quiz}`,`${o}/work/${ids.act}`,`${o}/progress`,`${o}/results`,`${o}/announcements`,'/student/issues','/account']}}
};

const browser=await launch();
const found={};          // "rule|impact" -> {help, pages:Set, example}
const layoutProblems=[];
let checked=0;
for(const [role,cfg] of Object.entries(roles)){
  const state=await sessionFor(browser,cfg.email);
  for(const scheme of ['light','dark']){
    for(const width of [1280,375]){
      const page=await newPage(browser,{width,height:width===375?812:900,scheme,state});
      await page.goto("/");
      const paths=await cfg.pages(page);
      for(const path of paths){
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(250);
        const tag=`${role}${path.replace(OFFERING,'O').replace(/[0-9a-f-]{36}/g,'ID').replace(/\//g,'_')}-${scheme}-${width}`;
        const violations=await axe(page);
        for(const v of violations){const k=`${v.id}|${v.impact}`;(found[k]??={help:v.help,pages:new Set(),example:v.nodes[0]}).pages.add(`${role}${path}`)}
        const lay=await layout(page);
        if(lay.overflow||(width===375&&lay.small.length))layoutProblems.push({page:`${role}${path}`,scheme,width,overflow:lay.overflow,small:lay.small});
        if(scheme==='light'&&process.env.SHOTS_ALL)await shot(page,tag);
        checked++;
      }
      await page.context().close();
    }
  }
}
await browser.close();
const out={checked,violations:Object.entries(found).map(([k,v])=>({rule:k,help:v.help,pages:[...v.pages].length,sample:[...v.pages].slice(0,4),example:v.example})),layoutProblems};
writeFileSync('../var/sweep.json',JSON.stringify(out,null,1));
console.log(JSON.stringify({checked,violationRules:out.violations.map(v=>`${v.rule} x${v.pages}`),layoutProblems:layoutProblems.length},null,1));
