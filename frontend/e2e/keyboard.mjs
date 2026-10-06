// Keyboard and theme behaviour: skip link, dialog focus restoration, visible focus, live theme switching.
import {launch,newPage,sessionFor} from './lib.mjs';
const results=[];
const check=(label,ok,detail='')=>{results.push(ok);console.log(`${ok?'PASS':'FAIL'} ${label}${detail?' - '+detail:''}`)};
const browser=await launch();
const state=await sessionFor(browser,'admin@example.com');
const page=await newPage(browser,{state});

await page.goto('/admin/accounts');
await page.getByRole('heading',{name:'User accounts'}).waitFor();
await page.keyboard.press('Tab');
check('the first Tab stop is the skip link',await page.evaluate(()=>document.activeElement?.textContent==='Skip to content'));
await page.keyboard.press('Enter');
check('the skip link moves to the main content',await page.evaluate(()=>location.hash==='#main'));

const outline=async()=>page.evaluate(()=>{const s=getComputedStyle(document.activeElement);return {style:s.outlineStyle,width:parseFloat(s.outlineWidth)}});
await page.keyboard.press('Tab');
const o=await outline();
check('a focused control has a visible outline',o.style!=='none'&&o.width>=2,JSON.stringify(o));

const opener=page.getByRole('button',{name:'Invite user'});
await opener.focus();await page.keyboard.press('Enter');
await page.locator('dialog[open]').waitFor();
check('opening a dialog moves focus into it',await page.evaluate(()=>!!document.activeElement?.closest('dialog')));
for(let i=0;i<12;i++)await page.keyboard.press('Tab');
check('Tab stays inside the open dialog',await page.evaluate(()=>!!document.activeElement?.closest('dialog')));
await page.keyboard.press('Escape');
await page.locator('dialog[open]').waitFor({state:'detached'});
check('Escape closes it and returns focus to the button that opened it',await page.evaluate(()=>document.activeElement?.textContent==='Invite user'));

// theme: explicit choice wins; "System" follows the operating system, live
const bg=()=>page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
await page.emulateMedia({colorScheme:'light'});
await page.getByLabel('Theme').selectOption('system');await page.waitForTimeout(200);
const light=await bg();
await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(300);
const dark=await bg();
check('"System" follows the operating system theme while the page is open',light!==dark,`${light} -> ${dark}`);
await page.getByLabel('Theme').selectOption('light');await page.waitForTimeout(200);
check('choosing Light overrides a dark operating system',await bg()===light);
// the choice is saved to the account: it survives a reload even though a saved preference exists
await page.emulateMedia({colorScheme:'light'});
await page.getByLabel('Theme').selectOption('dark');await page.waitForTimeout(600);
await page.reload();await page.getByLabel('Theme').waitFor();await page.waitForTimeout(400);
check('a theme chosen in the header is still applied after a reload',await page.evaluate(()=>document.documentElement.dataset.theme==='dark'));
await page.getByLabel('Theme').selectOption('system');await page.waitForTimeout(600);   // leave the shared admin preference as found

// signing out ends the session and leaves nothing behind for the Back button
const out=await newPage(browser,{state:await sessionFor(browser,'student1@example.com')});
await out.goto('/student');await out.getByRole('heading',{name:/keep learning/}).waitFor();
out.on('dialog',d=>d.accept());
await out.getByRole('button',{name:'Sign out'}).click();await out.waitForURL(/\/login/);
await out.goBack();await out.waitForLoadState('networkidle');
check('after sign-out the Back button does not show the dashboard',await out.getByRole('heading',{name:/keep learning/}).count()===0&&/\/login/.test(out.url()));
check('and the account data is no longer reachable',(await out.evaluate(async()=>(await fetch('/api/dashboard/student')).status))===401);
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exitCode=results.every(Boolean)?0:1;
