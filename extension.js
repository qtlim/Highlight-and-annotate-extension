// ==UserScript==
// @name         Simple Persistent Web Highlighter + Notes (hover tooltip)
// @namespace    qt-highlighter
// @version      1.0.2
// @description  Highlight selected text, attach a note that shows on hover, persist per-page via localStorage. Shift+Click a highlight to edit/delete. Export/Import hotkeys.
// @author       you
// @match        *://*/*
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  // ========= Config =========
  const ADD_HOTKEY = { altKey: true, key: 'h' };       // Alt+H to add a note to selection
  const LIST_HOTKEY = { ctrlKey: true, altKey: true, key: 'l' }; // Ctrl+Alt+L list notes
  const EXPORT_HOTKEY = { ctrlKey: true, altKey: true, key: 'e' }; // Ctrl+Alt+E export JSON
  const IMPORT_HOTKEY = { ctrlKey: true, altKey: true, key: 'i' }; // Ctrl+Alt+I import JSON
  const PREFIX_LEN = 32;  // context length saved before selection
  const SUFFIX_LEN = 32;  // context length saved after selection

  GM_addStyle(`
    .uw-annot {
      background-color: rgba(255, 230, 0, 0.65);
      padding: 0 1px;
      border-bottom: 1px dotted rgba(0,0,0,0.4);
      cursor: help;
    }
    .uw-annot:hover {
      outline: 1px solid rgba(255, 200, 0, 0.9);
    }
  `);

  const pageKey = () => {
    // Persist per page path (ignore search/hash to be more stable)
    return 'uw_annots::' + location.origin + location.pathname;
  };

  function loadAnnots() {
    try {
      const raw = localStorage.getItem(pageKey());
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
  function saveAnnots(list) {
    localStorage.setItem(pageKey(), JSON.stringify(list));
  }

  function getSelectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;

    // Extract exact text
    const exact = range.toString();
    if (!exact.trim()) return null;

    // Build prefix/suffix from text around the range, capped by config
    const preText = textBeforeRange(range, PREFIX_LEN);
    const postText = textAfterRange(range, SUFFIX_LEN);

    return { exact, prefix: preText, suffix: postText };
  }

  function textBeforeRange(range, maxLen) {
    // Clone range, expand backward across text nodes
    const r = range.cloneRange();
    r.collapse(true);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let acc = '';
    let lastNode = null;
    // Walk to the start container
    walker.currentNode = document.body;
    // Collect text before start
    function collect(node) {
      if (!node || node.nodeType !== Node.TEXT_NODE || !node.nodeValue) return '';
      return node.nodeValue;
    }
    // Walk through the DOM accumulating until we hit the start
    // Simpler approach: get full text up to start by traversing parents
    // For performance, we use range.startContainer and slice within it
    try {
      const preRange = range.cloneRange();
      preRange.setStart(document.body, 0);
      const str = preRange.toString();
      acc = str.slice(-maxLen);
    } catch {
      acc = '';
    }
    return acc;
  }

  function textAfterRange(range, maxLen) {
    try {
      const postRange = range.cloneRange();
      postRange.setEndAfter(document.body.lastChild || document.body);
      const str = postRange.toString();
      return str.slice(0, maxLen);
    } catch {
      return '';
    }
  }

  // Find a range in the current DOM by (exact, prefix, suffix) (TextQuoteSelector-like)
  function findRangeBySelector(exact, prefix, suffix) {
    const matches = findAllTextMatches(exact);
    for (const m of matches) {
      // Check context
      const preOk = prefix
        ? endsWithSafe(getContextBefore(m.node, m.startOffset, PREFIX_LEN), prefix)
        : true;
      const sufOk = suffix
        ? startsWithSafe(getContextAfter(m.node, m.startOffset + exact.length, SUFFIX_LEN), suffix)
        : true;
      if (preOk && sufOk) {
        const r = document.createRange();
        r.setStart(m.node, m.startOffset);
        r.setEnd(m.node, m.startOffset + exact.length);
        return r;
      }
    }
    return null;
  }

  function endsWithSafe(big, small) {
    if (small.length === 0) return true;
    return big.endsWith(small);
  }
  function startsWithSafe(big, small) {
    if (small.length === 0) return true;
    return big.startsWith(small);
  }

  function getContextBefore(node, offset, len) {
    // Gather text walking backwards across text nodes
    let acc = '';
    let curNode = node;
    let curOffset = offset;
    while (acc.length < len && curNode) {
      if (curNode.nodeType === Node.TEXT_NODE) {
        const take = curNode.nodeValue.slice(0, curOffset);
        acc = take.slice(-Math.max(0, len - acc.length)) + acc;
      }
      // Move to previous text node
      const prev = previousTextNode(curNode);
      curNode = prev;
      curOffset = prev ? prev.nodeValue.length : 0;
    }
    return acc.slice(-len);
  }

  function getContextAfter(node, offset, len) {
    // Gather text walking forwards across text nodes
    let acc = '';
    let curNode = node;
    let curOffset = offset;
    while (acc.length < len && curNode) {
      if (curNode.nodeType === Node.TEXT_NODE) {
        const take = curNode.nodeValue.slice(curOffset);
        acc += take.slice(0, Math.max(0, len - acc.length));
      }
      const next = nextTextNode(curNode);
      curNode = next;
      curOffset = 0;
    }
    return acc.slice(0, len);
  }

  function previousTextNode(node) {
    let n = node;
    while (n && !n.previousSibling) n = n.parentNode;
    if (!n) return null;
    n = n.previousSibling;
    while (n && n.lastChild) n = n.lastChild;
    return n && n.nodeType === Node.TEXT_NODE ? n : findPrevTextDeep(n);
  }
  function findPrevTextDeep(n) {
    if (!n) return null;
    if (n.nodeType === Node.TEXT_NODE) return n;
    let cur = n;
    while (cur && cur.lastChild) cur = cur.lastChild;
    return cur && cur.nodeType === Node.TEXT_NODE ? cur : null;
  }

  function nextTextNode(node) {
    let n = node;
    while (n && !n.nextSibling) n = n.parentNode;
    if (!n) return null;
    n = n.nextSibling;
    while (n && n.firstChild) n = n.firstChild;
    return n && n.nodeType === Node.TEXT_NODE ? n : findNextTextDeep(n);
  }
  function findNextTextDeep(n) {
    if (!n) return null;
    if (n.nodeType === Node.TEXT_NODE) return n;
    let cur = n;
    while (cur && cur.firstChild) cur = cur.firstChild;
    return cur && cur.nodeType === Node.TEXT_NODE ? cur : null;
  }

  function findAllTextMatches(exact) {
    const matches = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node = walker.nextNode();
    while (node) {
      const text = node.nodeValue;
      let idx = 0;
      while (true) {
        idx = text.indexOf(exact, idx);
        if (idx === -1) break;
        matches.push({ node, startOffset: idx });
        idx += exact.length;
      }
      node = walker.nextNode();
    }
    return matches;
  }

  function wrapRange(range, note) {
    const span = document.createElement('span');
    span.className = 'uw-annot';
    span.setAttribute('data-note', note || '');
    span.title = note || '';
    range.surroundContents(span);
    // Click handlers for edit/delete
    span.addEventListener('click', (e) => {
      if (!e.shiftKey) return; // only on Shift+Click
      e.preventDefault();
      e.stopPropagation();
      const newNote = prompt('Edit note (leave empty to delete):', span.getAttribute('data-note') || '');
      if (newNote === null) return; // cancelled
      if (newNote === '') {
        // delete highlight
        const parent = span.parentNode;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        // Also remove from store
        removeStoredAnnotation(span);
      } else {
        span.setAttribute('data-note', newNote);
        span.title = newNote;
        // Update store by re-creating selector from current text
        updateStoredAnnotation(span, newNote);
      }
    }, { capture: true });
  }

  function addAnnotationFromSelection() {
    const info = getSelectionInfo();
    if (!info) return alert('Select some text first.');
    const note = prompt('Enter note for this highlight:');
    if (note === null) return; // cancelled

    const sel = window.getSelection();
    const range = sel.getRangeAt(0);

    // Store
    const annots = loadAnnots();
    const record = {
      exact: info.exact,
      prefix: info.prefix,
      suffix: info.suffix,
      note: note || '',
      ts: Date.now()
    };
    annots.push(record);
    saveAnnots(annots);

    // Paint
    wrapRange(range, record.note);
    sel.removeAllRanges();
  }

  function hydrateAll() {
    const annots = loadAnnots();
    for (const a of annots) {
      const r = findRangeBySelector(a.exact, a.prefix, a.suffix);
      if (r) {
        try {
          wrapRange(r, a.note);
        } catch {
          // ignore if DOM changed too much
        }
      }
    }
  }

  function removeStoredAnnotation(spanEl) {
    // Try to reconstruct selector from the text content of the span
    const exact = spanEl.textContent || '';
    if (!exact) return;
    const annots = loadAnnots();
    // remove first matching by exact + note as tie-break
    const note = spanEl.getAttribute('data-note') || '';
    const idx = annots.findIndex(a => a.exact === exact && (a.note || '') === note);
    if (idx >= 0) {
      annots.splice(idx, 1);
      saveAnnots(annots);
    }
  }

  function updateStoredAnnotation(spanEl, newNote) {
    const exact = spanEl.textContent || '';
    if (!exact) return;
    const annots = loadAnnots();
    const oldNote = spanEl.getAttribute('data-note') || '';
    // Update first matching by exact + oldNote (fallback to exact only)
    let rec = annots.find(a => a.exact === exact && (a.note || '') === oldNote);
    if (!rec) rec = annots.find(a => a.exact === exact);
    if (rec) {
      rec.note = newNote;
      saveAnnots(annots);
    }
  }

  function listAnnotations() {
    const annots = loadAnnots();
    if (!annots.length) return alert('No annotations on this page.');
    const lines = annots
      .sort((a,b)=>a.ts-b.ts)
      .map((a, i) => `${i+1}. "${a.exact}"\n   → ${a.note || '(no note)'}\n`);
    alert(`Annotations for this page:\n\n${lines.join('\n')}`);
  }

  async function exportAnnotations() {
    const annots = loadAnnots();
    const payload = JSON.stringify({ url: location.origin + location.pathname, annots }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      alert('Exported annotations to clipboard.');
    } catch {
      // Fallback: show in prompt
      prompt('Copy your annotations JSON:', payload);
    }
  }

  async function importAnnotations() {
    const json = prompt('Paste annotations JSON (will merge):');
    if (!json) return;
    try {
      const obj = JSON.parse(json);
      if (!obj || !Array.isArray(obj.annots)) throw new Error('Invalid JSON');
      const existing = loadAnnots();
      const merged = [...existing, ...obj.annots];
      saveAnnots(merged);
      alert(`Imported ${obj.annots.length} annotations. Rehydrating…`);
      hydrateAll();
    } catch (e) {
      alert('Import failed: ' + e.message);
    }
  }

  // Key handlers
  document.addEventListener('keydown', (e) => {
    // Add note
    if (e.altKey === !!ADD_HOTKEY.altKey &&
        !!e.ctrlKey === !!ADD_HOTKEY.ctrlKey &&
        !!e.shiftKey === !!ADD_HOTKEY.shiftKey &&
        e.key.toLowerCase() === ADD_HOTKEY.key) {
      e.preventDefault();
      addAnnotationFromSelection();
    }
    // List
    if (e.altKey === !!LIST_HOTKEY.altKey &&
        !!e.ctrlKey === !!LIST_HOTKEY.ctrlKey &&
        !!e.shiftKey === !!LIST_HOTKEY.shiftKey &&
        e.key.toLowerCase() === LIST_HOTKEY.key) {
      e.preventDefault();
      listAnnotations();
    }
    // Export
    if (e.altKey === !!EXPORT_HOTKEY.altKey &&
        !!e.ctrlKey === !!EXPORT_HOTKEY.ctrlKey &&
        !!e.shiftKey === !!EXPORT_HOTKEY.shiftKey &&
        e.key.toLowerCase() === EXPORT_HOTKEY.key) {
      e.preventDefault();
      exportAnnotations();
    }
    // Import
    if (e.altKey === !!IMPORT_HOTKEY.altKey &&
        !!e.ctrlKey === !!IMPORT_HOTKEY.ctrlKey &&
        !!e.shiftKey === !!IMPORT_HOTKEY.shiftKey &&
        e.key.toLowerCase() === IMPORT_HOTKEY.key) {
      e.preventDefault();
      importAnnotations();
    }
  }, true);

  // Hydrate after DOM ready, and once more after a short delay (helps with late content)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      hydrateAll();
      setTimeout(hydrateAll, 1200);
    });
  } else {
    hydrateAll();
    setTimeout(hydrateAll, 1200);
  }
})();
