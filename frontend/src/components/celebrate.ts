/** A short burst of confetti for a finished lesson or quiz. Pure decoration: skipped when the person asks for reduced
 *  motion, hidden from assistive technology, never blocks a click, and removes itself. */
const COLORS=['#2E86C1','#F4B400','#27AE60','#E74C3C','#8E44AD','#FF8C42'];

export function celebrate(){
  if(typeof window==='undefined'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const layer=document.createElement('div');layer.className='confetti';layer.setAttribute('aria-hidden','true');
  for(let i=0;i<48;i++){
    const piece=document.createElement('i');
    piece.style.setProperty('--x',`${Math.round((Math.random()-.5)*70)}vw`);
    piece.style.setProperty('--y',`${Math.round(35+Math.random()*55)}vh`);
    piece.style.setProperty('--r',`${Math.round(Math.random()*720-360)}deg`);
    piece.style.left=`${Math.round(35+Math.random()*30)}%`;
    piece.style.background=COLORS[i%COLORS.length];
    piece.style.animationDelay=`${Math.round(Math.random()*150)}ms`;
    layer.append(piece);
  }
  document.body.append(layer);
  window.setTimeout(()=>layer.remove(),2000);
}
