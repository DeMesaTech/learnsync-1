export interface Topic{id:string;title:string}
export interface Subsection{id:string;title:string;topics:Topic[]}
export interface Chapter{id:string;kind:'chapter'|'exam';title:string;weeks:string;ilo:string;activities:string;assessment:string;topics:Topic[];subsections:Subsection[]}
export interface Outcome{id:string;text:string}
export interface Course{code:string;name:string;description:string;units:string;contact_hours:string;prerequisite:string;values:string;references:string;requirements:string;evaluation_note:string}
export interface Outline{course:Course;outcomes:Outcome[];chapters:Chapter[]}
export interface GradingPolicy{categories:{key:string;label:string;weight:number}[];periods:{key:'midterm'|'finals';label:string;share:number}[];transmutation:'raw'|'transmuted';passing:number;late_attendance_fraction:number}
export interface SyllabusRev{id:string;version:number;state:string;counter:number;outline:Outline;grading_policy:GradingPolicy|null;updated_at:string;published_at:string|null;source_file:{id:string;name:string}|null}
export interface SyllabusState{published:SyllabusRev|null;draft:SyllabusRev|null;history:{version:number;state:string;published_at:string|null}[]}
export interface SyllabusDraftContent{outline:Outline;grading_policy:GradingPolicy|null}
export interface FileRef{id:string;name:string;size:number;content_type:string}
export interface ItemRev{version:number;state:string;counter:number;title:string;anchor_node_id:string|null;reference_url:string|null;reference_note:string;file:FileRef|null;updated_at:string;published_at:string|null;body_html?:string;study_chunks?:number;index_state?:'indexed'|'empty'|'failed'|null}
export interface Item{id:string;kind:'lesson'|'file'|'reference';archived:boolean;position:number;section_ids:string[];published:ItemRev|null;draft:ItemRev|null}
export interface ItemDraftContent{title:string;body_html:string;reference_url:string;reference_note:string;anchor_node_id:string|null}
export interface Announcement{id:string;title:string;body:string;state:'draft'|'published'|'archived';section_ids:string[];created_at:string;published_at:string|null}
export interface Coverage{section_id:string;node_id:string;covered_on:string}
export interface LearnItem{id:string;kind:'lesson'|'file'|'reference';title:string;anchor_node_id:string|null;published_at:string;file:FileRef|null;body_html?:string;reference_url?:string|null;reference_note?:string;completed?:boolean|null;up_next?:boolean;next_lesson?:{id:string;title:string}|null;all_completed?:boolean;first_incomplete?:{id:string;title:string}|null;lesson_number?:number;lesson_total?:number}
export interface LearnSyllabus{published:{version:number;published_at:string;outline:Outline;grading_policy:GradingPolicy|null}|null;covered:{node_id:string;covered_on:string}[]}
export const newId=()=>crypto.randomUUID();
export const emptyChapter=():Chapter=>({id:newId(),kind:'chapter',title:'',weeks:'',ilo:'',activities:'',assessment:'',topics:[],subsections:[]});
export const nodeLabels=(o:Outline)=>{const out:{id:string;label:string}[]=[];for(const c of o.chapters){out.push({id:c.id,label:c.title||'Untitled chapter'});c.topics.forEach(t=>out.push({id:t.id,label:`${c.title||'Chapter'} › ${t.title||'Untitled topic'}`}));c.subsections.forEach(s=>{out.push({id:s.id,label:`${c.title||'Chapter'} › ${s.title||'Untitled section'}`});s.topics.forEach(t=>out.push({id:t.id,label:`${s.title||'Section'} › ${t.title||'Untitled topic'}`}))})}return out};
export interface Group<T>{id:string|null;label:string;items:T[]}
/** Items under the syllabus chapter/topic they are attached to, in syllabus order; the rest go last as "Other materials". */
export function groupByNode<T>(items:T[],nodes:{id:string;label:string}[],anchor:(i:T)=>string|null):Group<T>[]{
  const known=new Set(nodes.map(n=>n.id));const out:Group<T>[]=[];
  for(const n of nodes){const list=items.filter(i=>anchor(i)===n.id);if(list.length)out.push({id:n.id,label:n.label,items:list})}
  const rest=items.filter(i=>{const a=anchor(i);return !a||!known.has(a)});
  if(rest.length)out.push({id:null,label:'Other materials',items:rest});
  return out}
