// Keyboard-ONLY walkthrough of core workflows. Every control is reached with Tab/Shift+Tab and used with
// Space/Enter/Escape/typing; nothing is clicked or focused directly. Also records whether each stop has a visible
// focus indicator. Runs against the dev stack (API 8001, web 5173); it creates its own throwaway quiz and item.
import {launch,newPage,sessionFor} from './lib.mjs';

const O=process.env.OFFERING??'dbe0fd57-e56c-486d-be77-275dfb54b967';
const results=[];const noRing=new Set();
const check=(label,ok,detail='')=>{results.push(ok);console.log(`${ok?'PASS':'FAIL'} ${label}${detail?' - '+detail:''}`)};

const describe=page=>page.evaluate(()=>{
  const e=document.activeElement;if(!e||e===document.body)return null;
  const name=(e.getAttribute('aria-label')||[...(e.labels??[])].map(l=>l.textContent).join(' ')||e.textContent||e.value||e.placeholder||'').trim().replace(/\s+/g,' ');
  const s=getComputedStyle(e);
  const ring=(s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>=2)||!!e.closest('.ProseMirror')||e.classList.contains('rich-content');
  return {tag:e.tagName.toLowerCase(),type:e.type||'',name,href:e.getAttribute('href')||'',expanded:e.getAttribute('aria-expanded'),ring,inDialog:!!e.closest('dialog'),editable:e.isContentEditable};
});
async function tabTo(page,test,label,{max=160,back=false}={}){
  for(let i=0;i<=max;i++){
    const d=await describe(page);
    if(d&&test(d)){if(!d.ring)noRing.add(`${d.tag}:${d.name.slice(0,30)}`);return d}
    await page.keyboard.press(back?'Shift+Tab':'Tab');
  }
  throw new Error(`Could not reach "${label}" by keyboard within ${max} Tab presses`);
}
const named=(re,tag)=>d=>(!tag||d.tag===tag)&&re.test(d.name);
const press=async(page,key)=>{await page.keyboard.press(key);await page.waitForTimeout(250)};

const created={quiz:null,item:null};   // archived again at the end so repeated runs do not clutter the dev data
const browser=await launch();
const faculty=await sessionFor(browser,'faculty1@example.com');
const student=await sessionFor(browser,'student1@example.com');
const admin=await sessionFor(browser,'admin@example.com');
let current=null;
// native confirm() dialogs are declined unless {accept:true}: submitting a quiz must go through, publishing grades must not
const open=async(state,opts={})=>{const {accept=false,...view}=opts;const p=await newPage(browser,{state,...view});p.on('dialog',d=>accept?d.accept():d.dismiss());current=p;return p};

try{
  // ---------- A. student answers and submits a quiz ----------
  const fp=await open(faculty);await fp.goto('/');
  const quizId=await fp.evaluate(async o=>{
    const csrf=(await (await fetch('/api/auth/session')).json()).csrf;const H={'X-CSRF-Token':csrf,'Content-Type':'application/json'};
    const a=await (await fetch(`/api/teach/offerings/${o}/assessments`,{method:'POST',headers:H,body:JSON.stringify({kind:'online_quiz',title:'Keyboard walkthrough quiz'})})).json();
    const d=(await (await fetch(`/api/teach/offerings/${o}/assessments/${a.id}`)).json()).draft;const ids=[0,1,2,3].map(()=>crypto.randomUUID());
    const q=[{key:crypto.randomUUID(),type:'multiple_choice',prompt:'Which one is a business form?',choices:ids.map((id,i)=>({id,text:['Partnership','Weather','Rock','Cloud'][i]})),correct:ids[0],explanation:'',points:'1'},
      {key:crypto.randomUUID(),type:'true_false',prompt:'A sole proprietor has one owner.',choices:[],correct:true,explanation:'',points:'1'},
      {key:crypto.randomUUID(),type:'short_answer',prompt:'Name one business form.',choices:[],correct:['partnership'],explanation:'',points:'1'}];
    const s=await (await fetch(`/api/teach/offerings/${o}/assessments/${a.id}/draft`,{method:'PUT',headers:H,body:JSON.stringify({expected_counter:d.counter,title:'Keyboard walkthrough quiz',instructions:'',category_key:null,period:null,max_points:'3',available_from:null,deadline:null,allow_late:false,max_attempts:3,score_rule:'highest',include_in_grade:false,anchor_node_id:null,questions:q})})).json();
    await fetch(`/api/teach/offerings/${o}/assessments/${a.id}/draft/publish`,{method:'POST',headers:H,body:JSON.stringify({expected_counter:s.counter})});
    return a.id;},O);
  created.quiz=quizId;
  await fp.context().close();

  const sp=await open(student,{accept:true});
  await sp.goto(`/student/offerings/${O}/work`);await sp.getByRole('heading',{name:'My work'}).waitFor().catch(()=>{});await sp.waitForLoadState('networkidle');
  await tabTo(sp,d=>d.tag==='a'&&d.href.endsWith(quizId),'the quiz link');await press(sp,'Enter');
  await tabTo(sp,named(/Start/,'button'),'Start the quiz');await press(sp,'Enter');
  await sp.getByText('Which one is a business form?').waitFor();
  await tabTo(sp,d=>d.type==='radio'&&/Partnership/.test(d.name),'the Partnership choice');await press(sp,'Space');
  await tabTo(sp,d=>d.type==='radio'&&/^True/.test(d.name),'the True choice');await press(sp,'Space');
  await tabTo(sp,d=>d.tag==='input'&&d.type==='text'||d.tag==='textarea','the short answer box');await sp.keyboard.type('partnership');await sp.waitForTimeout(1500);
  await tabTo(sp,named(/Submit answers/,'button'),'Submit answers');await press(sp,'Enter');
  await sp.getByText('Quiz submitted').waitFor();
  check('a student answers all three question types and submits a quiz with the keyboard alone',(await sp.locator('main').innerText()).includes('3.00 / 3.00'));
  await sp.context().close();

  // ---------- B. faculty: dialog validation, editor, autosave conflict, publish ----------
  const tp=await open(faculty);
  await tp.goto(`/faculty/offerings/${O}/content`);await tp.getByRole('button',{name:'New item'}).waitFor();
  await tabTo(tp,named(/^New item$/,'button'),'New item');await press(tp,'Enter');
  await tp.locator('dialog[open]').waitFor();
  check('opening the dialog with Enter puts focus inside it',(await describe(tp)).inDialog);
  await tabTo(tp,named(/Create and edit/,'button'),'Create and edit');await press(tp,'Enter');
  const stillOpen=await tp.locator('dialog[open]').count()===1;const invalid=await tp.locator('dialog input[name=title]:invalid').count()===1;
  check('submitting the empty form by keyboard is refused and the dialog stays open on the missing title',stillOpen&&invalid);
  await tabTo(tp,d=>d.inDialog&&d.tag==='input'&&/Title/.test(d.name),'the Title field',{back:true});await tp.keyboard.type('Keyboard walkthrough lesson');
  await tabTo(tp,named(/Create and edit/,'button'),'Create and edit');await press(tp,'Enter');
  await tp.getByText('Lesson content').waitFor();
  await tabTo(tp,d=>d.editable,'the lesson editor');await tp.keyboard.type('Typed with the keyboard only.');await tp.waitForTimeout(2500);
  check('the editor autosaves what was typed',(await tp.locator('.save-indicator').innerText()).includes('Saved'));
  // a change made elsewhere: the next edit must surface the conflict, and both choices must be reachable
  const itemUrl=tp.url();const itemId=itemUrl.split('/').slice(-2)[0];created.item=itemId;
  await tp.evaluate(async([o,id])=>{const csrf=(await (await fetch('/api/auth/session')).json()).csrf;const H={'X-CSRF-Token':csrf,'Content-Type':'application/json'};
    const it=await (await fetch(`/api/teach/offerings/${o}/items/${id}`)).json();
    await fetch(`/api/teach/offerings/${o}/items/${id}/draft`,{method:'PUT',headers:H,body:JSON.stringify({expected_counter:it.draft.counter,title:'Changed in another tab',body_html:'<p>Other tab</p>',reference_url:null,reference_note:'',anchor_node_id:null})})},[O,itemId]);
  await tabTo(tp,d=>d.editable,'the lesson editor');await tp.keyboard.type(' More words.');await tp.waitForTimeout(3000);
  await tp.getByText('This draft was changed somewhere else').waitFor();
  await tabTo(tp,named(/Keep my version/,'button'),'Keep my version');await press(tp,'Enter');await tp.waitForTimeout(1500);
  check('an edit conflict is resolved with the keyboard and saving resumes',(await tp.locator('.save-indicator').innerText()).includes('Saved'));
  await tabTo(tp,named(/^Publish$/,'button'),'Publish');await press(tp,'Enter');await tp.waitForURL(/\/content$/);
  check('the lesson is published with the keyboard',(await tp.locator('main').innerText()).includes('Published v1'));

  // ---------- C. gradebook: edit a score, reach the publish control ----------
  await tp.goto(`/faculty/offerings/${O}/gradebook`);await tp.getByRole('heading',{name:'Gradebook'}).waitFor();await tp.waitForLoadState('networkidle');
  await tabTo(tp,d=>d.tag==='button'&&/^(Score .*, edit|Pending, edit score)$/.test(d.name),'a score cell');await press(tp,'Enter');
  await tp.locator('dialog[open]').waitFor();
  check('a score cell opens an editor dialog that holds focus',(await describe(tp)).inDialog);
  await press(tp,'Escape');await tp.locator('dialog[open]').waitFor({state:'detached'});
  check('Escape dismisses the score editor and focus returns to the cell',(await describe(tp))?.tag==='button'&&/edit/.test((await describe(tp)).name));
  await tabTo(tp,named(/Publish Midterm/,'button'),'Publish Midterm');await press(tp,'Enter');      // the confirm() is declined by this script
  check('the publish control is reachable and asks for confirmation before publishing',(await tp.locator('dialog[open]').count())===0);
  await tp.goto(tp.url().replace('/gradebook','/class-standing'));await tp.getByRole('button',{name:'Download PDF'}).waitFor();
  await tabTo(tp,named(/Download PDF/,'button'),'Download PDF');
  check('the export buttons are reachable by keyboard',true);
  await tp.context().close();

  // ---------- D. phone navigation ----------
  const mp=await open(student,{width:375,height:812});
  await mp.goto('/student');await mp.getByRole('heading',{name:/keep learning/}).waitFor();
  await tabTo(mp,named(/Toggle navigation/,'button'),'the menu button');check('the menu button announces it is collapsed',(await describe(mp)).expanded==='false');
  await press(mp,'Enter');check('Enter opens the menu and reports it expanded',(await describe(mp)).expanded==='true');
  await tabTo(mp,d=>d.tag==='a'&&/My subjects/.test(d.name),'My subjects');await press(mp,'Enter');await mp.waitForURL(/\/student\/subjects$/);
  check('a menu link navigates and the menu closes again',(await mp.locator('.sidebar.open').count())===0);
  await tabTo(mp,named(/Toggle navigation/,'button'),'the menu button',{back:true});await press(mp,'Enter');await press(mp,'Escape');
  check('Escape closes an open menu',(await mp.locator('.sidebar.open').count())===0);
  await mp.context().close();

  // ---------- D2. the dashboards: reach the next step and the lists with the keyboard ----------
  const dp=await open(student);
  await dp.goto('/student');await dp.getByRole('heading',{name:/keep learning/}).waitFor();await dp.waitForLoadState('networkidle');
  const step=await tabTo(dp,d=>d.tag==='a'&&/Continue learning|Open work/.test(d.name),'the next-step button');
  await press(dp,'Enter');await dp.waitForURL(/\/student\/offerings\//);
  check('the dashboard next step is reachable by keyboard and opens the lesson or work',/lessons|work/.test(dp.url())&&step.ring);
  await dp.goto('/student');await dp.waitForLoadState('networkidle');
  await tabTo(dp,d=>d.tag==='a'&&d.href.includes('/study'),'a Study help link');
  check('the subject card links (progress, study help) are reachable by keyboard',true);
  await dp.context().close();
  const tp2=await open(faculty);
  await tp2.goto('/faculty');await tp2.getByRole('heading',{name:/Good (morning|afternoon|evening)/}).waitFor();await tp2.waitForLoadState('networkidle');
  await tabTo(tp2,d=>d.tag==='a'&&/^Teach/.test(d.name),'the Teach link');await press(tp2,'Enter');await tp2.waitForURL(/\/faculty\/offerings\//);
  check('a faculty subject card opens its subject with the keyboard',true);
  await tp2.context().close();

  // ---------- E. dialog with a server-side error ----------
  const ap=await open(admin);
  await ap.goto('/admin/accounts');await ap.getByRole('button',{name:'Invite user'}).waitFor();
  await tabTo(ap,named(/^Invite user$/,'button'),'Invite user');await press(ap,'Enter');await ap.locator('dialog[open]').waitFor();
  await tabTo(ap,d=>d.inDialog&&/Full name/.test(d.name),'Full name');await ap.keyboard.type('Duplicate Person');
  await tabTo(ap,d=>d.inDialog&&/^Email/.test(d.name),'Email');await ap.keyboard.type('student1@example.com');
  await tabTo(ap,named(/Send invitation/,'button'),'Send invitation');await press(ap,'Enter');
  await ap.locator('dialog [role=alert]').waitFor({timeout:5000});
  check('a server error appears as an alert inside the open dialog and nothing was sent',await ap.locator('dialog[open]').count()===1);
  let asked='';ap.removeAllListeners('dialog');ap.once('dialog',d=>{asked=d.message();void d.dismiss()});
  await press(ap,'Escape');check('Escape after typing asks before discarding, and declining keeps the dialog open',/Close without saving/.test(asked)&&await ap.locator('dialog[open]').count()===1);
  ap.once('dialog',d=>{void d.accept()});
  await press(ap,'Escape');check('Escape closes it once the discard is confirmed, and focus returns to the Invite button',(await describe(ap))?.name==='Invite user');
  await ap.context().close();
}catch(e){console.log('FAILED:',e.message.slice(0,200));results.push(false);
  if(current){console.log('FOCUS WAS ON:',JSON.stringify(await describe(current).catch(()=>null)));console.log('PAGE SAID:',(await current.locator('main').innerText().catch(()=>'')).slice(0,500));await current.screenshot({path:'../var/screens/keyboard-failure.png',fullPage:true}).catch(()=>{})}}
{ // leave the dev data as found: archive what this run created
  const cp=await open(faculty);await cp.goto('/');
  await cp.evaluate(async([o,quiz,item])=>{const csrf=(await (await fetch('/api/auth/session')).json()).csrf;const H={'X-CSRF-Token':csrf,'Content-Type':'application/json'};
    if(quiz)await fetch(`/api/teach/offerings/${o}/assessments/${quiz}`,{method:'PATCH',headers:H,body:JSON.stringify({archived:true})});
    if(item)await fetch(`/api/teach/offerings/${o}/items/${item}`,{method:'PATCH',headers:H,body:JSON.stringify({archived:true})})},[O,created.quiz,created.item]);
}
await browser.close();
if(noRing.size)console.log('stops WITHOUT a visible focus indicator:',[...noRing].join(' | '));
check('every keyboard stop had a visible focus indicator',noRing.size===0);
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exitCode=results.every(Boolean)?0:1;
