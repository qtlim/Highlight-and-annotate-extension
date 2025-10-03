// ==UserScript==
// @name         Persistent Highlighter + Notes — Click Bubble (No Hotkeys)
// @namespace    qt-highlighter
// @version      1.0.0
// @description  Select text -> click the floating "Annotate" pill -> enter note. Hover shows note. Shift+click a highlight to edit/delete. Persists per page.
// @match        *://*/*
// @exclude      *://*/*.pdf*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // Don’t run on restricted pages
  if (location.href.startsWith('about:') || location.host.includes('addons.mozilla.org')) return;

  // Styles
  GM_addStyle(`
    .uw-annot { background: rgba(255,230,0,.65); padding: 0 1px; border-bottom: 1px dotted rgba(0,0,0,.4); cursor: help; }
    .uw-annot:hover { outline: 1px solid rgba(255,200,0,.9); }
    .uw-bubble {
      position: absolute; z-index: 2147483647; display: none;
      background: #111; color: #fff; border-radius: 999px; padding: 6px 10px; font: 12px/1 -apple-system,Segoe UI,Roboto,sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,.25); user-select: none;
    }
    .uw-bubble button { all: unset; cursor: pointer; background: #ffd400; color:#111; padding: 4px 8px; border-radius: 999px; font-weight: 700; margin-left: 8px; }
  `);

  // Storage (per origin+path)
  const key = () => 'uw_annots::' + location.origin + location.pathname;
  const load = () => { try { return JSON.parse(localStorage.getItem(key())||'[]'); } catch { return []; } };
  const save = arr => localStorage.setItem(key(), JSON.stringify(arr));

  const PREFIX = 32, SUFFIX = 32;

  // Selection helpers
  function selectionInfo() {
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    if (r.collapsed) return null;
    // ignore inputs/contenteditable
    const el = (r.startContainer.nodeType===1 ? r.startContainer : r.startContainer.parentElement);
    if (el && el.closest('input, textarea, [contenteditable="true"]')) return null;

    const exact = r.toString();
    if (!exact.trim()) return null;

    return {
      range: r,
      exact,
      prefix: prefixOf(r, PREFIX),
      suffix: suffixOf(r, SUFFIX),
    };
  }
  function prefixOf(r, n){ try{ const rr=r.cloneRange(); rr.setStart(document.body,0); return rr.toString().slice(-n);}catch{return '';} }
  function suffixOf(r, n){ try{ const rr=r.cloneRange(); rr.setEndAfter(document.body.lastChild||document.body); return rr.toString().slice(0,n);}catch{return '';} }

  // Text search helpers
  function findAll(exact){
    const out=[]; const w=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n){ if(!n.nodeValue||!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p=n.parentElement; if(!p) return NodeFilter.FILTER_ACCEPT;
        const t=p.tagName; if(t==='SCRIPT'||t==='STYLE'||t==='NOSCRIPT') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;}
    });
    for(let n=w.nextNode(); n; n=w.nextNode()){
      let i=0; const txt=n.nodeValue;
      while((i=txt.indexOf(exact,i))!==-1){ out.push({node:n,start:i}); i += exact.length; }
    }
    return out;
  }
  function ctxBefore(node, off, len){
    let acc='', cur=node, o=off;
    while(acc.length<len && cur){ if(cur.nodeType===3){ acc=(cur.nodeValue.slice(0,o)+acc).slice(-len); }
      cur=prevText(cur); o=cur?cur.nodeValue.length:0; }
    return acc.slice(-len);
  }
  function ctxAfter(node, off, len){
    let acc='', cur=node, o=off;
    while(acc.length<len && cur){ if(cur.nodeType===3){ acc=(acc+cur.nodeValue.slice(o)).slice(0,len); }
      cur=nextText(cur); o=0; }
    return acc.slice(0,len);
  }
  function prevText(n){ let x=n; while(x && !x.previousSibling) x=x.parentNode; if(!x) return null; x=x.previousSibling; while(x&&x.lastChild) x=x.lastChild; return x&&x.nodeType===3?x:null; }
  function nextText(n){ let x=n; while(x && !x.nextSibling) x=x.parentNode; if(!x) return null; x=x.nextSibling; while(x&&x.firstChild) x=x.firstChild; return x&&x.nodeType===3?x:null; }

  function findRange(exact, prefix, suffix){
    const matches = findAll(exact);
    for(const m of matches){
      const preOK = prefix ? ctxBefore(m.node, m.start, PREFIX).endsWith(prefix) : true;
      const sufOK = suffix ? ctxAfter(m.node, m.start+exact.length, SUFFIX).startsWith(suffix) : true;
      if(preOK && sufOK){
        const r=document.createRange();
        r.setStart(m.node, m.start);
        r.setEnd(m.node, m.start+exact.length);
        return r;
      }
    }
    return null;
  }

  // Wrap and events
  function wrap(range, note){
    const span=document.createElement('span');
    span.className='uw-annot';
    span.setAttribute('data-note', note||'');
    span.title = note||'';
    range.surroundContents(span);

    span.addEventListener('click', (e)=>{
      if(!e.shiftKey) return;
      e.preventDefault(); e.stopPropagation();
      const updated = prompt('Edit note (leave empty to delete):', span.getAttribute('data-note')||'');
      if(updated===null) return;
      if(updated===''){ // delete
        const p=span.parentNode;
        while(span.firstChild) p.insertBefore(span.firstChild, span);
        p.removeChild(span);
        removeFromStore(span);
      } else {
        span.setAttribute('data-note', updated);
        span.title = updated;
        updateInStore(span, updated);
      }
    }, {capture:true});
  }

  function addFromSelection(){
    const info = selectionInfo();
    if(!info){ alert('Select normal page text (not PDF/inputs) first.'); return; }
    const note = prompt('Enter note for this highlight:');
    if(note===null) return;

    const rec = { exact: info.exact, prefix: info.prefix, suffix: info.suffix, note: note||'', ts: Date.now() };
    const arr = load(); arr.push(rec); save(arr);

    wrap(info.range, rec.note);
    const sel=getSelection(); sel && sel.removeAllRanges();
    hideBubble();
  }

  function hydrate(){
    for(const a of load()){
      const r=findRange(a.exact, a.prefix, a.suffix);
      if(r){ try{ wrap(r, a.note); }catch{} }
    }
  }

  function removeFromStore(span){
    const exact=span.textContent||''; const note=span.getAttribute('data-note')||'';
    const arr=load(); const i=arr.findIndex(a=>a.exact===exact && (a.note||'')===note);
    if(i>=0){ arr.splice(i,1); save(arr); }
  }
  function updateInStore(span, newNote){
    const exact=span.textContent||''; const old=span.getAttribute('data-note')||'';
    const arr=load(); let rec=arr.find(a=>a.exact===exact && (a.note||'')===old) || arr.find(a=>a.exact===exact);
    if(rec){ rec.note=newNote; save(arr); }
  }

  // Floating bubble
  const bubble=document.createElement('div');
  bubble.className='uw-bubble';
  bubble.innerHTML = `Annotate <button>Save</button>`;
  document.documentElement.appendChild(bubble);
  const btn=bubble.querySelector('button');

  function showBubbleNearSelection(){
    const sel=getSelection();
    if(!sel || sel.rangeCount===0 || sel.isCollapsed){ bubble.style.display='none'; return; }
    const r=sel.getRangeAt(0);
    const rect=r.getBoundingClientRect();
    if(!rect || (!rect.width && !rect.height)){ bubble.style.display='none'; return; }
    bubble.style.left = (rect.right + window.scrollX + 8) + 'px';
    bubble.style.top  = (rect.top + window.scrollY - 8) + 'px';
    bubble.style.display='block';
  }
  function hideBubble(){ bubble.style.display='none'; }

  btn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); addFromSelection(); });
  document.addEventListener('selectionchange', showBubbleNearSelection);
  document.addEventListener('mousedown', (e)=>{ if(!bubble.contains(e.target)) hideBubble(); }, true);

  // Menu command (fallback)
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Add highlight from selection', addFromSelection);
  }

  // Boot
  hydrate();
  setTimeout(hydrate, 1200); // helps with late content
})();
