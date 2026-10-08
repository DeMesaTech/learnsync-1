import {NavLink} from 'react-router-dom';

/** A quieter second row of links for the pages that share one main tab (for example People: Students, Attendance, Progress). */
export function SubTabs({label,items}:{label:string;items:{to:string;label:string;end?:boolean;hidden?:boolean}[]}){
  return <nav className="subtabs" aria-label={label}>{items.filter(i=>!i.hidden).map(i=><NavLink key={i.to} to={i.to} end={i.end}>{i.label}</NavLink>)}</nav>;
}
