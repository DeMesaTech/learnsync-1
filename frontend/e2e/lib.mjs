// Shared helpers for the browser checks. Drives the installed Microsoft Edge (no browser download).
// Usage: BASE=http://127.0.0.1:5173 node e2e/<script>.mjs   (the API and Vite must be running)
import {chromium} from 'playwright-core';
import {mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';

export const BASE=process.env.BASE??'http://127.0.0.1:5173';
export const PASSWORD=process.env.DEMO_PASSWORD??'LearnSync-demo-2026';   // development seed password, from backend/app/cli.py
export const SHOTS=process.env.SHOTS??'../var/screens';
mkdirSync(SHOTS,{recursive:true});
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export async function launch(){return chromium.launch({executablePath:EDGE,headless:true})}

export async function newPage(browser,{width=1280,height=900,scheme='light',state}={}){
  const context=await browser.newContext({viewport:{width,height},colorScheme:scheme,baseURL:BASE,storageState:state});
  const page=await context.newPage();
  page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
  return page;
}

export async function login(page,email){
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button',{name:'Sign in'}).click();
  await page.waitForURL(u=>!u.pathname.startsWith('/login'));
}

// one login per account (the sign-in limiter allows 5 per minute), then reuse the session cookie
export async function sessionFor(browser,email){const page=await newPage(browser);await login(page,email);const state=await page.context().storageState();await page.context().close();return state}

export async function shot(page,name,full=true){await page.screenshot({path:`${SHOTS}/${name}.png`,fullPage:full});return `${SHOTS}/${name}.png`}

// axe-core results for the current page. Returns [{id,impact,help,nodes:[target...]}]
export async function axe(page){
  const source=createRequire(import.meta.url)('fs').readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'),'utf8');
  await page.evaluate(source);
  const result=await page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
    return r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.slice(0,5).map(n=>n.target.join(' ')+' :: '+(n.failureSummary||'').split('\n').slice(0,2).join(' | '))}))});
  return result;
}

// whole-page horizontal overflow, and interactive targets smaller than 44px
export async function layout(page){
  return page.evaluate(()=>{
    const small=[...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary')].filter(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&(r.height<44||r.width<24)&&!e.closest('.sr-only')&&!(e.classList.contains('skip'))&&!(e.type==='checkbox'||e.type==='radio')}).map(e=>`${e.tagName.toLowerCase()}:${(e.textContent||e.getAttribute('aria-label')||e.name||'').trim().slice(0,30)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
    return {overflow:document.documentElement.scrollWidth>innerWidth,scrollWidth:document.documentElement.scrollWidth,innerWidth,small:[...new Set(small)].slice(0,12)};
  });
}

// Throwaway content for the browser checks (run on a page signed in as faculty, already at the app origin).
export async function createQuiz(page,offering,title){
  return page.evaluate(async([o,title])=>{
    const csrf=(await (await fetch('/api/auth/session')).json()).csrf;const H={'X-CSRF-Token':csrf,'Content-Type':'application/json'};
    const a=await (await fetch(`/api/teach/offerings/${o}/assessments`,{method:'POST',headers:H,body:JSON.stringify({kind:'online_quiz',title})})).json();
    const d=(await (await fetch(`/api/teach/offerings/${o}/assessments/${a.id}`)).json()).draft;const ids=[0,1,2,3].map(()=>crypto.randomUUID());
    const q=[{key:crypto.randomUUID(),type:'multiple_choice',prompt:'Which one is a business form?',choices:ids.map((id,i)=>({id,text:['Partnership','Weather','Rock','Cloud'][i]})),correct:ids[0],explanation:'',points:'1'},
      {key:crypto.randomUUID(),type:'true_false',prompt:'A sole proprietor has one owner.',choices:[],correct:true,explanation:'',points:'1'},
      {key:crypto.randomUUID(),type:'short_answer',prompt:'Name one business form.',choices:[],correct:['partnership'],explanation:'',points:'1'}];
    const s=await (await fetch(`/api/teach/offerings/${o}/assessments/${a.id}/draft`,{method:'PUT',headers:H,body:JSON.stringify({expected_counter:d.counter,title,instructions:'',category_key:null,period:null,max_points:'3',available_from:null,deadline:null,allow_late:false,max_attempts:3,score_rule:'highest',include_in_grade:false,anchor_node_id:null,questions:q})})).json();
    await fetch(`/api/teach/offerings/${o}/assessments/${a.id}/draft/publish`,{method:'POST',headers:H,body:JSON.stringify({expected_counter:s.counter})});
    return a.id;},[offering,title]);
}
export async function archiveTestContent(page,offering,{quiz,item}){
  await page.evaluate(async([o,quiz,item])=>{const csrf=(await (await fetch('/api/auth/session')).json()).csrf;const H={'X-CSRF-Token':csrf,'Content-Type':'application/json'};
    if(quiz)await fetch(`/api/teach/offerings/${o}/assessments/${quiz}`,{method:'PATCH',headers:H,body:JSON.stringify({archived:true})});
    if(item)await fetch(`/api/teach/offerings/${o}/items/${item}`,{method:'PATCH',headers:H,body:JSON.stringify({archived:true})})},[offering,quiz,item]);
}
