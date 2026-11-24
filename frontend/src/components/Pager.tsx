import type {ReactNode} from 'react';

/** Range text and Previous / Next for a server-paged list. Page size is chosen by the caller. */
export function Pager({page,pageSize,total,onPage,onSize,leading,iconOnly=false}:{page:number;pageSize:number;total:number;onPage:(p:number)=>void;onSize?:(n:number)=>void;leading?:ReactNode;iconOnly?:boolean}){
  const pages=Math.max(1,Math.ceil(total/pageSize));
  const from=total===0?0:(page-1)*pageSize+1,to=Math.min(total,page*pageSize);
  return <nav className="pager" aria-label="Pages">
    {leading?<div className="pager-leading">{leading}<span role="status">{total===0?'No results':`${from}–${to} of ${total}`}</span></div>
      :<span role="status">{total===0?'No results':`${from}–${to} of ${total}`}</span>}
    <span className="pager-buttons">
      {onSize&&<label className="inline">Rows<select value={pageSize} onChange={e=>onSize(Number(e.target.value))}>{[10,25,50,100].map(n=><option key={n} value={n}>{n}</option>)}</select></label>}
      <button type="button" aria-label="Previous page" title="Previous page" disabled={page<=1} onClick={()=>onPage(page-1)}>{iconOnly?'<<':'← Previous'}</button>
      <span>Page {page} of {pages}</span>
      <button type="button" aria-label="Next page" title="Next page" disabled={page>=pages} onClick={()=>onPage(page+1)}>{iconOnly?'>>':'Next →'}</button></span>
  </nav>;
}
