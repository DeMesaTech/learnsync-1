import {useLocation} from 'react-router-dom';

/** Where the user came from, passed along as router state so Back returns to it rather than to a fixed parent. */
export interface Origin{from:string;label:string}

const PLACES:[RegExp,string][]=[
  [/^\/(student|faculty|admin)$/,'Dashboard'],
  [/^\/(student|faculty)\/subjects$/,'My subjects'],
  [/^\/admin\/terms\/[^/]+$/,'Term workspace'],
  [/^\/admin\/academics$/,'School years'],
  [/^\/admin\/accounts$/,'User accounts'],
  [/\/classwork$/,'Classwork'],
  [/\/lessons$/,'Lessons & materials'],
  [/\/work$/,'My work'],
  [/\/assessments$/,'Assessments'],
  [/\/gradebook$/,'Gradebook'],
  [/\/progress$/,'Progress'],
  [/\/class-standing$/,'Class standing'],
  [/^\/faculty\/offerings\/[^/]+$/,'Students'],
  [/\/syllabus$/,'Syllabus'],
];
const place=(path:string)=>PLACES.find(([re])=>re.test(path.split('?')[0]))?.[1]??'previous page';

/** The state to put on a Link so the page it opens can send the user back here. */
export function useHere():Origin{
  const {pathname,search}=useLocation();
  return {from:pathname+search,label:place(pathname)};
}

/** Back target for the current page: the internal page the user came from, else the given parent. Never a raw history jump. */
export function useOrigin(fallback:string,fallbackLabel:string):{to:string;label:string}{
  const state=useLocation().state as Partial<Origin>|null;
  const ok=typeof state?.from==='string'&&state.from.startsWith('/')&&!state.from.startsWith('//');
  return ok?{to:state!.from!,label:state?.label||'previous page'}:{to:fallback,label:fallbackLabel};
}
