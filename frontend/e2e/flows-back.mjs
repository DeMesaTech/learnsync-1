// Back / return-to-origin checks across roles (dev stack): a page opened from the dashboard (or a card, or a term
// workspace) sends the user back THERE; opened directly, it falls back to its parent. Phone and keyboard variants included.
import {launch,newPage,sessionFor} from './lib.mjs';
const O=process.env.OFFERING??'dbe0fd57-e56c-486d-be77-275dfb54b967';
const results=[];
const check=(label,ok,detail='')=>{results.push(ok);console.log(`${ok?'PASS':'FAIL'} ${label}${detail?' - '+detail:''}`)};
const path=page=>new URL(page.url()).pathname;
// the page's own Back link (the subject header has a parent link above it); waits for it to render
const backLink=page=>page.locator('p.back a',{hasText:/Back to/}).last();
const says=async(page,re)=>{try{await page.locator('p.back a',{hasText:re}).first().waitFor({timeout:8000});return true}catch{return false}};

const browser=await launch();
try{
  // ---- student: dashboard -> lesson/work -> Back returns to the dashboard; direct link falls back to the list
  const studentState=await sessionFor(browser,'student1@example.com');   // one sign-in per account: the limiter allows 5 a minute
  const stu=await newPage(browser,{state:studentState});
  await stu.goto('/student');await stu.getByRole('heading',{name:/keep learning/}).waitFor();await stu.waitForLoadState('networkidle');
  const todo=stu.locator('.dash-side .rows a').first();
  if(await todo.count()){
    await todo.click();await stu.waitForURL(/\/work\//);
    check('a to-do opened from the dashboard says it goes back to the Dashboard',await says(stu,/Back to Dashboard/));
    await backLink(stu).click();await stu.waitForURL(u=>new URL(u).pathname==='/student');
    check('and Back returns to the dashboard',path(stu)==='/student');
  }
  await stu.goto('/student');await stu.waitForLoadState('networkidle');
  const next=stu.getByRole('link',{name:/Continue learning|Open work/});
  if(await next.count()){await next.click();await stu.waitForURL(/\/student\/offerings\//);
    check('the next-step button opens its page and Back names the Dashboard',await says(stu,/Back to Dashboard/))}else console.log('SKIP next-step check: this dev student has nothing left to do (covered by the fresh-install flow)');
  const lessonUrl=await stu.evaluate(async o=>{const items=await (await fetch(`/api/learn/offerings/${o}/items`)).json();return `/student/offerings/${o}/lessons/${items.find(i=>i.kind==='lesson').id}`},O);
  await stu.goto(lessonUrl);
  check('the same lesson opened directly falls back to Lessons & materials',await says(stu,/Back to Lessons & materials/));
  await backLink(stu).click();await stu.waitForURL(/\/lessons$/);
  check('and that Back lands on the lesson list',/\/lessons$/.test(path(stu)));
  // subject card -> Progress tab is a tab, but a card's lesson link carries the origin too
  await stu.goto('/student/subjects');await stu.waitForLoadState('networkidle');
  await stu.getByRole('link',{name:/Grades & results/}).click();await stu.waitForURL(/\/results$/);
  await stu.getByRole('heading',{name:'Published grades'}).waitFor();await stu.getByRole('heading',{name:'Released assessment results'}).waitFor();
  check('the subject card links to "Grades & results" and the page uses both headings',true);
  check('the subject tab is called "Grades & results"',await stu.getByRole('navigation',{name:'Subject sections'}).getByRole('link',{name:'Grades & results'}).count()===1);

  // ---- faculty: dashboard task -> scores page -> Back to the dashboard; direct link -> Assessments
  const fac=await newPage(browser,{state:await sessionFor(browser,'faculty1@example.com')});
  await fac.goto('/faculty');await fac.getByRole('heading',{name:/Good (morning|afternoon|evening)/}).waitFor();await fac.waitForLoadState('networkidle');
  const task=fac.getByRole('link',{name:'Review submissions'});
  if(await task.count()){
    await task.click();await fac.waitForURL(/\/scores$/);
    check('grading opened from the faculty dashboard says Back to Dashboard',await says(fac,/Back to Dashboard/));
    await backLink(fac).click();await fac.waitForURL(u=>new URL(u).pathname==='/faculty');
    check('and Back returns to the faculty dashboard',path(fac)==='/faculty');
    await fac.goBack();await fac.waitForURL(/\/scores$/);
    const direct=path(fac);await fac.goto('about:blank');await fac.goto(direct);   // a reload keeps its history state on purpose, so start from a blank page
    check('the scores page opened by URL falls back to Assessments',await says(fac,/Back to Assessments/));
  }

  // ---- admin: term workspace -> roster -> Back to the term workspace; direct roster -> School years
  const adm=await newPage(browser,{state:await sessionFor(browser,'admin@example.com')});
  await adm.goto('/admin');await adm.getByRole('heading',{name:/academic workspace/}).waitFor();await adm.waitForLoadState('networkidle');
  await adm.locator('table a',{hasText:'Open'}).first().click();await adm.waitForURL(/\/admin\/terms\//);
  const term=path(adm);
  await adm.getByRole('link',{name:'Roster'}).first().click();await adm.waitForURL(/\/admin\/offerings\//);
  check('a roster opened from a term workspace says Back to Term workspace',await says(adm,/Back to Term workspace/));
  const roster=path(adm);
  await backLink(adm).click();await adm.waitForURL(u=>new URL(u).pathname===term);
  check('and Back returns to that term workspace, not to School years',path(adm)===term);
  await adm.goto('about:blank');await adm.goto(roster);
  check('the roster opened by URL falls back to School years',await says(adm,/Back to School years/));

  // ---- phone width and keyboard: the same Back link is reachable and works
  const mob=await newPage(browser,{width:375,height:812,state:studentState});
  await mob.goto('/student');await mob.getByRole('heading',{name:/keep learning/}).waitFor();await mob.waitForLoadState('networkidle');
  await mob.locator('a[href*="/work/"]').first().click();await mob.waitForURL(/\/student\/offerings\//);
  const link=backLink(mob);const box=await link.boundingBox();
  check('on a phone the Back link is at least 44px tall',box.height>=44,`${Math.round(box.height)}px`);
  await link.focus();await mob.keyboard.press('Enter');await mob.waitForURL(u=>new URL(u).pathname==='/student');
  check('and Enter on it returns to the dashboard',path(mob)==='/student');
}catch(e){console.log('FAILED:',e.message.split(String.fromCharCode(10))[0].slice(0,200));for(const c of browser.contexts())for(const p of c.pages())console.log('  page at',p.url());results.push(false)}
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exitCode=results.every(Boolean)?0:1;
