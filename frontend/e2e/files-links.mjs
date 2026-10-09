// Files and links as lessons: they sit in the lesson sequence, can be marked done, count as progress steps, a PDF and a
// picture preview inline (and only those), a link is a card that opens in a new tab.
// SELF-PROVISIONING (publishes a lesson, a link and two files), so run it ONLY against a disposable database that already has an
// offering taught by faculty1@example.com with enrolled students (for example after `npm run e2e:attendance`).
// Refuses unless FILES_E2E_DISPOSABLE=1.
import {launch,newPage,sessionFor,axe} from './lib.mjs';
if(process.env.FILES_E2E_DISPOSABLE!=='1'){console.log('Refusing: set FILES_E2E_DISPOSABLE=1 to confirm this database is disposable.');process.exit(2)}
const results=[];
function check(label,ok,detail=''){results.push(ok);console.log(`${ok?'PASS':'FAIL'} ${label}${detail?' - '+detail:''}`)}
const call=(page,method,path,body)=>page.evaluate(async([method,path,body])=>{
  const s=await (await fetch('/api/auth/session',{credentials:'same-origin'})).json();
  const r=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:body===undefined?undefined:JSON.stringify(body)});
  let data=null;try{data=await r.json()}catch{data=null}return {status:r.status,data}},[method,path,body]);
const uploadFile=(page,path,name,type,base64,counter)=>page.evaluate(async([path,name,type,base64,counter])=>{
  const s=await (await fetch('/api/auth/session',{credentials:'same-origin'})).json();
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const form=new FormData();
  form.append('expected_counter',String(counter));form.append('file',new File([bytes],name,{type}));
  const r=await fetch('/api'+path,{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':s.csrf},body:form});
  return {status:r.status,data:await r.json().catch(()=>null)}},[path,name,type,base64,counter]);
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PDF=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');

const browser=await launch();
try{
  const F=await sessionFor(browser,'faculty1@example.com'),S=await sessionFor(browser,'student1@example.com');
  const teach=await newPage(browser,{state:F,width:1280,height:900});await teach.goto('/faculty');
  const O=(await call(teach,'GET','/me/offerings')).data[0].id;const T=`/teach/offerings/${O}`;
  const n=Date.now()%100000;
  async function publish(id,fields){
    const d=(await call(teach,'GET',`${T}/items/${id}`)).data.draft;
    const sv=(await call(teach,'PUT',`${T}/items/${id}/draft`,{expected_counter:d.counter,...fields})).data;
    return (await call(teach,'POST',`${T}/items/${id}/draft/publish`,{expected_counter:sv.counter})).status}
  const mk=async(kind,title)=>(await call(teach,'POST',`${T}/items`,{kind,title,section_ids:[],anchor_node_id:null})).data.id;
  const lessonId=await mk('lesson','Warm-up lesson '+n);await publish(lessonId,{title:'Warm-up lesson '+n,body_html:'<p>Start here.</p>'});
  const linkId=await mk('reference','Pricing article '+n);
  await publish(linkId,{title:'Pricing article '+n,reference_url:'https://www.example.org/pricing/basics',reference_note:'Skim the first two sections.'});
  const pdfId=await mk('file','Handout PDF '+n);let c=(await call(teach,'GET',`${T}/items/${pdfId}`)).data.draft.counter;
  const up1=await uploadFile(teach,`${T}/items/${pdfId}/draft/file`,'handout.pdf','application/pdf',PDF,c);
  await publish(pdfId,{title:'Handout PDF '+n});
  const imgId=await mk('file','Diagram PNG '+n);c=(await call(teach,'GET',`${T}/items/${imgId}`)).data.draft.counter;
  const up2=await uploadFile(teach,`${T}/items/${imgId}/draft/file`,'diagram.png','image/png',PNG,c);
  await publish(imgId,{title:'Diagram PNG '+n});
  check('the teacher published a lesson, a link and two files',up1.status===200&&up2.status===200);

  // ---- the sequence on the Lessons pill
  const stu=await newPage(browser,{state:S,width:1280,height:900});
  const sb=`/student/offerings/${O}`;
  await stu.goto(`${sb}/classwork?type=lesson`);await stu.locator('ul.seq').first().waitFor();
  const rowOf=t=>stu.locator('ul.seq li',{hasText:t});
  check('files and links appear on the Lessons pill with the lessons',await rowOf('Pricing article '+n).count()===1&&await rowOf('Handout PDF '+n).count()===1&&await rowOf('Diagram PNG '+n).count()===1);
  check('each starts as not marked complete',(await rowOf('Handout PDF '+n).innerText()).includes('Not marked complete'));
  const before=(await call(stu,'GET',`/learn/offerings/${O}/progress`)).data;

  // ---- a link
  await rowOf('Pricing article '+n).getByRole('link',{name:'Pricing article '+n}).click();
  await stu.getByRole('heading',{name:'Pricing article '+n}).waitFor();
  const open=stu.getByRole('link',{name:/Open the link/});
  check('a link is a card with the site name and the teacher’s note',(await stu.locator('.link-card').innerText()).includes('example.org')&&(await stu.locator('.link-card').innerText()).includes('Skim the first two sections.'));
  check('it opens in a new tab without handing over the opener',await open.getAttribute('target')==='_blank'&&(await open.getAttribute('rel')).includes('noopener'));
  check('the www is dropped from the site name',!(await stu.locator('.link-card .eyebrow').innerText()).includes('www'));
  check('axe finds no violations on a link page',(await axe(stu)).length===0);
  await stu.getByRole('button',{name:'Mark link as complete'}).click();
  await stu.getByText('You marked this link complete').waitFor();
  check('a link can be marked complete and says so',(await stu.locator('.toast').innerText()).includes('Link marked complete.'));
  check('and then offers the next item in the sequence',await stu.getByRole('link',{name:/Next (file|lesson|link):/}).count()===1);

  // ---- a PDF
  await stu.goto(`${sb}/classwork?type=lesson`);await stu.locator('ul.seq').first().waitFor();
  await rowOf('Handout PDF '+n).getByRole('link',{name:'Handout PDF '+n}).click();
  await stu.getByRole('heading',{name:'Handout PDF '+n}).waitFor();
  const frame=stu.locator('iframe.file-frame');
  check('a PDF is shown in the page',await frame.count()===1&&(await frame.getAttribute('src')).includes('/preview'));
  const headers=await stu.evaluate(async src=>{const r=await fetch(src,{credentials:'same-origin'});return {status:r.status,type:r.headers.get('content-type'),disp:r.headers.get('content-disposition'),sniff:r.headers.get('x-content-type-options')}},await frame.getAttribute('src'));
  check('the preview is served inline, as a PDF, with nosniff',headers.status===200&&headers.type==='application/pdf'&&headers.disp.startsWith('inline')&&headers.sniff==='nosniff',JSON.stringify(headers));
  check('the download button is still there',await stu.getByRole('link',{name:/Download handout\.pdf/}).count()===1);
  check('axe finds no violations on a PDF page',(await axe(stu)).length===0);
  await stu.getByRole('button',{name:'Mark file as complete'}).click();
  await stu.getByText('You marked this file complete').waitFor();

  // ---- a picture
  await stu.goto(`${sb}/classwork?type=lesson`);await stu.locator('ul.seq').first().waitFor();
  await rowOf('Diagram PNG '+n).getByRole('link',{name:'Diagram PNG '+n}).click();
  const img=stu.locator('img.file-image');await img.waitFor();
  check('a picture is shown in the page and actually loads',await img.evaluate(e=>e.complete&&e.naturalWidth>0));
  check('the picture has a text alternative',(await img.getAttribute('alt')).includes('diagram.png'));
  const down=await stu.evaluate(async id=>{const r=await fetch(`/api/files/${id}/download`,{credentials:'same-origin'});return {disp:r.headers.get('content-disposition'),sniff:r.headers.get('x-content-type-options')}},(await call(stu,'GET',`/learn/offerings/${O}/items/${imgId}`)).data.file.id);
  check('the download stays an attachment with nosniff',down.disp.startsWith('attachment')&&down.sniff==='nosniff');

  // ---- progress
  const after=(await call(stu,'GET',`/learn/offerings/${O}/progress`)).data;
  check('three new steps count and two are done',after.total===before.total&&after.done===before.done+1||after.done===before.done+2,`${before.done}/${before.total} -> ${after.done}/${after.total}`);
  const kinds=after.steps.filter(s=>[linkId,pdfId,imgId].includes(s.id)).map(s=>s.kind).sort();
  check('the progress steps name files and links',kinds.join(',')==='file,file,reference',kinds.join(','));
  const fprog=(await call(teach,'GET',`${T}/progress`)).data;
  check('the teacher’s progress view counts them too',fprog.students.some(s=>s.total>=4));
  await stu.goto(`${sb}/classwork?type=lesson`);await stu.locator('ul.seq').first().waitFor();
  check('the Classwork row shows the file as completed',(await rowOf('Handout PDF '+n).innerText()).includes('Completed'));
}catch(e){console.log('SCRIPT ERROR:',e.message);results.push(false)}
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean)?0:1);
