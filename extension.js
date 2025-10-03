// ==UserScript==
// @name         Persistent Highlighter + Notes — Markdown, Colors, Per-Item Delete
// @namespace    qt-highlighter
// @version      3.0.0
// @description  Select text → Add → write Markdown → Save. Hover shows rendered note + mini toolbar (edit, color, delete). Persists (GM storage + XPath). Works in iframes & after re-renders.
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

  // ---------- Styles ----------
  GM_addStyle(`
    .uw-annot { padding:0 1px; border-radius:2px; cursor:help; }
    .uw-annot[data-color="yellow"] { background: rgba(255,230,0,.65); }
    .uw-annot[data-color="green"]  { background: rgba(160,255,160,.55); }
    .uw-annot[data-color="blue"]   { background: rgba(160,200,255,.55); }
    .uw-annot[data-color="pink"]   { background: rgba(255,160,220,.55); }
    .uw-annot[data-color="orange"] { background: rgba(255,200,120,.55); }
    .uw-annot:hover { outline: 1px solid rgba(30,30,30,.25); }

    .uw-pill {
      position:absolute; z-index:2147483647; display:none;
      background:#111; color:#fff; border-radius:999px; padding:6px 10px;
      font:12px/1 -apple-system,Segoe UI,Roboto,sans-serif; box-shadow:0 4px 16px rgba(0,0,0,.25);
      user-select:none;
    }
    .uw-pill button { all:unset; cursor:pointer; background:#ffd400; color:#111; padding:4px 8px; border-radius:999px; font-weight:700; margin-left:8px; }

    .uw-editor, .uw-pop {
      position:absolute; z-index:2147483647; display:none; max-width:360px;
      background:#1f1f1f; color:#eee; border:1px solid #333; border-radius:10px; padding:10px;
      box-shadow:0 8px 28px rgba(0,0,0,.35);
      font:13px/1.35 -apple-system, Segoe UI, Roboto, sans-serif;
    }
    .uw-editor textarea {
      width:100%; min-height:120px; resize:vertical; box-sizing:border-box;
      border:1px solid #444; background:#111; color:#eee; border-radius:6px; padding:8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .uw-row { display:flex; align-items:center; gap:8px; margin-top:8px; }
    .uw-row .uw-spacer { flex:1; }
    .uw-btn {
      all:unset; cursor:pointer; background:#2b6; color:white; padding:6px 10px; border-radius:8px; font-weight:700;
    }
    .uw-btn.cancel { background:#666; }
    .uw-color { width:18px; height:18px; border-radius:50%; border:2px solid #0003; cursor:pointer; }
    .uw-color[data-c="yellow"] { background:#ffe600; }
    .uw-color[data-c="green"]  { background:#80e680; }
    .uw-color[data-c="blue"]   { background:#8abaff; }
    .uw-color[data-c="pink"]   { background:#ff8ad2; }
    .uw-color[data-c="orange"] { background:#ffc266; }
    .uw-color.active { outline:2px solid #fff; }

    .uw-pop .uw-toolbar { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
    .uw-pop .uw-tool { all:unset; cursor:pointer; background:#2a2a2a; color:#ddd; padding:4px 8px; border-radius:6px; font-size:12px; }
    .uw-pop .uw-colors { display:flex; gap:6px; margin-left:auto; }
    .uw-pop .uw-content { background:#151515; border:1px solid #333; border-radius:8px; padding:8px; max-height:320px; overflow:auto; }
    .uw-pop .uw-content p { margin: 6px 0; }
    .uw-pop .uw-content ul { margin:6px 0 6px 20px; }
    .uw-pop .uw-content code { background:#000; padding:2px 4px; border-radius:4px; }
    .uw-pop .uw-content pre { background:#000; padding:8px; border-radius:6px; overflow:auto; }
    .uw-hidden { display:none !important; }
  `);

  // ---------- Storage (GM, keyed by top-level URL) ----------
  function topKey() {
    try {
      const u = new URL(window.top.location.href);
      return `uw_annots::${u.origin}${u.pathname}`;
    } catch {
      const u = new URL(location.href);
      return `uw_annots::${u.origin}${u.pathname}`;
    }
  }
  const load = () => { try { return JSON.parse(GM_getValue(topKey(), '[]')); } catch { return []; } };
  const save = (arr) => GM_setValue(topKey(), JSON.stringify(arr));

  // ---------- Small Markdown renderer (basic) ----------
  function esc(s){ return s.replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }
  function mdToHtml(md){
    if (!md) return '';
    // code blocks
    md = md.replace(/```([\s\S]*?)```/g, (_,code)=>`<pre><code>${esc(code)}</code></pre>`);
    let html = esc(md);
    // bold/italic/inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // headings
    html = html.replace(/^###### (.+)$/gm,'<h6>$1</h6>')
               .replace(/^##### (.+)$/gm,'<h5>$1</h5>')
               .replace(/^#### (.+)$/gm,'<h4>$1</h4>')
               .replace(/^### (.+)$/gm,'<h3>$1</h3>')
               .replace(/^## (.+)$/gm,'<h2>$1</h2>')
               .replace(/^# (.+)$/gm,'<h1 style="font-size:1.15em;margin:4px 0;">$1</h1>');
    // unordered lists
    const lines = html.split('\n');
    let out = [], inList = false;
    for (const line of lines){
      if (/^\s*[-*]\s+/.test(line)) {
        if (!inList){ out.push('<ul>'); inList = true; }
        out.push('<li>' + line.replace(/^\s*[-*]\s+/, '') + '</li>');
      } else {
        if (inList){ out.push('</ul>'); inList = false; }
        out.push(line);
      }
    }
    if (inList) out.push('</ul>');
    html = out.join('\n');
    // paragraphs (double newline)
    html = html.split(/\n{2,}/).map(p=>`<p>${p.replace(/\n/g,'<br>')}</p>`).join('');
    return html;
  }

  // ---------- UI elements ----------
  const pill = el('div', 'uw-pill', `Annotate <button>Add</button>`);
  document.documentElement.appendChild(pill);
  const pillBtn = pill.querySelector('button');

  const editor = el('div', 'uw-editor', `
    <div style="margin-bottom:6px;font-weight:700;">Enter note (Markdown supported)</div>
    <textarea placeholder="Type here...  \n\n**Bold**, *italic*, lists with - item, code with \`backticks\`."></textarea>
    <div class="uw-row">
      <span>Color:</span>
      ${['yellow','green','blue','pink','orange'].map(c=>`<span class="uw-color" data-c="${c}" title="${c}"></span>`).join('')}
      <span class="uw-spacer"></span>
      <button class="uw-btn cancel">Cancel</button>
      <button class="uw-btn save">Save</button>
    </div>
  `);
  document.documentElement.appendChild(editor);
  const edTextarea = editor.querySelector('textarea');
  const edColors = [...editor.querySelectorAll('.uw-color')];
  const edCancel = editor.querySelector('.cancel');
  const edSave = editor.querySelector('.save');
  let edColor = 'yellow', pendingRange = null, pendingAnchor = null;

  const pop = el('div', 'uw-pop', `
    <div class="uw-toolbar">
      <button class="uw-tool uw-edit">✎ Edit</button>
      <button class="uw-tool uw-del"  title="Delete">🗑 Delete</button>
      <div class="uw-colors">
        ${['yellow','green','blue','pink','orange'].map(c=>`<span class="uw-color" data-c="${c}" title="${c}"></span>`).join('')}
      </div>
    </div>
    <div class="uw-content"></div>
  `);
  document.documentElement.appendChild(pop);
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
    const el = (r.startContainer.nodeType===1 ? r.startContainer : r.startContainer.parentElement);
    if (el && el.closest('input, textarea, [contenteditable="true"]')) return hide(pill);
    const rect = r.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return hide(pill);
    showAt(pill, rect.right + window.scrollX + 8, rect.top + window.scrollY - 8);
  });
  document.addEventListener('mousedown', e => { if (!pill.contains(e.target) && !editor.contains(e.target) && !pop.contains(e.target)) hide(pill); }, true);
  pillBtn.addEventListener('click', e => { e.preventDefault(); openEditorFromSelection(); });

  // ---------- Editor ----------
  edColors.forEach(swatch => {
    swatch.addEventListener('click', () => {
      edColor = swatch.dataset.c;
      edColors.forEach(x=>x.classList.toggle('active', x===swatch));
    });
  });
  edCancel.addEventListener('click', () => hide(editor));
  edSave.addEventListener('click', () => saveFromEditor());

  function openEditorFromSelection() {
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (r.collapsed) return;
    // compute anchor
    pendingRange = r.cloneRange();
    pendingAnchor = rangeToAnchor(pendingRange);
    edTextarea.value = '';
    edColor = 'yellow';
    edColors.forEach(x=>x.classList.toggle('active', x.dataset.c===edColor));
    const rect = r.getBoundingClientRect();
    showAt(editor, rect.left + window.scrollX, rect.bottom + window.scrollY + 8);
    edTextarea.focus();
  }

  function saveFromEditor() {
    if (!pendingRange || !pendingAnchor) return hide(editor);
    const raw = edTextarea.value || '';
    const rec = {
      noteMd: raw,
      color: edColor,
      ts: Date.now(),
      startXPath: pendingAnchor.startXPath, startOffset: pendingAnchor.startOffset,
      endXPath: pendingAnchor.endXPath,     endOffset: pendingAnchor.endOffset,
      exact: pendingRange.toString(), prefix: getPrefix(pendingRange,48), suffix: getSuffix(pendingRange,48)
    };
    const arr = load(); arr.push(rec); save(arr);
    wrap(pendingRange, rec);
    hide(editor); hide(pill);
    const sel = getSelection(); sel && sel.removeAllRanges();
    pendingRange = pendingAnchor = null;
  }

  // ---------- Hover popover on highlights ----------
  document.addEventListener('mouseover', e => {
    const span = e.target.closest('.uw-annot');
    if (!span) { if (!pop.contains(e.target)) hide(pop); return; }
    popTargetSpan = span;
    // toolbar color active
    const color = span.getAttribute('data-color') || 'yellow';
    popColors.forEach(c=>c.classList.toggle('active', c.dataset.c===color));
    // render markdown
    popContent.innerHTML = mdToHtml(span.getAttribute('data-md') || '');
    const rect = span.getBoundingClientRect();
    showAt(pop, rect.left + window.scrollX, rect.bottom + window.scrollY + 6);
  }, true);

  popEdit.addEventListener('click', () => {
    if (!popTargetSpan) return;
    // load into editor
    edTextarea.value = popTargetSpan.getAttribute('data-md') || '';
    edColor = popTargetSpan.getAttribute('data-color') || 'yellow';
    edColors.forEach(x=>x.classList.toggle('active', x.dataset.c===edColor));
    // reconstruct a range from stored anchor in dataset-id
    const rec = findRecordForSpan(popTargetSpan);
    if (!rec) return;
    pendingAnchor = { startXPath: rec.startXPath, startOffset: rec.startOffset, endXPath: rec.endXPath, endOffset: rec.endOffset };
    const r = anchorToRange(pendingAnchor);
    pendingRange = r || popTargetSpan.ownerDocument.createRange();
    const rect = popTargetSpan.getBoundingClientRect();
    showAt(editor, rect.left + window.scrollX, rect.bottom + window.scrollY + 8);
    edTextarea.focus();
    // On save, we UPDATE existing record instead of adding
    edSave.onclick = () => {
      const arr = load();
      rec.noteMd = edTextarea.value || '';
      rec.color = edColor;
      save(arr);
      // update DOM
      popTargetSpan.setAttribute('data-md', rec.noteMd);
      popTargetSpan.setAttribute('data-color', rec.color);
      popTargetSpan.classList.remove('uw-annot'); // force class reflow
      popTargetSpan.classList.add('uw-annot');
      hide(editor); hide(pop);
      // restore save handler
      edSave.onclick = saveFromEditor;
    };
  });

  popDel.addEventListener('click', () => {
    if (!popTargetSpan) return;
    // remove from DOM
    const span = popTargetSpan;
    const parent = span.parentNode;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    hide(pop);
    // remove from storage
    const rec = findRecordForSpan(span);
    if (rec) {
      const arr = load();
      const idx = arr.indexOf(rec);
      if (idx >= 0) { arr.splice(idx,1); save(arr); }
    }
  });

  popColors.forEach(swatch => {
    swatch.addEventListener('click', () => {
      if (!popTargetSpan) return;
      const c = swatch.dataset.c;
      popColors.forEach(x=>x.classList.toggle('active', x===swatch));
      popTargetSpan.setAttribute('data-color', c);
      const rec = findRecordForSpan(popTargetSpan);
      if (rec) { rec.color = c; save(load()); } // save current array (mutated rec)
    });
  });

  // ---------- Helpers ----------
  function el(tag, cls, html){ const d=document.createElement(tag); d.className=cls; d.innerHTML=html; return d; }
  function showAt(node, x, y){ node.style.left = Math.round(x)+'px'; node.style.top = Math.round(y)+'px'; node.style.display='block'; }
  function hide(node){ node.style.display='none'; }

  function getPrefix(r, n){ try{ const rr=r.cloneRange(); rr.setStart(document.body,0); return rr.toString().slice(-n);}catch{return '';} }
  function getSuffix(r, n){ try{ const rr=r.cloneRange(); rr.setEndAfter(document.body.lastChild||document.body); return rr.toString().slice(0,n);}catch{return '';} }

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
    try { return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null; } catch { return null; }
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

  function wrap(range, rec){
    const span = document.createElement('span');
    span.className = 'uw-annot';
    span.setAttribute('data-md', rec.noteMd || '');
    span.setAttribute('data-color', rec.color || 'yellow');
    // a soft id so we can find the record later
    span.setAttribute('data-exact', (range.toString()||'').slice(0,120));
    range.surroundContents(span);
  }

  function findRecordForSpan(span){
    const exact = span.getAttribute('data-exact') || span.textContent || '';
    const md = span.getAttribute('data-md') || '';
    const color = span.getAttribute('data-color') || 'yellow';
    const arr = load();
    // heuristics to match (xpath match is expensive here; use text+md+color)
    return arr.find(r => (r.exact||'').startsWith(exact.slice(0,40)) && (r.noteMd||'')===md && (r.color||'yellow')===color)
        || arr.find(r => (r.noteMd||'')===md && (r.color||'yellow')===color);
  }

  // ---------- Hydration & SPA support ----------
  function hydrate(){
    const arr = load();
    for (const r of arr) {
      let range = anchorToRange(r);
      if (!range && r.exact) { // very rough fallback
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n; while(n = w.nextNode()){
          const i = (n.nodeValue||'').indexOf(r.exact);
          if (i >= 0){ const rng = document.createRange(); rng.setStart(n, i); rng.setEnd(n, i + r.exact.length); range = rng; break; }
        }
      }
      if (range) { try { wrap(range, r); } catch {} }
    }
  }

  const mo = new MutationObserver(() => { clearTimeout(mo._t); mo._t = setTimeout(hydrate, 400); });
  mo.observe(document.documentElement, { childList:true, subtree:true });

  // ---------- Menu helpers ----------
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Add highlight from selection', ()=>openEditorFromSelection());
    GM_registerMenuCommand('List annotations', ()=>{
      const arr = load();
      if (!arr.length) return alert('No annotations for this page.');
      alert(arr.map((r,i)=>`${i+1}. ${r.exact?.slice(0,50)||'(xpath)'}  [${r.color}]`).join('\n'));
    });
  }

  // ---------- Boot ----------
  hydrate();
  setTimeout(hydrate, 1000);
})();
