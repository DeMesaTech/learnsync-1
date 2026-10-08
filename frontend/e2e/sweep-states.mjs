// Accessibility of states the main sweep does not reach: public (signed-out) screens, every dialog that a
// "New / Invite / Add / Draft / Create" button opens, and an in-progress quiz attempt.
// Same checks as sweep.mjs: axe-core WCAG 2 A/AA, whole-page overflow, 44px targets; light + dark, 1280 + 375.
import {writeFileSync} from 'node:fs';
import {launch,newPage,sessionFor,axe,layout,createQuiz,archiveTestContent} from './lib.mjs';

const O=process.env.OFFERING??'dbe0fd57-e56c-486d-be77-275dfb54b967';
const problems=[];let checked=0;const covered=[];
async function audit(page,label,scheme,width){
  const violations=await axe(page);const lay=await layout(page);checked++;
  if(violations.length||lay.overflow||(width===375&&lay.small.length))problems.push({label,scheme,width,violations:violations.map(v=>`${v.id}: ${v.nodes[0]}`),overflow:lay.overflow,small:width===375?lay.small:[]});
}
const browser=await launch();
const sessions={admin:await sessionFor(browser,'admin@example.com'),faculty:await sessionFor(browser,'faculty1@example.com'),student:await sessionFor(browser,'student1@example.com')};

// an in-progress attempt for the student: publish a throwaway quiz as faculty, start it as the student, archive it at the end
const fp=await newPage(browser,{state:sessions.faculty});await fp.goto('/');
const quizId=await createQuiz(fp,O,'Throwaway quiz for the state sweep');
const sp=await newPage(browser,{state:sessions.student});await sp.goto('/');
const attemptPath=await sp.evaluate(async([o,quizId])=>{
  const csrf=(await (await fetch('/api/auth/session')).json()).csrf;
  const work=await (await fetch(`/api/learn/offerings/${o}/assessments`)).json();
  let quiz=work.find(w=>w.id===quizId&&w.in_progress_attempt_id);
  if(!quiz){const open=work.find(w=>w.id===quizId&&w.state==='available');if(!open)return null;
    const r=await (await fetch(`/api/learn/offerings/${o}/assessments/${open.id}/attempts`,{method:'POST',headers:{'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:'{}'})).json();
    return `/student/offerings/${o}/work/${open.id}/attempts/${r.id}`}
  return `/student/offerings/${o}/work/${quiz.id}/attempts/${quiz.in_progress_attempt_id}`;
},[O,quizId]);
await sp.context().close();

for(const scheme of ['light','dark'])for(const width of [1280,375]){
  const opts={width,height:width===375?812:900,scheme};
  // 1. signed-out screens
  const anon=await newPage(browser,opts);
  for(const path of ['/login','/forgot-password','/reset-password','/accept-invitation','/does-not-exist']){
    await anon.goto(path);await anon.waitForLoadState('networkidle');await audit(anon,`public ${path}`,scheme,width);if(scheme==='light'&&width===1280)covered.push(`public ${path}`);
  }
  await anon.context().close();
  // 2. dialogs, found by clicking the buttons that open them
  const targets={admin:['/admin/accounts','/admin/academics','/admin/subjects'],faculty:[`/faculty/offerings/${O}/content`,`/faculty/offerings/${O}/assessments`,`/faculty/offerings/${O}/announcements`,`/faculty/offerings/${O}/attendance`,`/faculty/offerings/${O}/gradebook`,`/faculty/offerings/${O}/syllabus`,`/faculty/offerings/${O}`]};
  for(const [role,paths] of Object.entries(targets)){
    const page=await newPage(browser,{...opts,state:sessions[role]});
    for(const path of paths){
      await page.goto(path);await page.waitForLoadState('networkidle');await page.waitForTimeout(300);
      const names=await page.locator('main button').evaluateAll(bs=>bs.map(b=>b.textContent.trim()).filter(t=>/^(New|Invite|Add|Draft|Create|Import|Grant|Record|Allow)/.test(t)));
      for(const name of [...new Set(names)]){
        const button=page.locator('main button',{hasText:name}).first();
        if(!await button.isVisible()||!await button.isEnabled())continue;   // a button inside a collapsed section cannot open a dialog
        await button.click();
        const opened=await page.locator('dialog[open]').waitFor({timeout:1500}).then(()=>true).catch(()=>false);
        if(opened){await page.waitForTimeout(200);await audit(page,`${role} dialog "${name}" on ${path.replace(O,'O')}`,scheme,width);if(scheme==='light'&&width===1280)covered.push(`${role} dialog "${name}"`);await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'detached'}).catch(()=>{})}
      }
    }
    await page.context().close();
  }
  // 3. the quiz attempt in progress
  if(attemptPath){const page=await newPage(browser,{...opts,state:sessions.student});await page.goto(attemptPath);await page.waitForLoadState('networkidle');await page.waitForTimeout(300);
    await audit(page,'student quiz attempt in progress',scheme,width);if(scheme==='light'&&width===1280)covered.push('student quiz attempt in progress');await page.context().close()}
}
await archiveTestContent(fp,O,{quiz:quizId});
await browser.close();
writeFileSync('../var/sweep-states.json',JSON.stringify({checked,covered,problems},null,1));
console.log(JSON.stringify({checked,covered:covered.length,problems:problems.length},null,1));
for(const p of problems.slice(0,12))console.log(JSON.stringify(p));
process.exitCode=problems.length?1:0;
