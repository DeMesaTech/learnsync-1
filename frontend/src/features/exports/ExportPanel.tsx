import {useState} from 'react';
import {PERIOD_LABEL} from '../assessments/types';
import type {OfferingSummary} from '../academics/types';

/** Downloads a grade file. Published = what students can see; working = a preview marked on every page. */
type Choice={period:string;basis:'published'|'working';section:string};
export function ExportPanel({offering,periods,initial,ranked=false}:{offering:OfferingSummary;periods:string[];initial?:Choice;ranked?:boolean}){
  const [own,setOwn]=useState<Choice>({period:periods[0]??'midterm',basis:'published',section:''});
  const {period,basis,section}=initial??own;   // on Class standing the page's own choices are exported: what you see is what you download
  const setPeriod=(p:string)=>setOwn({...own,period:p});const setBasis=(b:'published'|'working')=>setOwn({...own,basis:b});const setSection=(s:string)=>setOwn({...own,section:s});
  const [busy,setBusy]=useState('');const [message,setMessage]=useState('');
  async function download(format:'pdf'|'xlsx'){
    setBusy(format);setMessage('');
    try{
      const query=new URLSearchParams({format,period,basis,...(ranked?{rank:'true'}:{})});if(section)query.set('section_id',section);
      const response=await fetch(`/api/teach/offerings/${offering.id}/exports/grades?${query}`,{credentials:'same-origin'});
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error?.message||'The export could not be created.')}
      const name=/filename="([^"]+)"/.exec(response.headers.get('Content-Disposition')??'')?.[1]??`grades.${format}`;
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
      setMessage(`Downloaded ${name}.`);
    }catch(e){setMessage(e instanceof Error?e.message:'The export could not be created.')}
    finally{setBusy('')}
  }
  return <section className="panel"><h3>Export grades</h3>
    <p className="muted">Real PDF and Excel files for your records, with each student rank. They are not an official institutional form.</p>
    {initial?<p>Exports use the period, section and grades chosen above: <strong>{PERIOD_LABEL[period]??period}</strong>, {section?offering.sections.find(s=>s.id===section)?.name:'all sections'}, {basis==='published'?'published grades':'working preview'}. They include the whole selected scope, whatever the search box shows, and a Rank column.</p>:<>
    <div className="grid-2">
      <label>Period<select value={period} onChange={e=>setPeriod(e.target.value)}>{periods.map(p=><option key={p} value={p}>{PERIOD_LABEL[p]??p}</option>)}</select></label>
      <label>Section<select value={section} onChange={e=>setSection(e.target.value)}><option value="">All sections</option>{offering.sections.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
    <fieldset><legend>What to export</legend>
      <label className="inline"><input type="radio" name="export-basis" checked={basis==='published'} onChange={()=>setBasis('published')}/> Published grades: the latest release students can see</label>
      <label className="inline"><input type="radio" name="export-basis" checked={basis==='working'} onChange={()=>setBasis('working')}/> Working preview: today’s calculated values, not released</label></fieldset></>}
    {basis==='working'&&<p className="warn" role="status">Preview files carry a red “PREVIEW - NOT PUBLISHED” banner on every page or sheet. Do not hand them out as final grades.</p>}
    <div className="actions"><button disabled={!!busy} onClick={()=>download('pdf')}>{busy==='pdf'?'Preparing…':'Download PDF'}</button>
      <button disabled={!!busy} onClick={()=>download('xlsx')}>{busy==='xlsx'?'Preparing…':'Download Excel'}</button></div>
    {message&&<p role="status">{message}</p>}
  </section>;
}
