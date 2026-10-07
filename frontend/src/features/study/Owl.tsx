export type OwlState='idle'|'thinking'|'happy'|'paused';

/** The Study buddy: a small owl drawn inline (no image files). It only reflects what the chat is doing; it has no
 *  levels, streaks, rewards or moods of its own. Motion is switched off under prefers-reduced-motion (see global.css). */
export function Owl({state='idle',size=56,dance=false}:{state?:OwlState;size?:number;dance?:boolean}){
  const eyes=state==='paused'?'closed':state==='happy'||dance?'happy':'open';
  return <svg className={`owl ${state}${dance?' dance':''}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <g className="owl-all">
      <path className="owl-main" d="M11 24 14 5 28 15Z"/><path className="owl-main" d="M53 24 50 5 36 15Z"/>
      <ellipse className="owl-main" cx="32" cy="38" rx="22" ry="21"/>
      <ellipse className="owl-belly" cx="32" cy="46" rx="13" ry="12"/>
      <path className="owl-wing owl-wing-l" d="M10 38Q3 49 13 56 15 47 13 38Z"/><path className="owl-wing owl-wing-r" d="M54 38Q61 49 51 56 49 47 51 38Z"/>
      <circle className="owl-eye" cx="23" cy="30" r="9"/><circle className="owl-eye" cx="41" cy="30" r="9"/>
      {eyes==='open'&&<g className="owl-pupils"><circle className="owl-pupil" cx="23" cy="31" r="4"/><circle className="owl-pupil" cx="41" cy="31" r="4"/></g>}
      {eyes==='happy'&&<><path className="owl-lid" d="M17 32Q23 24 29 32"/><path className="owl-lid" d="M35 32Q41 24 47 32"/></>}
      {eyes==='closed'&&<><path className="owl-lid" d="M17 30Q23 36 29 30"/><path className="owl-lid" d="M35 30Q41 36 47 30"/><text className="owl-z" x="49" y="14">z</text></>}
      <path className="owl-beak" d="M28.5 37h7L32 43Z"/>
      <path className="owl-feet" d="M24 58h5M35 58h5"/>
    </g>
  </svg>;
}
