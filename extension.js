// ==UserScript==
// @name         Persistent Highlighter + Notes — v4.0.2 (List→Paragraph Gap + Saved/Removable Custom Swatches)
// @namespace    qt-highlighter
// @version      4.0.2
// @description  Select text → Add → Markdown note. Hover shows popover (edit, delete, pin, color incl. picker & saved custom swatches you can right-click OR Alt-click to remove). Robust persistence (GM storage + XPath), SPA-safe.
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

  // ---------- THEME / TYPOGRAPHY ----------
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
      background:#fff; color:#111; border:1px solid #ddd; border-radius:999px; padding:6px 10px;
      font:12px/1 -apple-system,Segoe UI,Roboto,sans-serif; box-shadow:0 4px 16px rgba(0,0,0,.1); user-select:none;
    }
    .uw-pill button { all:unset; cursor:pointer; background:#ffd400; color:#111; padding:4px 8px; border-radius:999px; font-weight:700; margin-left:8px; }

    .uw-editor, .uw-pop {
      position:absolute; z-index:2147483647; display:none; max-width:380px;
      background:#fff; color:#222; border:1px solid #ddd; border-radius:10px; padding:10px;
      box-shadow:0 10px 28px rgba(0,0,0,.12);
      font:14px/1.45 -apple-system, Segoe UI, Roboto, sans-serif;
    }
    .uw-editor textarea {
      width:100%; min-height:120px; resize:vertical; box-sizing:border-box;
      border:1px solid #ccc; background:#fff; color:#222; border-radius:6px; padding:8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .uw-row { display:flex; align-items:center; gap:8px; margin-top:8px; flex-wrap:wrap; }
    .uw-row .uw-spacer { flex:1; }
    .uw-btn { all:unset; cursor:pointer; background:#2b6; color:#fff; padding:6px 10px; border-radius:8px; font-weight:700; }
    .uw-btn.cancel { background:#888; }

    .uw-color { width:18px; height:18px; border-radius:50%; border:2px solid #0002; cursor:pointer; }
    .uw-color[data-c="yellow"] { background:#ffe600; }
    .uw-color[data-c="green"]  { background:#80e680; }
    .uw-color[data-c="blue"]   { background:#8abaff; }
    .uw-color[data-c="pink"]   { background:#ff8ad2; }
    .uw-color[data-c="orange"] { background:#ffc266; }
    .uw-color.active { outline:2px solid #333; }
    .uw-custom { box-shadow: inset 0 0 0 2px #fff; border:1px solid #0002; }

    .uw-pop .uw-toolbar { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
    .uw-pop .uw-tool { all:unset; cursor:pointer; background:#f2f2f2; color:#333; padding:4px 8px; border-radius:6px; font-size:12px; border:1px solid #e1e1e1; }
    .uw-pop .uw-pin { all:unset; cursor:pointer; background:#f2f2f2; color:#333; padding:4px 8px; border-radius:6px; font-size:12px; border:1px solid #e1e1e1; }
    .uw-pop .uw-pin.active { background:#ffd400; color:#111; border-color:#e6c600; }
    .uw-pop .uw-close { margin-left:4px; }
    .uw-pop .uw-colors { display:flex; gap:6px; margin-left:auto; align-items:center; flex-wrap:wrap; }
    .uw-pop input.uw-picker, .uw-editor input.uw-picker { width:22px; height:22px; border:none; padding:0; background:transparent; cursor:pointer; }
    .uw-customs { display:flex; gap:6px; }

    .uw-pop .uw-content { background:#fff; border:1px solid #eee; border-radius:8px; padding:8px; max-height:340px; overflow:auto; color:#222; }
    .uw-pop .uw-content, .uw-pop .uw-content p, .uw-pop .uw-content li { font-size:14px; line-height:1.45; }
    .uw-pop .uw-content p { margin: 10px 0; }
    .uw-pop .uw-content ul { margin: 4px 0; padding-left: 18px; }
    .uw-pop .uw-content ul + p { margin-top: 10px; }
    .uw-pop .uw-content p + ul { margin-top: 6px; }
    .uw-pop .uw-content ul li { margin: 0; }
    .uw-pop .uw-content code { background:#f6f6f6; padding:2px 4px; border-radius:4px; }
    .uw-pop .uw-content pre { background:#f6f6f6; padding:8px; border-radius:6px; overflow:auto; }
  `);

  // ---------- STORAGE ----------
  function pageKey() {
    try { const u = new URL(window.top.location.href); return `uw_annots::${u.origin}${u.pathname}`; }
    catch { const u = new URL(location.href); return `uw_annots::${u.origin}${u.pathname}`; }
  }
  const load = () => { try { return JSON.parse(GM_getValue(pageKey(), '[]')); } catch { return []; } };
  const save = (arr) => GM_setValue(pageKey(), JSON.stringify(arr));

  // persistent custom swatches
  const SWATCH_KEY = 'uw_custom_swatches';
  const loadSwatches = () => { try { return JSON.parse(GM_getValue(SWATCH_KEY, '[]')); } catch { return []; } };
  const saveSwatches = (arr) => GM_Set(SWATCH_KEY, JSON.stringify(arr.slice(0,8)));
  // small helper to be robust on some userscript engines
  function GM_Set(k,v){ try{ GM_setValue(k,v);}catch{ localStorage.setItem(k,v);} }
  function GM_Get(k,d){ try{ return GM_getValue(k,d);}catch{ const v=localStorage.getItem(k); return v==null?d:v; } }

  function addSwatch(hex){
    hex = normalizeHex(hex);
    if (!hex) return;
    const arr = loadSwatches();
    if (!arr.includes(hex)) { arr.unshift(hex); GM_Set(SWATCH_KEY, JSON.stringify(arr.slice(0,8))); renderCustoms(); }
  }
  function removeSwatch(hex){
    hex = normalizeHex(hex);
    if (!hex) return;
    const arr = loadSwatches().filter(h => h !== hex);
    GM_Set(SWATCH_KEY, JSON.stringify(arr));
    renderCustoms();
    // rebind after DOM update
    bindCustomClicks(editor);
    bindCustomClicks(pop);
  }

  function updateByUid(uid, fn){ const arr=load(); const i=arr.findIndex(r=>r.uid===uid); if(i>=0){arr[i]=fn(arr[i])||arr[i]; save(arr); return arr[i];} return null; }
  function deleteByUid(uid){ const arr=load(); const i=arr.findIndex(r=>r.uid===uid); if(i>=0){arr.splice(i,1); save(arr); return true;} return false; }
  function deleteByAnchor(a){ const arr=load(); const i=arr.findIndex(r=>r.startXPath===a.startXPath&&r.startOffset===a.startOffset&&r.endXPath===a.endXPath&&r.endOffset===a.endOffset); if(i>=0){arr.splice(i,1); save(arr); return true;} return false; }

  // ---------- MARKDOWN ----------
  function esc(s){ return s.replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }
  function mdToHtml(md){
    if (!md) return '';
    const blocks = [];
    md = md.replace(/```([\s\S]*?)```/g, (_,code)=>{ blocks.push(code); return `\uE000${blocks.length-1}\uE000`; });
    let text = esc(md);

    text = text.replace(/^###### (.+)$/gm,'<h6>$1</h6>')
               .replace(/^##### (.+)$/gm,'<h5>$1</h5>')
               .replace(/^#### (.+)$/gm,'<h4>$1</h4>')
               .replace(/^### (.+)$/gm,'<h3>$1</h3>')
               .replace(/^## (.+)$/gm,'<h2>$1</h2>')
               .replace(/^# (.+)$/gm,'<h1 style="font-size:1.15em;margin:4px 0;">$1</h1>');

    const lines = text.split('\n'); let out=[], inList=false;
    for (const line of lines){
      if (/^\s*[-*]\s+/.test(line)) {
        if (!inList){ out.push('<ul>'); inList=true; }
        out.push('<li>' + line.replace(/^\s*[-*]\s+/, '') + '</li>');
      } else {
        if (inList){ out.push('</ul>'); inList=false; }
        out.push(line);
      }
    }
    if (inList) out.push('</ul>');
    text = out.join('\n');

    const blocks2 = text.split(/\n{2,}/).map(b => b.trim());
    const htmlBlocks = blocks2.map(b => {
      if (!b) return '';
      const startsWithHtml = /^(<ul>|<h[1-6]\b|<pre\b|<\/ul>)/.test(b) || b.includes('<li>');
      return startsWithHtml ? b : `<p>${b.replace(/\n/g,'<br>')}</p>`;
    });
    text = htmlBlocks.join('');

    text = text.replace(/`([^`]+)`/g, '<code>$1</code>')
               .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
               .replace(/(^|[^*\S])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
               .replace(/\uE000(\d+)\uE000/g, (_,i)=>`<pre><code>${esc(blocks[+i])}</code></pre>`);
    return text;
  }

  // ---------- UI ----------
  const pill = div('uw-pill',`Annotate <button>Add</button>`); document.documentElement.appendChild(pill);
  const pillBtn = pill.querySelector('button');

  const editor = div('uw-editor',`
    <div style="margin-bottom:6px;font-weight:700;">Enter note (Markdown supported)</div>
    <textarea placeholder="Type here...

- bullet
- bullet

Double Enter = new paragraph."></textarea>
    <div class="uw-row">
      <span>Color:</span>
      ${colors().map(c=>dot(c)).join('')}
      <input class="uw-picker" type="color" title="Custom color" value="#ffe600">
      <div class="uw-customs uw-editor-customs"></div>
      <span class="uw-spacer"></span>
      <button class="uw-btn cancel">Cancel</button>
      <button class="uw-btn save">Save</button>
    </div>
  `); document.documentElement.appendChild(editor);
  const edText = editor.querySelector('textarea');
  const edDots = [...editor.querySelectorAll('.uw-color')];
  const edPicker = editor.querySelector('.uw-picker');
  const edCustoms = editor.querySelector('.uw-editor-customs');
  const edCancel = editor.querySelector('.cancel');
  const edSave   = editor.querySelector('.save');
  let edColor='yellow', edHex=null, pendingRange=null, pendingAnchor=null;

  editor.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); edCancel.click(); }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); edSave.click(); }
  });

  const pop = div('uw-pop',`
    <div class="uw-toolbar">
      <button class="uw-tool uw-edit">✎ Edit</button>
      <button class="uw-tool uw-del">🗑 Delete</button>
      <button class="uw-pin" title="Pin/unpin">📌 Pin</button>
      <button class="uw-tool uw-close" title="Close">✖</button>
      <div class="uw-colors">
        ${colors().map(c=>dot(c)).join('')}
        <input class="uw-picker" type="color" title="Custom color">
        <div class="uw-customs uw-pop-customs"></div>
      </div>
    </div>
    <div class="uw-content"></div>
  `); document.documentElement.appendChild(pop);
  const popContent = pop.querySelector('.uw-content');
  const popEdit = pop.querySelector('.uw-edit');
  const popDel  = pop.querySelector('.uw-del');
  const popClose= pop.querySelector('.uw-close');
  const popDots = [...pop.querySelectorAll('.uw-color')];
  const popPicker = pop.querySelector('.uw-picker');
  const popCustoms = pop.querySelector('.uw-pop-customs');
  const popPin  = pop.querySelector('.uw-pin');
  let popSpan = null, isPinned = false, hideTimer = null;

  // render saved custom swatches in both places
  function renderCustoms(){
    const sw = loadSwatches();
    const mk = hex => `<span class="uw-color uw-custom" data-hex="${hex}" title="${hex}  (right-click OR Alt-click to remove)" style="background:${hex};"></span>`;
    edCustoms.innerHTML  = sw.map(mk).join('');
    popCustoms.innerHTML = sw.map(mk).join('');
  }
  renderCustoms();

  function bindCustomClicks(scope){
    scope.querySelectorAll('.uw-custom').forEach(el=>{
      // left-click → pick  (unless Alt is held, then delete)
      el.addEventListener('click', (e)=>{
        const hex = e.currentTarget.getAttribute('data-hex');
        if (!hex) return;
        if (e.altKey) {
          // Alt-click delete with double confirm
          if (!confirm(`Remove saved color ${hex}?`)) return;
          if (!confirm('Are you absolutely sure? This cannot be undone.')) return;
          removeSwatch(hex);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (scope === editor){
          edHex = hex; edColor='custom'; edPicker.value = hex;
          edDots.forEach(x=>x.classList.remove('active'));
        } else {
          if (!popSpan) return;
          applyColor(popSpan, hex);
          popDots.forEach(x=>x.classList.remove('active'));
          const rec = getRecForSpan(popSpan);
          if (rec) updateByUid(rec.uid, r => ({...r, color:hex}));
        }
      }, {capture:true});

      // RIGHT-CLICK → remove swatch (double confirm) with capture to beat site handlers
      el.addEventListener('contextmenu', (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        const hex = ev.currentTarget.getAttribute('data-hex');
        if (!hex) return;
        if (!confirm(`Remove saved color ${hex}?`)) return;
        if (!confirm('Are you absolutely sure? This cannot be undone.')) return;
        removeSwatch(hex);
      }, {capture:true});
    });
  }
  bindCustomClicks(editor);
  bindCustomClicks(pop);

  // ---------- Selection pill ----------
  document.addEventListener('selectionchange', () => {
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return hide(pill);
    const r = sel.getRangeAt(0);
    const node = (r.startContainer.nodeType===1 ? r.startContainer : r.startContainer.parentElement);
    if (node && node.closest('input, textarea, [contenteditable="true"], .uw-annot')) return hide(pill);
    const rect = r.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return hide(pill);
    showAt(pill, rect.right + window.scrollX + 8, rect.top + window.scrollY - 8);
  });
  document.addEventListener('mousedown', e => { if (!pill.contains(e.target) && !editor.contains(e.target) && !pop.contains(e.target)) hide(pill); }, true);
  pillBtn.addEventListener('click', e => { e.preventDefault(); openEditorFromSelection(); });

  // ---------- Editor actions ----------
  edDots.forEach(s=>s.addEventListener('click',()=>{
    edColor=s.dataset.c; edHex=null;
    edDots.forEach(x=>x.classList.toggle('active', x===s));
  }));
  edPicker.addEventListener('input', ()=>{
    edHex = edPicker.value; edColor='custom';
    edDots.forEach(x=>x.classList.remove('active'));
    addSwatch(edHex);
    renderCustoms(); bindCustomClicks(editor); bindCustomClicks(pop);
  });
  edCancel.addEventListener('click', ()=>{ hide(editor); });
  edSave.onclick = saveNew;

  function openEditorFromSelection(){
    const sel=getSelection(); if (!sel || sel.rangeCount===0) return;
    const r=sel.getRangeAt(0); if (r.collapsed) return;
    pendingRange = r.cloneRange();
    pendingAnchor = rangeToAnchor(pendingRange);
    edText.value='';
    edColor='yellow'; edHex=null; edPicker.value='#ffe600';
    edDots.forEach(x=>x.classList.toggle('active', x.dataset.c===edColor));
    const rc=r.getBoundingClientRect(); showAt(editor, rc.left+window.scrollX, rc.bottom+window.scrollY+10); edText.focus();
  }

  function saveNew(){
    if (!pendingRange || !pendingAnchor) return hide(editor);
    const colorVal = edHex ? edHex : edColor;
    const rec = {
      uid: uid(),
      noteMd: edText.value || '',
      color: colorVal, ts: Date.now(),
      startXPath: pendingAnchor.startXPath, startOffset: pendingAnchor.startOffset,
      endXPath: pendingAnchor.endXPath,     endOffset: pendingAnchor.endOffset,
      exact: pendingRange.toString()
    };
    const arr=load(); arr.push(rec); save(arr);
    if (colorVal.startsWith && colorVal.startsWith('#')) addSwatch(colorVal);
    wrapRange(pendingRange, rec);
    hide(editor); hide(pill);
    const sel=getSelection(); sel && sel.removeAllRanges();
    pendingRange=null; pendingAnchor=null;
  }

  // ---------- Popover (sticky + pin) ----------
  function showPopoverFor(span){
    popSpan = span;
    const cur = span.getAttribute('data-color');
    const hex = span.getAttribute('data-hex');
    popDots.forEach(c=>c.classList.toggle('active', c.dataset.c===cur));
    popPicker.value = hex ? hex : guessHexFromName(cur);
    popContent.innerHTML = mdToHtml(span.getAttribute('data-md') || '');
    const rect = span.getBoundingClientRect();
    showAt(pop, rect.left + window.scrollX, rect.bottom + window.scrollY + 6);
  }
  function clearHideTimer(){ if (hideTimer) { clearTimeout(hideTimer); hideTimer=null; } }
  function maybeHide(){
    if (isPinned) return;
    if (!pop.matches(':hover') && !(popSpan && popSpan.matches(':hover'))) hide(pop);
  }
  document.addEventListener('mouseover', (e) => {
    const span = e.target.closest('.uw-annot'); if (!span) return;
    clearHideTimer(); showPopoverFor(span);
  }, true);
  document.addEventListener('mouseout', (e) => {
    if (!e.target.closest('.uw-annot') || isPinned) return;
    clearHideTimer(); hideTimer = setTimeout(maybeHide, 220);
  }, true);
  pop.addEventListener('mouseenter', clearHideTimer);
  pop.addEventListener('mouseleave', () => { if (!isPinned) maybeHide(); });
  popPin.addEventListener('click', () => {
    isPinned = !isPinned;
    popPin.classList.toggle('active', isPinned);
    if (!isPinned) maybeHide();
  });
  popClose.addEventListener('click', () => { isPinned=false; popPin.classList.remove('active'); hide(pop); });

  // EDIT — close popover, then show editor
  popEdit.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!popSpan) return;
    const rec = getRecForSpan(popSpan); if (!rec) return;
    isPinned = false; popPin.classList.remove('active'); hide(pop);

    edText.value = rec.noteMd || '';
    if (rec.color && rec.color.startsWith('#')) { edHex = rec.color; edColor='custom'; edPicker.value=rec.color; addSwatch(rec.color); renderCustoms(); bindCustomClicks(editor); bindCustomClicks(pop); }
    else { edHex=null; edColor=rec.color||'yellow'; edPicker.value=guessHexFromName(edColor); }
    edDots.forEach(x => x.classList.toggle('active', x.dataset.c === edColor));

    const rect = popSpan.getBoundingClientRect();
    showAt(editor, rect.left + window.scrollX, rect.bottom + window.scrollY + 10);
    edText.focus();

    edSave.onclick = () => {
      const newColor = edHex ? edHex : edColor;
      const updated = updateByUid(rec.uid, r => ({...r, noteMd: edText.value || '', color: newColor}));
      if (updated){
        const span = document.querySelector(`.uw-annot[data-uid="${rec.uid}"]`);
        if (span){ applyColor(span, updated.color); span.setAttribute('data-md', updated.noteMd); }
      }
      if (newColor.startsWith && newColor.startsWith('#')) { addSwatch(newColor); renderCustoms(); bindCustomClicks(editor); bindCustomClicks(pop); }
      edSave.onclick = saveNew; hide(editor);
    };
  });

  // DELETE
  popDel.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!popSpan) return;
    const uidVal = popSpan.getAttribute('data-uid');
    let removed = false;
    if (uidVal) removed = deleteByUid(uidVal);
    if (!removed) {
      const a = spanAnchorFromDataset(popSpan);
      if (a) removed = deleteByAnchor(a);
    }
    const span = popSpan, parent = span.parentNode;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    hide(pop);
    setTimeout(hydrateOnce, 20);
  });

  // Swatches in popover
  popDots.forEach(s=>s.addEventListener('click',(e)=>{
    e.stopPropagation();
    if (!popSpan) return;
    const c = s.dataset.c; popDots.forEach(x=>x.classList.toggle('active', x===s));
    applyColor(popSpan, c);
    const rec = getRecForSpan(popSpan);
    if (rec) updateByUid(rec.uid, r => ({...r, color:c}));
  }));
  popPicker.addEventListener('input', (e)=>{
    if (!popSpan) return;
    const hex = e.target.value; applyColor(popSpan, hex);
    popDots.forEach(x=>x.classList.remove('active'));
    const rec = getRecForSpan(popSpan);
    if (rec) updateByUid(rec.uid, r => ({...r, color:hex}));
    addSwatch(hex); renderCustoms(); bindCustomClicks(editor); bindCustomClicks(pop);
  });

  // ---------- HELPERS ----------
  function div(cls, html){ const d=document.createElement('div'); d.className=cls; d.innerHTML=html; return d; }
  function colors(){ return ['yellow','green','blue','pink','orange']; }
  function dot(c){ return `<span class="uw-color" data-c="${c}" title="${c}"></span>`; }
  function showAt(node,x,y){ node.style.left=Math.round(x)+'px'; node.style.top=Math.round(y)+'px'; node.style.display='block'; }
  function hide(node){ node.style.display='none'; }
  function uid(){ return 'u' + Math.random().toString(36).slice(2) + Date.now().toString(36); }

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
    return { startXPath:getXPath(r.startContainer), startOffset:r.startOffset,
             endXPath:getXPath(r.endContainer),     endOffset:r.endOffset };
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
  function spanAnchorFromDataset(span){
    const sx = span.getAttribute('data-sx'), so = span.getAttribute('data-so'),
          ex = span.getAttribute('data-ex'), eo = span.getAttribute('data-eo');
    if (!sx || !ex || so==null || eo==null) return null;
    return { startXPath:sx, startOffset:+so, endXPath:ex, endOffset:+eo };
  }

  function wrapRange(range, rec){
    if (document.querySelector(`.uw-annot[data-uid="${rec.uid}"]`)) return;
    if (range.commonAncestorContainer &&
        range.commonAncestorContainer.parentElement &&
        range.commonAncestorContainer.parentElement.closest &&
        range.commonAncestorContainer.parentElement.closest('.uw-annot')) return;

    const span = document.createElement('span');
    span.className = 'uw-annot';
    span.setAttribute('data-uid', rec.uid);
    span.setAttribute('data-md',  rec.noteMd || '');
    span.setAttribute('data-sx', rec.startXPath);
    span.setAttribute('data-so', rec.startOffset);
    span.setAttribute('data-ex', rec.endXPath);
    span.setAttribute('data-eo', rec.endOffset);
    applyColor(span, rec.color || 'yellow');
    try { range.surroundContents(span); }
    catch {
      const tmp = document.createElement('span');
      tmp.textContent = range.toString();
      span.appendChild(tmp);
      range.deleteContents();
      range.insertNode(span);
    }
  }

  function applyColor(span, color){
    if (color && color.startsWith && color.startsWith('#')){
      span.setAttribute('data-color', 'custom');
      span.setAttribute('data-hex', normalizeHex(color));
      span.style.background = hexToRgba(color, 0.6);
    } else {
      span.setAttribute('data-color', color || 'yellow');
      span.removeAttribute('data-hex');
      span.style.background = '';
    }
  }
  function hexToRgba(hex, a){
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalizeHex(hex));
    if (!m) return hex;
    const r = parseInt(m[1],16), g = parseInt(m[2],16), b = parseInt(m[3],16);
    return `rgba(${r},${g},${b},${a==null?0.6:a})`;
  }
  function normalizeHex(h){ if (!h) return null; h = h.trim(); if (!h.startsWith('#')) h = '#'+h; if (/^#([a-f0-9]{3})$/i.test(h)) h = '#'+h.slice(1).split('').map(c=>c+c).join(''); return /^#[a-f0-9]{6}$/i.test(h)?h:null; }
  function guessHexFromName(name){
    switch(name){
      case 'yellow': return '#ffe600';
      case 'green':  return '#80e680';
      case 'blue':   return '#8abaff';
      case 'pink':   return '#ff8ad2';
      case 'orange': return '#ffc266';
      default: return '#ffe600';
    }
  }
  function getRecForSpan(span){
    const uidVal = span.getAttribute('data-uid');
    if (uidVal){
      const r = load().find(x => x.uid === uidVal);
      if (r) return r;
    }
    const a = spanAnchorFromDataset(span);
    if (a){
      const r = load().find(x =>
        x.startXPath===a.startXPath && x.startOffset===a.startOffset &&
        x.endXPath===a.endXPath && x.endOffset===a.endOffset
      );
      if (r) return r;
    }
    return null;
  }

  // ---------- HYDRATE / OBSERVE ----------
  function hydrateOnce(){
    const arr = load();
    for (const r of arr) {
      if (document.querySelector(`.uw-annot[data-uid="${r.uid}"]`)) continue;
      const range = anchorToRange(r);
      if (range) { try { wrapRange(range, r); } catch {} }
    }
  }
  const mo = new MutationObserver(()=>{ clearTimeout(mo._t); mo._t = setTimeout(hydrateOnce, 400); });
  mo.observe(document.documentElement, { childList:true, subtree:true });

  // ---------- MENU ----------
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Add highlight from selection', ()=>{
      const sel=getSelection(); if (!sel || sel.rangeCount===0) return;
      const r=sel.getRangeAt(0); if (r.collapsed) return;
      pendingRange = r.cloneRange(); pendingAnchor = rangeToAnchor(pendingRange);
      edText.value=''; edColor='yellow'; edHex=null; edPicker.value='#ffe600';
      edDots.forEach(x=>x.classList.toggle('active', x.dataset.c===edColor));
      const rc=r.getBoundingClientRect(); showAt(editor, rc.left+window.scrollX, rc.bottom+window.scrollY+10); edText.focus();
    });
    GM_registerMenuCommand('List annotations', ()=>{
      const arr = load(); if (!arr.length) return alert('No annotations for this page.');
      alert(arr.map(a=>`${a.uid}  [${a.color}]  ${a.exact?.slice(0,60)||'(xpath)'} …`).join('\n'));
    });
  }

  // ---------- BOOT ----------
  hydrateOnce();
  setTimeout(hydrateOnce, 1000);
})();
