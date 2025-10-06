// ==UserScript==
// @name         Persistent Highlighter + Notes — v4.2.2 (Reliable Edit/Delete, Custom Swatch Delete, Better List Spacing)
// @namespace    qt-highlighter
// @version      4.2.2
// @description  Select text → Add → Markdown note. Popover (edit, delete, pin, colors incl. picker & saved custom swatches). Persistent per page; SPA-safe.
// @match        *://*/*
// @exclude      *://*/*.pdf*
// @run-at       document-end
// @all-frames   true
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';
  if (location.href.startsWith('about:') || location.host.includes('addons.mozilla.org')) return;

  /*************** STYLE ***************/
  GM_addStyle(`
    .uw-annot{padding:0 1px;border-radius:2px;cursor:help}
    .uw-annot[data-color=yellow]{background:rgba(255,230,0,.65)}
    .uw-annot[data-color=green]{background:rgba(160,255,160,.55)}
    .uw-annot[data-color=blue]{background:rgba(160,200,255,.55)}
    .uw-annot[data-color=pink]{background:rgba(255,160,220,.55)}
    .uw-annot[data-color=orange]{background:rgba(255,200,120,.55)}
    .uw-annot:hover{outline:1px solid rgba(0,0,0,.25)}

    .uw-pill{position:absolute;z-index:2147483647;display:none;background:#fff;color:#111;border:1px solid #ddd;border-radius:999px;padding:6px 10px;font:12px/1 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.1);user-select:none}
    .uw-pill button{all:unset;cursor:pointer;background:#ffd400;color:#111;padding:4px 8px;border-radius:999px;font-weight:700;margin-left:8px}

    .uw-editor,.uw-pop{position:absolute;z-index:2147483647;display:none;max-width:380px;background:#fff;color:#222;border:1px solid #ddd;border-radius:10px;padding:10px;box-shadow:0 10px 28px rgba(0,0,0,.12);font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif}
    .uw-editor textarea{width:100%;min-height:120px;resize:vertical;box-sizing:border-box;border:1px solid #ccc;background:#fff;color:#222;border-radius:6px;padding:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    .uw-row{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}.uw-row .uw-spacer{flex:1}
    .uw-btn{all:unset;cursor:pointer;background:#2b6;color:#fff;padding:6px 10px;border-radius:8px;font-weight:700}.uw-btn.cancel{background:#888}

    .uw-color{width:18px;height:18px;border-radius:50%;border:2px solid #0002;cursor:pointer}
    .uw-color[data-c=yellow]{background:#ffe600}.uw-color[data-c=green]{background:#80e680}
    .uw-color[data-c=blue]{background:#8abaff}.uw-color[data-c=pink]{background:#ff8ad2}
    .uw-color[data-c=orange]{background:#ffc266}.uw-color.active{outline:2px solid #333}
    .uw-custom{box-shadow:inset 0 0 0 2px #fff;border:1px solid #0002}

    .uw-pop .uw-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:6px}
    .uw-pop .uw-tool,.uw-pop .uw-pin{all:unset;cursor:pointer;background:#f2f2f2;color:#333;padding:4px 8px;border-radius:6px;font-size:12px;border:1px solid #e1e1e1}
    .uw-pop .uw-pin.active{background:#ffd400;color:#111;border-color:#e6c600}
    .uw-pop .uw-close{margin-left:4px}
    .uw-pop .uw-colors{display:flex;gap:6px;margin-left:auto;align-items:center;flex-wrap:wrap}
    .uw-pop input.uw-picker,.uw-editor input.uw-picker{width:22px;height:22px;border:none;padding:0;background:transparent;cursor:pointer}
    .uw-customs{display:flex;gap:6px;align-items:center}
    .uw-clear{all:unset;cursor:pointer;font-size:12px;padding:2px 6px;border-radius:6px;border:1px solid #ddd;background:#fafafa}

    /* Inside the rendered note */
    .uw-pop .uw-content { background:#fff; border:1px solid #eee; border-radius:8px; padding:8px; max-height:340px; overflow:auto; color:#222; }
    .uw-pop .uw-content, .uw-pop .uw-content p, .uw-pop .uw-content li { font-size:14px; line-height:1.45; }
    
    .uw-pop .uw-content p { margin:12px 0; }             /* normal paragraph gap */
    .uw-pop .uw-content ul { margin:2px 0; padding-left:18px; } /* tight list body */
    .uw-pop .uw-content ul li { margin:0; }
    
    /* cross-direction gaps */
    .uw-pop .uw-content * + ul { margin-top:10px !important; }  /* paragraph → list */
    .uw-pop .uw-content ul + * { margin-top:18px !important; }  /* list → paragraph/anything */
    
    .uw-pop .uw-content code{background:#f6f6f6;padding:2px 4px;border-radius:4px}
    .uw-pop .uw-content pre{background:#f6f6f6;padding:8px;border-radius:6px;overflow:auto}
  `);

  /*************** STORAGE ***************/
  function pageKey(){
    try{ const u=new URL(window.top.location.href); return `uw_annots::${u.origin}${u.pathname}`; }
    catch{ const u=new URL(location.href); return `uw_annots::${u.origin}${u.pathname}`; }
  }
  const load = () => { try{ return JSON.parse(GM_getValue(pageKey(),'[]')); } catch{ return []; } };
  const save = (arr) => { try{ GM_setValue(pageKey(), JSON.stringify(arr)); }catch{} };

  // custom swatches
  const SWATCH_KEY='uw_custom_swatches';
  const GM_Get=(k,d)=>{ try{ return GM_getValue(k,d);}catch{return d;}};
  const GM_Set=(k,v)=>{ try{ GM_setValue(k,v);}catch{} };
  const normHex = h => {
    if(!h) return null; h=h.trim(); if(!h.startsWith('#')) h='#'+h;
    if(/^#([a-f0-9]{3})$/i.test(h)) h='#'+h.slice(1).split('').map(c=>c+c).join('');
    return /^#[a-f0-9]{6}$/i.test(h)?h.toLowerCase():null;
  };
  const uniq = a => { const s=new Set(),out=[]; for(const x of a||[]){ const h=normHex(x); if(h&&!s.has(h)){s.add(h);out.push(h);} } return out; };
  const loadSwatches = () => uniq(JSON.parse(GM_Get(SWATCH_KEY,'[]')));
  const saveSwatches = (arr)=> GM_Set(SWATCH_KEY, JSON.stringify(uniq(arr).slice(0,8)));
  function addSwatch(hex){ const h=normHex(hex); if(!h) return; const arr=loadSwatches(); if(!arr.includes(h)){arr.unshift(h); saveSwatches(arr); renderCustoms(); bindCustomClicks(editor); bindCustomClicks(pop);} }
  function removeSwatch(hex){ const h=normHex(hex); if(!h) return; saveSwatches(loadSwatches().filter(x=>x!==h)); renderCustoms(); bindCustomClicks(editor); bindCustomClicks(pop); }
  function clearSwatches(){ saveSwatches([]); renderCustoms(); bindCustomClicks(editor); bindCustomClicks(pop); }

  // record helpers
  const updateByUid = (uid,fn)=>{ const a=load(); const i=a.findIndex(r=>r.uid===uid); if(i>=0){ a[i]=fn(a[i])||a[i]; save(a); return a[i]; } return null; };
  const deleteByUid  = uid  => { const a=load(); const i=a.findIndex(r=>r.uid===uid); if(i>=0){ a.splice(i,1); save(a); return true;} return false; };
  const deleteByAnch = anc  => { const a=load(); const i=a.findIndex(r=>r.startXPath===anc.startXPath&&r.startOffset===anc.startOffset&&r.endXPath===anc.endXPath&&r.endOffset===anc.endOffset); if(i>=0){ a.splice(i,1); save(a); return true;} return false; };
  const deleteByText = (txt,color)=>{ const a=load(); const n=a.filter(r=>!(r.exact===txt && r.color===color)); if(n.length!==a.length){ save(n); return true; } return false; };

  /*************** MARKDOWN ***************/
  const esc = s=>s.replace(/[&<>"]/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
  function mdToHtml(md){
    if(!md) return '';
    const fences=[];
    md=md.replace(/```([\s\S]*?)```/g,(_,c)=>{ fences.push(c); return `\uE000${fences.length-1}\uE000`; });
    let t=esc(md);

    t=t.replace(/^###### (.+)$/gm,'<h6>$1</h6>')
       .replace(/^##### (.+)$/gm,'<h5>$1</h5>')
       .replace(/^#### (.+)$/gm,'<h4>$1</h4>')
       .replace(/^### (.+)$/gm,'<h3>$1</h3>')
       .replace(/^## (.+)$/gm,'<h2>$1</h2>')
       .replace(/^# (.+)$/gm,'<h1 style="font-size:1.15em;margin:4px 0;">$1</h1>');

    const lines=t.split('\n'); let out=[],inList=false;
    for(const line of lines){
      if(/^\s*[-*]\s+/.test(line)){
        if(!inList){ out.push('<ul>'); inList=true; }
        out.push('<li>'+line.replace(/^\s*[-*]\s+/,'')+'</li>');
      }else if(/^\s*$/.test(line)){
        if(inList){ out.push('</ul>'); inList=false; }
        out.push(''); // keep empty line
      }else{
        if(inList){ out.push('</ul>'); inList=false; }
        out.push(line);
      }
    }
    if(inList) out.push('</ul>');
    t=out.join('\n');

    // // guarantee a true paragraph break after any </ul> when followed by content
    // t = t.replace(/<\/ul>\s*(?=\S)/g, '</ul>\n\n');

    // guarantee true paragraph break after UL
    t=t.replace(/<\/ul>\n(?!\n)/g,'</ul>\n\n');

    const blocks=t.split(/\n{2,}/).map(b=>b.trim());
    t=blocks.map(b=>{
      if(!b) return '';
      const htmlStart=/^(<ul>|<h[1-6]\b|<pre\b|<\/ul>)/.test(b)||b.includes('<li>');
      return htmlStart?b:`<p>${b.replace(/\n/g,'<br>')}</p>`;
    }).join('');

    t=t.replace(/`([^`]+)`/g,'<code>$1</code>')
       .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
       .replace(/(^|[^*\S])\*([^*\n]+)\*(?!\w)/g,'$1<em>$2</em>')
       .replace(/\uE000(\d+)\uE000/g,(_,i)=>`<pre><code>${esc(fences[+i])}</code></pre>`);
    return t;
  }

  /*************** UI ***************/
  let pendingRange=null, pendingAnchor=null, edColor='yellow', edHex=null;

  const pill = el('div','uw-pill',`Annotate <button>Add</button>`); document.documentElement.appendChild(pill);
  const pillBtn=pill.querySelector('button');

  const editor = el('div','uw-editor',`
    <div style="margin-bottom:6px;font-weight:700;">Enter note (Markdown supported)</div>
    <textarea placeholder="Type here...

- bullet
- bullet

Double Enter = new paragraph."></textarea>
    <div class="uw-row">
      <span>Color:</span>
      ${colors().map(c=>dot(c)).join('')}
      <input class="uw-picker" type="color" value="#ffe600" title="Custom color">
      <div class="uw-customs uw-editor-customs"></div>
      <button class="uw-clear" title="Clear saved colors">🧼 Clear</button>
      <span class="uw-spacer"></span>
      <button class="uw-btn cancel">Cancel</button>
      <button class="uw-btn save">Save</button>
    </div>
  `); document.documentElement.appendChild(editor);
  const edText=editor.querySelector('textarea');
  const edDots=[...editor.querySelectorAll('.uw-color')];
  const edPicker=editor.querySelector('.uw-picker');
  const edCustoms=editor.querySelector('.uw-editor-customs');
  const edClear=editor.querySelector('.uw-clear');
  const edCancel=editor.querySelector('.cancel');
  const edSave=editor.querySelector('.save');

  editor.addEventListener('keydown',ev=>{
    if(ev.key==='Escape'){ev.preventDefault(); hide(editor);}
    if(ev.key==='Enter'&&(ev.ctrlKey||ev.metaKey)){ev.preventDefault(); edSave.click();}
  });

  const pop = el('div','uw-pop',`
    <div class="uw-toolbar">
      <button class="uw-tool uw-edit">✎ Edit</button>
      <button class="uw-tool uw-del">🗑 Delete</button>
      <button class="uw-pin" title="Pin/unpin">📌 Pin</button>
      <button class="uw-tool uw-close" title="Close">✖</button>
      <div class="uw-colors">
        ${colors().map(c=>dot(c)).join('')}
        <input class="uw-picker" type="color" title="Custom color">
        <div class="uw-customs uw-pop-customs"></div>
        <button class="uw-clear" title="Clear saved colors">🧼</button>
      </div>
    </div>
    <div class="uw-content"></div>
  `); document.documentElement.appendChild(pop);
  const popContent=pop.querySelector('.uw-content');
  const popEdit=pop.querySelector('.uw-edit');
  const popDel=pop.querySelector('.uw-del');
  const popClose=pop.querySelector('.uw-close');
  const popDots=[...pop.querySelectorAll('.uw-color')];
  const popPicker=pop.querySelector('.uw-picker');
  const popCustoms=pop.querySelector('.uw-pop-customs');
  const popClear=pop.querySelector('.uw-clear');
  const popPin=pop.querySelector('.uw-pin');
  let popSpan=null, isPinned=false, hideTimer=null;

  // swatches render + bind
  function renderCustoms(){
    const sw=loadSwatches();
    const mk=h=>`<span class="uw-color uw-custom" data-hex="${h}" title="${h} (right-click to remove)" style="background:${h};"></span>`;
    edCustoms.innerHTML=sw.map(mk).join('');
    popCustoms.innerHTML=sw.map(mk).join('');
  }
  renderCustoms();

  function bindCustomClicks(scope){
    scope.querySelectorAll('.uw-custom').forEach(elm=>{
      elm.onclick=e=>{
        const hex=e.currentTarget.getAttribute('data-hex'); if(!hex) return;
        if(scope===editor){ edHex=hex; edColor='custom'; edPicker.value=hex; edDots.forEach(x=>x.classList.remove('active')); }
        else{ if(!popSpan) return; applyColor(popSpan,hex); popDots.forEach(x=>x.classList.remove('active'));
          const rec=getRecForSpan(popSpan); if(rec) updateByUid(rec.uid,r=>({...r,color:hex})); }
      };
      elm.addEventListener('contextmenu',ev=>{ ev.preventDefault(); const hex=ev.currentTarget.getAttribute('data-hex'); if(hex) removeSwatch(hex); });
    });
  }
  bindCustomClicks(editor); bindCustomClicks(pop);
  edClear.addEventListener('click',clearSwatches); popClear.addEventListener('click',clearSwatches);

  /*************** PILL ***************/
  function updatePillFromSelection(){
    const sel=getSelection(); if(!sel||sel.rangeCount===0||sel.isCollapsed) return hide(pill);
    const r=sel.getRangeAt(0);
    const node=(r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement);
    if(node && node.closest('input,textarea,[contenteditable="true"],.uw-annot')) return hide(pill);
    const rect=r.getBoundingClientRect(); if(!rect||(!rect.width&&!rect.height)) return hide(pill);
    showAt(pill, rect.right+window.scrollX+8, rect.top+window.scrollY-8);
  }
  document.addEventListener('selectionchange',updatePillFromSelection);
  document.addEventListener('mouseup',updatePillFromSelection,true);
  document.addEventListener('keyup',e=>{ if(e.key==='Shift') updatePillFromSelection(); });
  document.addEventListener('mousedown',e=>{ if(!pill.contains(e.target) && !editor.contains(e.target) && !pop.contains(e.target)) hide(pill); },true);
  pillBtn.addEventListener('click',e=>{ e.preventDefault(); openEditorFromSelection(); });

  /*************** EDITOR ***************/
  edDots.forEach(s=>s.addEventListener('click',()=>{ edColor=s.dataset.c; edHex=null; edDots.forEach(x=>x.classList.toggle('active',x===s)); }));
  edPicker.addEventListener('input',()=>{ edHex=edPicker.value; edColor='custom'; edDots.forEach(x=>x.classList.remove('active')); });
  edPicker.addEventListener('change',()=>{ if(edHex) addSwatch(edHex); });
  edCancel.addEventListener('click',()=> hide(editor));
  edSave.onclick = saveNew;

  function openEditorFromSelection(){
    const sel=getSelection(); if(!sel||sel.rangeCount===0) return;
    const r=sel.getRangeAt(0); if(r.collapsed) return;
    pendingRange=r.cloneRange(); pendingAnchor=rangeToAnchor(pendingRange);
    edText.value=''; edColor='yellow'; edHex=null; edPicker.value='#ffe600';
    edDots.forEach(x=>x.classList.toggle('active',x.dataset.c===edColor));
    const rc=r.getBoundingClientRect(); showAt(editor, rc.left+window.scrollX, rc.bottom+window.scrollY+10); edText.focus();
  }

  function saveNew(){
    try{
      if(!pendingRange||!pendingAnchor) return hide(editor);
      const colorVal = edHex ? edHex : edColor;
      const rec = { uid:uid(), noteMd:edText.value||'', color:colorVal, ts:Date.now(),
        startXPath:pendingAnchor.startXPath, startOffset:pendingAnchor.startOffset,
        endXPath:pendingAnchor.endXPath, endOffset:pendingAnchor.endOffset, exact:pendingRange.toString() };
      const a=load(); a.push(rec); save(a);
      if(colorVal.startsWith && colorVal.startsWith('#')) addSwatch(colorVal);
      wrapRange(pendingRange,rec);
    }catch(e){ /* swallow */ }
    finally{
      hide(editor); hide(pill);
      const sel=getSelection(); sel && sel.removeAllRanges();
      pendingRange=null; pendingAnchor=null;
      edSave.onclick=saveNew; // ensure default
    }
  }

  /*************** POPOVER ***************/
  function showPopoverFor(span){
    popSpan=span;
    const cur=span.getAttribute('data-color');
    const hex=span.getAttribute('data-hex');
    popDots.forEach(c=>c.classList.toggle('active', c.dataset.c===cur));
    popPicker.value=hex?hex:guessHex(cur);
    popContent.innerHTML=mdToHtml(span.getAttribute('data-md')||'');
    const rect=span.getBoundingClientRect();
    showAt(pop, rect.left+window.scrollX, rect.bottom+window.scrollY+6);
  }
  function clearHide(){ if(hideTimer){clearTimeout(hideTimer); hideTimer=null;} }
  function maybeHide(){ if(isPinned) return; if(!pop.matches(':hover') && !(popSpan && popSpan.matches(':hover'))) hide(pop); }

  document.addEventListener('mouseover',e=>{ const s=e.target.closest('.uw-annot'); if(!s) return; clearHide(); showPopoverFor(s); },true);
  document.addEventListener('mouseout',e=>{ if(!e.target.closest('.uw-annot')||isPinned) return; clearHide(); hideTimer=setTimeout(maybeHide,220); },true);
  pop.addEventListener('mouseenter',clearHide);
  pop.addEventListener('mouseleave',()=>{ if(!isPinned) maybeHide(); });
  popPin.addEventListener('click',()=>{ isPinned=!isPinned; popPin.classList.toggle('active',isPinned); if(!isPinned) maybeHide(); });
  popClose.addEventListener('click',()=>{ isPinned=false; popPin.classList.remove('active'); hide(pop); });

  // Edit → close popover, open editor, save reliably
  popEdit.addEventListener('click',e=>{
    e.stopPropagation();
    if(!popSpan) return;
    const rec=getRecForSpan(popSpan); if(!rec) return;
    isPinned=false; popPin.classList.remove('active'); hide(pop);

    edText.value=rec.noteMd||'';
    if(rec.color && rec.color.startsWith('#')){ edHex=rec.color; edColor='custom'; edPicker.value=rec.color; addSwatch(rec.color); renderCustoms(); bindCustomClicks(editor); bindCustomClicks(pop); }
    else{ edHex=null; edColor=rec.color||'yellow'; edPicker.value=guessHex(edColor); }
    edDots.forEach(x=>x.classList.toggle('active',x.dataset.c===edColor));

    const rect=popSpan.getBoundingClientRect();
    showAt(editor, rect.left+window.scrollX, rect.bottom+window.scrollY+10);
    edText.focus();

    edSave.onclick = ()=>{
      try{
        const newColor = edHex ? edHex : edColor;
        const updated = updateByUid(rec.uid, r => ({...r, noteMd: edText.value||'', color:newColor}));
        // reflect in DOM even if storage failed
        const span=document.querySelector(`.uw-annot[data-uid="${rec.uid}"]`);
        if(span){ applyColor(span, newColor); span.setAttribute('data-md', edText.value||''); }
        if(newColor.startsWith && newColor.startsWith('#')) addSwatch(newColor);
      }catch(e){ /* ignore */ }
      finally{
        edSave.onclick=saveNew; hide(editor);
      }
    };
  });

  // Delete — multiple fallbacks to avoid re-hydrate
  popDel.addEventListener('click',e=>{
    e.stopPropagation();
    if(!popSpan) return;
    try{
      const uidVal=popSpan.getAttribute('data-uid');
      const txt=popSpan.textContent||'';
      const col=popSpan.getAttribute('data-hex')||popSpan.getAttribute('data-color');
      let ok=false;
      if(uidVal) ok = deleteByUid(uidVal);
      if(!ok){ const a=spanAnchorFromDataset(popSpan); if(a) ok = deleteByAnch(a); }
      if(!ok) ok = deleteByText(txt, col);
      // unwrap DOM regardless so user sees it gone immediately
      const p=popSpan.parentNode; while(popSpan.firstChild) p.insertBefore(popSpan.firstChild, popSpan); p.removeChild(popSpan);
      hide(pop);
      if(ok) setTimeout(hydrateOnce,20);
    }catch(e){ hide(pop); }
  });

  popDots.forEach(s=>s.addEventListener('click',e=>{
    e.stopPropagation(); if(!popSpan) return;
    const c=s.dataset.c; popDots.forEach(x=>x.classList.toggle('active',x===s));
    applyColor(popSpan,c);
    const rec=getRecForSpan(popSpan); if(rec) updateByUid(rec.uid,r=>({...r,color:c}));
  }));
  popPicker.addEventListener('input',e=>{
    if(!popSpan) return;
    const hex=e.target.value; applyColor(popSpan,hex); popDots.forEach(x=>x.classList.remove('active'));
    const rec=getRecForSpan(popSpan); if(rec) updateByUid(rec.uid,r=>({...r,color:hex}));
  });
  popPicker.addEventListener('change',e=> addSwatch(e.target.value));

  /*************** HELPERS ***************/
  function el(tag,cls,html){ const d=document.createElement(tag); d.className=cls; d.innerHTML=html; return d; }
  function colors(){ return ['yellow','green','blue','pink','orange']; }
  function dot(c){ return `<span class="uw-color" data-c="${c}" title="${c}"></span>`; }
  function showAt(n,x,y){ n.style.left=Math.round(x)+'px'; n.style.top=Math.round(y)+'px'; n.style.display='block'; }
  function hide(n){ n.style.display='none'; }
  const uid = ()=>'u'+Math.random().toString(36).slice(2)+Date.now().toString(36);

  function getXPath(node){
    if(!node) return null; const parts=[];
    while(node && node.nodeType!==Node.DOCUMENT_NODE){
      let i=1,s=node.previousSibling; while(s){ if(s.nodeName===node.nodeName) i++; s=s.previousSibling; }
      parts.unshift(node.nodeType===Node.TEXT_NODE?`text()[${i}]`:`${node.nodeName.toLowerCase()}[${i}]`); node=node.parentNode;
    }
    return '/'+parts.join('/');
  }
  function resolveXPath(x){ try{ return document.evaluate(x,document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue||null; }catch{ return null; } }
  const rangeToAnchor = r => ({ startXPath:getXPath(r.startContainer), startOffset:r.startOffset, endXPath:getXPath(r.endContainer), endOffset:r.endOffset });
  function anchorToRange(a){
    const sc=resolveXPath(a.startXPath), ec=resolveXPath(a.endXPath); if(!sc||!ec) return null;
    try{ const r=document.createRange(); r.setStart(sc,Math.min(a.startOffset,(sc.nodeValue||'').length)); r.setEnd(ec,Math.min(a.endOffset,(ec.nodeValue||'').length)); return r.collapsed?null:r; }catch{ return null; }
  }
  function spanAnchorFromDataset(span){
    const sx=span.getAttribute('data-sx'), so=span.getAttribute('data-so'),
          ex=span.getAttribute('data-ex'), eo=span.getAttribute('data-eo');
    if(!sx||!ex||so==null||eo==null) return null;
    return { startXPath:sx,startOffset:+so,endXPath:ex,endOffset:+eo };
  }

  function wrapRange(range,rec){
    if(document.querySelector(`.uw-annot[data-uid="${rec.uid}"]`)) return;
    const span=document.createElement('span');
    span.className='uw-annot';
    span.setAttribute('data-uid',rec.uid);
    span.setAttribute('data-md',rec.noteMd||'');
    span.setAttribute('data-sx',rec.startXPath); span.setAttribute('data-so',rec.startOffset);
    span.setAttribute('data-ex',rec.endXPath);   span.setAttribute('data-eo',rec.endOffset);
    applyColor(span, rec.color||'yellow');
    try{ range.surroundContents(span); }
    catch{ const tmp=document.createElement('span'); tmp.textContent=range.toString(); span.appendChild(tmp); range.deleteContents(); range.insertNode(span); }
  }

  function applyColor(span,color){
    if(color && color.startsWith && color.startsWith('#')){
      span.setAttribute('data-color','custom');
      span.setAttribute('data-hex',normHex(color));
      span.style.background=hexToRgba(color,0.6);
    }else{
      span.setAttribute('data-color',color||'yellow');
      span.removeAttribute('data-hex');
      span.style.background=''; // CSS covers named colors
    }
  }
  function hexToRgba(hex,a){
    const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normHex(hex)); if(!m) return hex;
    const r=parseInt(m[1],16), g=parseInt(m[2],16), b=parseInt(m[3],16);
    return `rgba(${r},${g},${b},${a==null?0.6:a})`;
  }
  const guessHex = name => ({yellow:'#ffe600',green:'#80e680',blue:'#8abaff',pink:'#ff8ad2',orange:'#ffc266'})[name] || '#ffe600';

  function getRecForSpan(span){
    const uidVal=span.getAttribute('data-uid');
    if(uidVal){ const r=load().find(x=>x.uid===uidVal); if(r) return r; }
    const a=spanAnchorFromDataset(span);
    if(a){ const r=load().find(x=>x.startXPath===a.startXPath&&x.startOffset===a.startOffset&&x.endXPath===a.endXPath&&x.endOffset===a.endOffset); if(r) return r; }
    return null;
  }

  /*************** HYDRATE/OBSERVE ***************/
  function hydrateOnce(){
    const arr=load();
    for(const r of arr){
      if(document.querySelector(`.uw-annot[data-uid="${r.uid}"]`)) continue;
      const rng=anchorToRange(r); if(rng){ try{ wrapRange(rng,r); }catch{} }
    }
  }
  const mo=new MutationObserver(()=>{ clearTimeout(mo._t); mo._t=setTimeout(hydrateOnce,400); });
  mo.observe(document.documentElement,{childList:true,subtree:true});

  if(typeof GM_registerMenuCommand==='function'){
    GM_registerMenuCommand('Add highlight from selection',()=>{
      const sel=getSelection(); if(!sel||sel.rangeCount===0) return;
      const r=sel.getRangeAt(0); if(r.collapsed) return;
      pendingRange=r.cloneRange(); pendingAnchor=rangeToAnchor(pendingRange);
      edText.value=''; edColor='yellow'; edHex=null; edPicker.value='#ffe600';
      edDots.forEach(x=>x.classList.toggle('active',x.dataset.c===edColor));
      const rc=r.getBoundingClientRect(); showAt(editor, rc.left+window.scrollX, rc.bottom+window.scrollY+10); edText.focus();
    });
    GM_registerMenuCommand('List annotations',()=>{
      const arr=load(); if(!arr.length) return alert('No annotations for this page.');
      alert(arr.map(a=>`${a.uid} [${a.color}] ${a.exact?.slice(0,60)||'(xpath)'}…`).join('\n'));
    });
  }

  hydrateOnce();
  setTimeout(hydrateOnce,1000);
})();


