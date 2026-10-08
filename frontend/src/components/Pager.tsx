/** Range text and Previous / Next for a server-paged list. Page size is chosen by the caller. */
export function Pager({page,pageSize,total,onPage,onSize}:{page:number;pageSize:number;total:number;onPage:(p:number)=>void;onSize?:(n:number)=>void}){
  const pages=Math.max(1,Math.ceil(total/pageSize));
  const from=total===0?0:(page-1)*pageSize+1,to=Math.min(total,page*pageSize);
  return <nav className="pager" aria-label="Pages">
    <span role="status">{total===0?'No results':`${from}–${to} of ${total}`}</span>
    <span className="pager-buttons">
      {onSize&&<label className="inline">Rows<select value={pageSize} onChange={e=>onSize(Number(e.target.value))}>{[10,25,50,100].map(n=><option key={n} value={n}>{n}</option>)}</select></label>}
      <button type="button" disabled={page<=1} onClick={()=>onPage(page-1)}>← Previous</button>
      <span>Page {page} of {pages}</span>
      <button type="button" disabled={page>=pages} onClick={()=>onPage(page+1)}>Next →</button></span>
  </nav>;
}
