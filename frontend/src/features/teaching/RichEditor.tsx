import {useEffect} from 'react';
import {EditorContent,useEditor,useEditorState,type Editor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {Table,TableCell,TableHeader,TableRow} from '@tiptap/extension-table';

function Toolbar({editor}:{editor:Editor}){
  const s=useEditorState({editor,selector:({editor:e})=>({bold:e.isActive('bold'),italic:e.isActive('italic'),underline:e.isActive('underline'),strike:e.isActive('strike'),h2:e.isActive('heading',{level:2}),h3:e.isActive('heading',{level:3}),bullet:e.isActive('bulletList'),ordered:e.isActive('orderedList'),quote:e.isActive('blockquote'),code:e.isActive('codeBlock'),link:e.isActive('link'),table:e.isActive('table')})});
  const btn=(label:string,active:boolean,run:()=>void,text=label)=><button type="button" aria-pressed={active} aria-label={label} title={label} onClick={run}>{text}</button>;
  const c=()=>editor.chain().focus();
  function setLink(){
    const previous=editor.getAttributes('link').href as string|undefined;
    const url=prompt('Link address (https://…)',previous??'https://');
    if(url===null)return;
    if(url==='')c().unsetLink().run();
    else if(/^(https?:|mailto:)/i.test(url))c().extendMarkRange('link').setLink({href:url}).run();
    else alert('Links must start with https://, http:// or mailto:');
  }
  return <div className="toolbar" role="toolbar" aria-label="Formatting">
    {btn('Bold',s.bold,()=>c().toggleBold().run(),'B')}{btn('Italic',s.italic,()=>c().toggleItalic().run(),'I')}
    {btn('Underline',s.underline,()=>c().toggleUnderline().run(),'U')}{btn('Strikethrough',s.strike,()=>c().toggleStrike().run(),'S')}
    {btn('Heading',s.h2,()=>c().toggleHeading({level:2}).run(),'H2')}{btn('Subheading',s.h3,()=>c().toggleHeading({level:3}).run(),'H3')}
    {btn('Bulleted list',s.bullet,()=>c().toggleBulletList().run(),'• List')}{btn('Numbered list',s.ordered,()=>c().toggleOrderedList().run(),'1. List')}
    {btn('Quote',s.quote,()=>c().toggleBlockquote().run(),'Quote')}{btn('Code block',s.code,()=>c().toggleCodeBlock().run(),'Code')}
    {btn('Link',s.link,setLink,'Link')}
    {btn('Insert table',s.table,()=>c().insertTable({rows:3,cols:3,withHeaderRow:true}).run(),'Table')}
    {s.table&&<>{btn('Add row',false,()=>c().addRowAfter().run(),'+ Row')}{btn('Add column',false,()=>c().addColumnAfter().run(),'+ Col')}{btn('Delete table',false,()=>c().deleteTable().run(),'Delete table')}</>}
    {btn('Undo',false,()=>c().undo().run(),'↶')}{btn('Redo',false,()=>c().redo().run(),'↷')}
  </div>;
}

/** Visual lesson editor. HTML out is sanitized again by the server before it is stored or shown. */
export function RichEditor({html,onChange,disabled}:{html:string;onChange:(html:string)=>void;disabled?:boolean}){
  const editor=useEditor({
    extensions:[StarterKit.configure({link:{openOnClick:false,autolink:false}}),Table,TableRow,TableHeader,TableCell],
    content:html,editable:!disabled,
    editorProps:{attributes:{role:'textbox','aria-multiline':'true','aria-label':'Lesson content',class:'rich-content'}},
    onUpdate:({editor:e})=>onChange(e.getHTML()),
  });
  useEffect(()=>{if(editor&&html!==editor.getHTML())editor.commands.setContent(html,{emitUpdate:false})},[html,editor]);
  useEffect(()=>{editor?.setEditable(!disabled)},[disabled,editor]);
  if(!editor)return <p>Loading editor…</p>;
  return <div className="rich"><Toolbar editor={editor}/><EditorContent editor={editor}/></div>;
}
