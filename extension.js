// ==UserScript==
// @name         Persistent Highlighter + Notes — Stable UIDs + Light UI
// @namespace    qt-highlighter
// @version      3.1.0
// @description  Markdown notes with color, per-item delete/edit. Stable UIDs prevent re-wrap growth. Light popover/editor. GM storage + XPath anchors. Works in iframes & SPA rerenders.
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

  // ---------- LIGHT THEME ----------
  GM_addStyle(`
    .uw-annot { padding:0 1px; border-radius:2px; cursor:help; }
    .uw-annot[data-color="yellow"] { background: rgba(255,230,0,.65); }
    .uw-annot[data-color="green"]  { background: rgba(160,255,160,.55); }
    .uw-annot[data-color="blue"]   { background: rgba(160,200,255,.55); }
    .uw-annot[data-color="pink"]   { background: rgba(255,160,220,.55); }
    .uw-annot[data-color="orange"] { background: rgba(255,200,120,.55); }
    .uw-annot:hover { outline: 1px solid rgba(0,0,0,.25); }

    .uw-pill {
      position:absolute; z-index:2147483647; display:none;
      background:#ffffff; color:#111; border:1px solid #ddd; border-radius:999px; padding:6px 10px;
      font:12px/1 -apple-system,Segoe UI,Roboto,sans-serif; box-shadow:0 4px 16px rgba(0,0,0,.1); user-select:none;
    }
    .uw-pill button { all:unset; cursor:pointer; background:#ffd400; color:#111; padding:4px 8px; border-radius:999px; font-weight:700; margin-left:8px; }

    .uw-editor, .uw-pop {
      position:absolute; z-index:2147483647; display:none; max-width:380px;
      background:#ffffff; color:#222; border:1px solid #ddd; border-radius:10px; padding:10px;
      box-shadow:0 10px 28px rgba(0,0,0,.12);
      font:13px/1.35 -apple-system, Segoe UI, Roboto, sans-serif;
    }
    .uw-editor textarea {
      width:100%; min-height:120px; resize:vertical; box-sizing:border-box;
      border:1px solid #ccc; background:#fff; color:#222; border-radius:6px; padding:8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .uw-row { display:flex; align-items:center; gap:8px; margin-top:8px; }
    .uw-row .uw-spacer { flex:1; }
    .uw-btn { all:unset; cursor:pointer; background:#2b6; color:white; padding:6px 10px; border-radius:8px; font-weight:700; }
    .uw-btn.cancel { background:#888; }
    .uw-color { width:18px; height:18px; border-radius:50%; border:2px solid #0002; cursor:pointer; }
    .uw-color[data-c="yellow"] { background:#ffe600; }
    .uw-color[data-c="green"]  { background:#80e680; }
    .uw-color[data-c="blue"]   { background:#8abaff; }
    .uw-color[data-c="pink"]   { background:#ff8ad2; }
    .uw-color[data-c="orange"] { background:#ffc266; }
    .uw-color.active { outline:2px solid #333; }

    .uw-pop .uw-toolbar { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
    .uw-pop .uw-tool { all:unset; cursor:pointer; background:#f2f2f2; color:#333; padding:4px 8px; border-radius:6px; font-size:12px; border:1px solid #e1e1e1; }
    .uw-pop .uw-colors { display:flex; gap:6px; margin-left:auto; }
    .uw-pop .uw-content { background:#fff; border:1px solid #eee; border-radius:8px; padding:8px; max-height:320px; overflow:auto; color:#222; }
    .uw-pop .uw-content p { margin: 6px 0; }
    .uw-pop .uw-content ul { margin:6px 0 6px 20px; }
    .uw-pop .uw-content code { background:#f6f6f6; padding:2px 4px; border-radius:4px; }
    .uw-pop .uw-content pre { background:#f6f6f6; padding:8px; border-radius:6px; overflow:auto; }
  `);

  // ---------- Storage (GM, keyed by top-level URL) ----------
  function topKey() {
    try { const u = new URL(window.top.location.href); return `uw_annots::${u.origin}${u.pathname}`; }
    catch { const u = new URL(location.href); return `uw_annots::${u.origin}${u.pathname}`; }
  }
  const load = () => { try { return JSON.parse(GM_getValue(topKey(), '[]')); } catch { return []; } };
  const save = (arr) => GM_setValue(topKey(), JSON.stringify(arr));

  // ---------- Markdown renderer (basic) ----------
  function esc(s){ return s.replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }
  function mdToHtml(md){
    if (!md) return '';
    md = md.replace(/```([\s\S]*?)```/g, (_,code)=>`<pre><code>${esc(code)}</code></pre>`);
    let html = esc(md);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
               .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
               .replace(/\*([^*]+)\*/g, '<em>$1</em>')
               .replace(/^###### (.+)$/gm,'<h6>$1</h6>')
               .replace(/^##### (.+)$/gm,'<h5>$1</h5>')
               .replace(/^#### (.+)$/gm,'<h4>$1</h4>')
               .replace(/^### (.+)$/gm,'<h3>$1</h3>')
               .replace(/^## (.+)$/gm,'<h2>$1</h2>')
               .replace(/^# (.+)$/gm,'<h1 style="font-size:1.15em;margin:4px 0;">$1</h1>');
    const lines = html.split('\n'); let out=[], inList=false;
    for (const line of lines){
      if (/^\s*[-*]\s+/.test(line)) { if (!inList){ out.push('<ul>'); inList=true; } out.push('<li>'+line.replace(/^\s*[-*]\s+/, '')+'</li>'); }
      else { if (inList){ out.push('</ul>'); inList=false; } out.push(line); }
    }
    if (inList) out.push('</ul>');
    html = out.join('\n');
    html = html.split(/\n{2,}/).map(p=>`<p>${p.replace(/\n/g,'<br>')}</p>`).join('');
    return html;
  }

  // ---------- UI ----------
  const pill = el('div','uw-pill',`Annotate <button>Add</button>`); document.documentElement.appendChild(pill);
  const pillBtn = pill.querySelector('button');

  const editor = el('div','uw-editor',`
    <div style="margin-bottom:6px;font-weight:700;">Enter note (Markdown supported)</div>
    <textarea placeholder="Type here...

- bullet
- bullet

Double Enter = new paragraph."></textarea>
    <div class="uw-row">
      <span>Color:</span>
      ${['yellow','green','blue','pink','orange'].map(c=>`<span class="uw-color" data-c="${c}" title="${c}"></span>`).join('')}
      <span class="uw-spacer"></span>
      <button class="uw-btn cancel">Cancel</button>
      <button class="uw-btn save">Save</button>
    </div>
  `); document.documentElement.appendChild(editor);
  const edTextarea = editor.querySelector('textarea');
  const edColors = [...editor.querySelectorAll('.uw-color')];
  const edCancel = editor.querySelector('.cancel');
  const edSave   = editor.querySelector('.save');
  let edColor='yellow', pendingRange=null, pendingAnchor=null, pendingUid=null;

  const pop = el('div','uw-pop',`
    <div class="uw-toolbar">
      <button class="uw-tool uw-edit">✎ Edit</button>
      <button class="uw-tool uw-del">🗑 Delete</button>
      <div class="uw-colors">${['yellow','green','blue','pink','orange'].map(c=>`<span class="uw-color" data-c="${c}" title="${c}"></span>`).join('')}</div>
    </div>
    <div class="uw-content"></div>
  `); document.documentElement.appendChild(pop);
  const popContent = pop.querySelector('.uw-content');
  const popEdit = pop.querySelector('.uw-edit');
  const popDel  = pop.querySelector('.uw-del');
  const popColors = [...pop.querySelectorAll('.uw-color')];
  let popTargetSpan = null;

  // ---------- Selection pill ----------
  document.addEventListener('selectionchange', () => {
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return hide(pill);
    const r = sel.getRangeAt(0);
    const eln = (r.startContainer.nodeType===1 ? r.startContainer : r.startContainer.parentElement);
    if (eln && eln.closest('input, textarea, [contenteditable="true"], .uw-annot')) return hide(pill);
    const rect = r.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return hide(pill);
    showAt(pill, rect.right + window.scrollX + 8, rect.top + window.scrollY - 8);
  });
  document.addEventListener('mousedown', e => { if (!pill.contains(e.target) && !editor.contains(e.target) && !pop.contains(e.target)) hide(pill); }, true);
  pillBtn.addEventListener('click', e => { e.preventDefault(); openEditorFromSelection(); });

  // ---------- Editor handlers ----------
  edColors.forEach(s=>s.addEventListener('click',()=>{ edColor=s.dataset.c; edColors.forEach(x=>x.classList.toggle('active', x===s)); }));
  edCancel.addEventListener('click', ()=>{ edSave.onclick = saveNew; hide(editor); pendingUid=null; });
  edSave.onclick = saveNew;

  function openEditorFromSelection(){
    const sel=getSelection(); if (!sel || sel.rangeCount===0) return;
    const r=sel.getRangeAt(0); if (r.collapsed) return;
    pendingRange = r.cloneRange();
    pendingAnchor = rangeToAnchor(pendingRange);
    pendingUid = null; // new
    edTextarea.value=''; edColor='yellow'; edColors.forEach(x=>x.classList.toggle('active', x.dataset.c===edColor));
    const rc=r.getBoundingClientRect(); showAt(editor, rc.left+window.scrollX, rc.bottom+window.scrollY+8); edTextarea.focus();
  }

  function saveNew(){
    if (!pendingRange || !pendingAnchor) return hide(editor);
    const rec = {
      uid: genUid(),
      noteMd: edTextarea.value || '',
      color: edColor, ts: Date.now(),
      startXPath: pendingAnchor.startXPath, startOffset: pendingAnchor.startOffset,
      endXPath: pendingAnchor.endXPath,     endOffset: pendingAnchor.endOffset,
      exact: pendingRange.toString()
    };
    const arr=load(); arr.push(rec); save(arr);
    wrap(pendingRange, rec); cleanupEditor();
  }

  function saveEdit(rec){
    rec.noteMd = edTextarea.value || '';
    rec.color  = edColor;
    save(load()); // rec is mutated inside loaded array
    // update DOM span
    const span = document.querySelector(`.uw-annot[data-uid="${rec.uid}"]`);
    if (span){ span.setAttribute('data-md', rec.noteMd); span.setAttribute('data-color', rec.color); }
    hide(editor); hide(pop);
    edSave.onclick = saveNew; pendingUid=null;
  }

  function cleanupEditor(){
    hide(editor); hide(pill);
    const sel=getSelection(); sel && sel.removeAllRanges();
    pendingRange=null; pendingAnchor=null; pendingUid=null;
  }

  // ---------- Popover ----------
  document.addEventListener('mouseover', e => {
    const span = e.target.closest('.uw-annot');
    if (!span) { if (!pop.contains(e.target)) hide(pop); return; }
    popTargetSpan = span;
    const color = span.getAttribute('data-color') || 'yellow';
    popColors.forEach(c=>c.classList.toggle('active', c.dataset.c===color));
    popContent.innerHTML = mdToHtml(span.getAttribute('data-md') || '');
    const rect = span.getBoundingClientRect();
    showAt(pop, rect.left + window.scrollX, rect.bottom + window.scrollY + 6);
  }, true);

  popEdit.addEventListener('click', () => {
    if (!popTargetSpan) return;
    const rec = findRecByUid(popTargetSpan.getAttribute('data-uid')); if (!rec) return;
    edTextarea.value = rec.noteMd || '';
    edColor = rec.color || 'yellow';
    edColors.forEach(x=>x.classList.toggle('active', x.dataset.c===edColor));
    // open editor near span
    const rect = popTargetSpan.getBoundingClientRect();
    showAt(editor, rect.left + window.scrollX, rect.bottom + window.scrollY + 8);
    edTextarea.focus();
    pendingUid = rec.uid;
    edSave.onclick = ()=>saveEdit(rec);
  });

  popDel.addEventListener('click', () => {
    if (!popTargetSpan) return;
    const uid = popTargetSpan.getAttribute('data-uid');
    // remove DOM
    const span = popTargetSpan, parent = span.parentNode;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span); hide(pop);
    // remove from storage
    const arr = load(); const i = arr.findIndex(r => r.uid === uid);
    if (i >= 0) { arr.splice(i,1); save(arr); }
  });

  popColors.forEach(s=>s.addEventListener('click',()=>{
    if (!popTargetSpan) return;
    const c = s.dataset.c; popColors.forEach(x=>x.classList.toggle('active', x===s));
    popTargetSpan.setAttribute('data-color', c);
    const rec = findRecByUid(popTargetSpan.getAttribute('data-uid')); if (rec){ rec.color = c; save(load()); }
  }));

  // ---------- Helpers ----------
  function el(tag, cls, html){ const d=document.createElement(tag); d.className=cls; d.innerHTML=html; return d; }
  function showAt(node,x,y){ node.style.left=Math.round(x)+'px'; node.style.top=Math.round(y)+'px'; node.style.display='block'; }
  function hide(node){ node.style.display='none'; }
  function genUid(){ return 'u' + Math.random().toString(36).slice(2) + Date.now().toString(36); }

  function getXPath(node){
    if (!node) return null;
    const parts=[];
    while (node && node.nodeType !== Node.DOCUMENT_NODE) {
      let i=1, sib=node.previousSibling;
      while (sib) { if (sib.nodeName === node.nodeName) i++; sib=sib.previousSibling; }
      parts.unshift(node.nodeType===Node.TEXT_NODE ? `text()[${i}]` : `${node.nodeName.toLowerCase()}[${i}]`);
      node=node.parentNode;
    }
    return '/' + parts.join('/');
  }
  function resolveXPath(xpath){
    try { return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null; }
    catch { return null; }
  }
  function rangeToAnchor(r){
    return {
      startXPath: getXPath(r.startContainer), startOffset: r.startOffset,
      endXPath:   getXPath(r.endContainer),   endOffset:   r.endOffset
    };
  }
  function anchorToRange(a){
    const sc = resolveXPath(a.startXPath), ec = resolveXPath(a.endXPath);
    if (!sc || !ec) return null;
    try {
      const r = document.createRange();
      r.setStart(sc, Math.min(a.startOffset, (sc.nodeValue||'').length));
      r.setEnd(ec, Math.min(a.endOffset, (ec.nodeValue||'').length));
      return r.collapsed ? null : r;
    } catch { return null; }
  }

  // Wrap range → span with UID. If it already exists, skip.
  function wrap(range, rec){
    // If the range is inside an existing annotation, do not double-wrap.
    if (range.commonAncestorContainer && range.commonAncestorContainer.parentElement &&
        range.commonAncestorContainer.parentElement.closest &&
        range.commonAncestorContainer.parentElement.closest('.uw-annot')) return;

    // Also, if a span with this UID already exists, skip.
    if (document.querySelector(`.uw-annot[data-uid="${rec.uid}"]`)) return;

    const span = document.createElement('span');
    span.className = 'uw-annot';
    span.setAttribute('data-uid', rec.uid);
    span.setAttribute('data-md',  rec.noteMd || '');
    span.setAttribute('data-color', rec.color || 'yellow');
    try { range.surroundContents(span); }
    catch {
      // if DOM split prevents surroundContents, fallback to simple text replace
      const tmp = document.createElement('span');
      tmp.textContent = range.toString();
      span.appendChild(tmp);
      range.deleteContents();
      range.insertNode(span);
    }
  }

  function findRecByUid(uid){ return load().find(r => r.uid === uid); }

  // ---------- Hydration (skip inside existing spans; avoid duplicates) ----------
  function hydrateOnce(){
    const arr = load();
    for (const r of arr) {
      if (document.querySelector(`.uw-annot[data-uid="${r.uid}"]`)) continue; // already present
      let range = anchorToRange(r);
      if (!range && r.exact) {
        // fallback: search text but skip inside existing annotations
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(n){
            if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            if (n.parentElement && n.parentElement.closest('.uw-annot')) return NodeFilter.FILTER_REJECT;
            const p = n.parentElement, t = p && p.tagName;
            if (t==='SCRIPT'||t==='STYLE'||t==='NOSCRIPT') return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        let node; while (node = walker.nextNode()){
          const i = (node.nodeValue||'').indexOf(r.exact);
          if (i >= 0){ const rng = document.createRange(); rng.setStart(node, i); rng.setEnd(node, i + r.exact.length); range = rng; break; }
        }
      }
      if (range) { try { wrap(range, r); } catch {} }
    }
  }

  const mo = new MutationObserver(()=>{ clearTimeout(mo._t); mo._t = setTimeout(hydrateOnce, 400); });
  mo.observe(document.documentElement, { childList:true, subtree:true });

  // ---------- Menu helpers ----------
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Add highlight from selection', ()=>{
      const sel=getSelection(); if (!sel || sel.rangeCount===0) return;
      const r=sel.getRangeAt(0); if (r.collapsed) return;
      pendingRange = r.cloneRange(); pendingAnchor = rangeToAnchor(pendingRange);
      edTextarea.value=''; edColor='yellow'; edColors.forEach(x=>x.classList.toggle('active', x.dataset.c===edColor));
      const rc=r.getBoundingClientRect(); showAt(editor, rc.left+window.scrollX, rc.bottom+window.scrollY+8); edTextarea.focus();
    });
    GM_registerMenuCommand('List annotations', ()=>{
      const arr = load(); if (!arr.length) return alert('No annotations for this page.');
      alert(arr.map(a=>`${a.uid}  [${a.color}]  ${a.exact?.slice(0,60)||'(xpath)'} …`).join('\n'));
    });
  }

  // ---------- Boot ----------
  hydrateOnce();
  setTimeout(hydrateOnce, 1000);

  // utils
  function el(tag, cls, html){ const d=document.createElement(tag); d.className=cls; d.innerHTML=html; return d; }
  function showAt(node,x,y){ node.style.left=Math.round(x)+'px'; node.style.top=Math.round(y)+'px'; node.style.display='block'; }
  function hide(node){ node.style.display='none'; }
  function rangeToAnchor(r){ return { startXPath:getXPath(r.startContainer), startOffset:r.startOffset, endXPath:getXPath(r.endContainer), endOffset:r.endOffset }; }
  function getXPath(node){ if (!node) return null; const parts=[]; while (node && node.nodeType!==Node.DOCUMENT_NODE){ let i=1,s=node.previousSibling; while(s){ if(s.nodeName===node.nodeName) i++; s=s.previousSibling; } parts.unshift(node.nodeType===Node.TEXT_NODE?`text()[${i}]`:`${node.nodeName.toLowerCase()}[${i}]`); node=node.parentNode; } return '/'+parts.join('/'); }
  function resolveXPath(x){ try{ return document.evaluate(x, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue||null; }catch{ return null; } }
  function anchorToRange(a){ const sc=resolveXPath(a.startXPath), ec=resolveXPath(a.endXPath); if(!sc||!ec) return null; try{ const r=document.createRange(); r.setStart(sc, Math.min(a.startOffset,(sc.nodeValue||'').length)); r.setEnd(ec, Math.min(a.endOffset,(ec.nodeValue||'').length)); return r.collapsed?null:r; }catch{ return null; } }
})();

