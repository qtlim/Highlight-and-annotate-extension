// ==UserScript==
// @name         Persistent Highlighter + Notes (hover) — with Selection Bubble
// @namespace    qt-highlighter
// @version      1.2.0
// @description  Highlight selected text, add a note (shows on hover), persist per page. Hotkey + selection bubble + menu command. Shift+Click highlight to edit/delete.
// @author       you
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  // ======== CONFIG (change here) ========
  // Default hotkey: Ctrl+Alt+Z (more reliable in Firefox than Alt+Z)
  const ADD_HOTKEY = { ctrlKey: true, altKey: true, shiftKey: false, key: 'z' };
  const LIST_HOTKEY = { ctrlKey: true, altKey: true, shiftKey: false, key: 'l' };
  const EXPORT_HOTKEY = { ctrlKey: true, altKey: true, shiftKey: false, key: 'e' };
  const IMPORT_HOTKEY = { ctrlKey: true, altKey: true, shiftKey: false, key: 'i' };
  const PREFIX_LEN = 32;
  const SUFFIX_LEN = 32;

  // ======== Styles ========
  GM_addStyle(`
    .uw-annot {
      background-color: rgba(255, 230, 0, 0.65);
      padding: 0 1px;
      border-bottom: 1px dotted rgba(0,0,0,0.4);
      cursor: help;
    }
    .uw-annot:hover { outline: 1px solid rgba(255,200,0,0.9); }

    .uw-annot-bubble {
      position: absolute;
      z-index: 2147483647;
      font: 12px/1.2 -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;
      background: #111;
      color: #fff;
      border-radius: 6px;
      padding: 6px 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      user-select: none;
      display: none;
    }
    .uw-annot-bubble button {
      all: unset;
      cursor: pointer;
      background: #ffd400;
      color: #111;
      padding: 3px 6px;
      border-radius: 5px;
      font-weight: 600;
      margin-left: 6px;
    }
  `);

  // ======== Early outs: pages where this won’t work well ========
  const url = location.href;
  if (url.startsWith('about:') || url.includes('addons.mozilla.org')) {
    // Tampermonkey doesn’t inject on these pages
    return;
  }

  // ======== Storage helpers ========
  const pageKey = () => 'uw_annots::' + location.origin + location.pathname;
  const load = () => { try { return JSON.parse(localStorage.getItem(pageKey()) || '[]'); } catch { return []; } };
  const save = (arr) => localStorage.setItem(pageKey(), JSON.stringify(arr));

  // ======== Selection helpers ========
  function getSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;

    // Avoid inputs/textarea/contenteditable (still works, but anchoring on reload is unreliable)
    const sc = range.startContainer;
    const el = sc.nodeType === 1 ? sc : sc.parentElement;
    if (el && (el.closest('input, textarea, [contenteditable="true"]'))) return null;

    const exact = range.toString();
    if (!exact.trim()) return null;

    return {
      range,
      exact,
      prefix: getPrefix(range, PREFIX_LEN),
      suffix: getSuffix(range, SUFFIX_LEN),
    };
  }

  function getPrefix(range, len) {
    try {
      const r = range.cloneRange();
      r.setStart(document.body, 0);
      return r.toString().slice(-len);
    } catch { return ''; }
  }
  function getSuffix(range, len) {
    try {
      const r = range.cloneRange();
      r.setEndAfter(document.body.lastChild || document.body);
      return r.toString().slice(0, len);
    } catch { return ''; }
  }

  // ======== Find text matches in DOM ========
  function findAllTextMatches(exact) {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        // Skip script/style/noscript
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_ACCEPT;
        const tag = p.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node = walker.nextNode();
    while (node) {
      let idx = 0;
      const text = node.nodeValue;
      while ((idx = text.indexOf(exact, idx)) !== -1) {
        out.push({ node, start: idx });
        idx += exact.length;
      }
      node = walker.nextNode();
    }
    return out;
  }
  function getContextBefore(node, offset, len) {
    let acc = '';
    let cur = node, off = offset;
    while (acc.length < len && cur) {
      if (cur.nodeType === Node.TEXT_NODE) {
        acc = (cur.nodeValue.slice(0, off) + acc).slice(-len);
      }
      const prev = previousTextNode(cur);
      cur = prev;
      off = prev ? prev.nodeValue.length : 0;
    }
    return acc.slice(-len);
  }
  function getContextAfter(node, offset, len) {
    let acc = '';
    let cur = node, off = offset;
    while (acc.length < len && cur) {
      if (cur.nodeType === Node.TEXT_NODE) {
        acc = (acc + cur.nodeValue.slice(off)).slice(0, len);
      }
      const next = nextTextNode(cur);
      cur = next;
      off = 0;
    }
    return acc.slice(0, len);
  }
  function previousTextNode(n) {
    let x = n;
    while (x && !x.previousSibling) x = x.parentNode;
    if (!x) return null;
    x = x.previousSibling;
    while (x && x.lastChild) x = x.lastChild;
    return x && x.nodeType === Node.TEXT_NODE ? x : null;
  }
  function nextTextNode(n) {
    let x = n;
    while (x && !x.nextSibling) x = x.parentNode;
    if (!x) return null;
    x = x.nextSibling;
    while (x && x.firstChild) x = x.firstChild;
    return x && x.nodeType === Node.TEXT_NODE ? x : null;
  }

  function findRangeBySelector(exact, prefix, suffix) {
    const matches = findAllTextMatches(exact);
    for (const m of matches) {
      const preOK = prefix ? getContextBefore(m.node, m.start, PREFIX_LEN).endsWith(prefix) : true;
      const sufOK = suffix ? getContextAfter(m.node, m.start + exact.length, SUFFIX_LEN).startsWith(suffix) : true;
      if (preOK && sufOK) {
        const r = document.createRange();
        r.setStart(m.node, m.start);
        r.setEnd(m.node, m.start + exact.length);
        return r;
      }
    }
    return null;
  }

  // ======== Wrap + events ========
  function wrapRange(range, note) {
    const span = document.createElement('span');
    span.className = 'uw-annot';
    span.setAttribute('data-note', note || '');
    span.title = note || '';
    range.surroundContents(span);

    span.addEventListener('click', (e) => {
      if (!e.shiftKey) return;
      e.preventDefault(); e.stopPropagation();
      const newNote = prompt('Edit note (empty to delete):', span.getAttribute('data-note') || '');
      if (newNote === null) return;
      if (newNote === '') {
        const parent = span.parentNode;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        removeFromStore(span);
      } else {
        span.setAttribute('data-note', newNote);
        span.title = newNote;
        updateInStore(span, newNote);
      }
    }, { capture: true });
  }

  function addAnnotationFromSelection() {
    const info = getSelectionInfo();
    if (!info) return alert('Select some normal page text first (not a PDF or input).');
    const note = prompt('Enter note for this highlight:');
    if (note === null) return;

    const rec = { exact: info.exact, prefix: info.prefix, suffix: info.suffix, note: note || '', ts: Date.now() };
    const arr = load(); arr.push(rec); save(arr);

    wrapRange(info.range, rec.note);
    const sel = getSelection();
    sel && sel.removeAllRanges();
    hideBubble();
  }

  function hydrateAll() {
    const arr = load();
    for (const a of arr) {
      const r = findRangeBySelector(a.exact, a.prefix, a.suffix);
      if (r) {
        try { wrapRange(r, a.note); } catch {}
      }
    }
  }

  function removeFromStore(span) {
    const exact = span.textContent || '';
    const note = span.getAttribute('data-note') || '';
    const arr = load();
    const i = arr.findIndex(a => a.exact === exact && (a.note || '') === note);
    if (i >= 0) { arr.splice(i, 1); save(arr); }
  }
  function updateInStore(span, newNote) {
    const exact = span.textContent || '';
    const oldNote = span.getAttribute('data-note') || '';
    const arr = load();
    let rec = arr.find(a => a.exact === exact && (a.note || '') === oldNote) || arr.find(a => a.exact === exact);
    if (rec) { rec.note = newNote; save(arr); }
  }

  function listAnnotations() {
    const arr = load();
    if (!arr.length) return alert('No annotations on this page.');
    const lines = arr.sort((a,b)=>a.ts-b.ts)
      .map((a,i)=>`${i+1}. "${a.exact}"\n   → ${a.note || '(no note)'}\n`);
    alert(`Annotations for this page:\n\n${lines.join('\n')}`);
  }
  async function exportAnnotations() {
    const payload = JSON.stringify({ url: location.origin + location.pathname, annots: load() }, null, 2);
    try { await navigator.clipboard.writeText(payload); alert('Exported to clipboard.'); }
    catch { prompt('Copy this JSON:', payload); }
  }
  async function importAnnotations() {
    const json = prompt('Paste annotations JSON (will merge):');
    if (!json) return;
    try {
      const obj = JSON.parse(json);
      if (!obj || !Array.isArray(obj.annots)) throw new Error('Invalid JSON');
      const merged = [...load(), ...obj.annots];
      save(merged);
      alert(`Imported ${obj.annots.length} annotations. Reloading…`);
      hydrateAll();
    } catch (e) { alert('Import failed: ' + e.message); }
  }

  // ======== Selection bubble (click if hotkey fails) ========
  const bubble = document.createElement('div');
  bubble.className = 'uw-annot-bubble';
  bubble.innerHTML = `Annotate<span></span><button>Save</button>`;
  document.documentElement.appendChild(bubble);
  const bubbleBtn = bubble.querySelector('button');

  function showBubbleAt(x, y) {
    bubble.style.left = Math.round(x) + 'px';
    bubble.style.top = Math.round(y) + 'px';
    bubble.style.display = 'block';
  }
  function hideBubble() { bubble.style.display = 'none'; }

  bubbleBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    addAnnotationFromSelection();
  });

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { hideBubble(); return; }
    const r = sel.getRangeAt(0);
    const rects = r.getBoundingClientRect();
    if (!rects || (!rects.width && !rects.height)) { hideBubble(); return; }
    // Place bubble near selection (top-right)
    const x = rects.right + window.scrollX + 8;
    const y = rects.top + window.scrollY - 8;
    showBubbleAt(x, y);
  });

  document.addEventListener('mousedown', (e) => {
    if (!bubble.contains(e.target)) hideBubble();
  }, true);

  // ======== Hotkeys ========
  function matchHotkey(e, spec) {
    return (!!e.ctrlKey === !!spec.ctrlKey) &&
           (!!e.altKey === !!spec.altKey) &&
           (!!e.shiftKey === !!spec.shiftKey) &&
           (e.key && e.key.toLowerCase() === spec.key);
  }

  document.addEventListener('keydown', (e) => {
    if (matchHotkey(e, ADD_HOTKEY)) { e.preventDefault(); addAnnotationFromSelection(); }
    else if (matchHotkey(e, LIST_HOTKEY)) { e.preventDefault(); listAnnotations(); }
    else if (matchHotkey(e, EXPORT_HOTKEY)) { e.preventDefault(); exportAnnotations(); }
    else if (matchHotkey(e, IMPORT_HOTKEY)) { e.preventDefault(); importAnnotations(); }
  }, true);

  // ======== Tampermonkey menu commands (fallback) ========
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Add highlight from selection', addAnnotationFromSelection);
    GM_registerMenuCommand('List annotations', listAnnotations);
    GM_registerMenuCommand('Export annotations', exportAnnotations);
    GM_registerMenuCommand('Import annotations', importAnnotations);
  }

  // ======== Boot ========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { hydrateAll(); setTimeout(hydrateAll, 1200); });
  } else {
    hydrateAll(); setTimeout(hydrateAll, 1200);
  }
})();
