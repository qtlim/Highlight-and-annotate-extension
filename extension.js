// ==UserScript==
// @name         Web Annotator Improved
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Highlight and annotate text with persistent storage
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// ==/UserScript==

(function() {
  'use strict';

  //-------------------------------------------------------
  // Storage helpers
  //-------------------------------------------------------
  function saveAnnotations(annos){
    GM_setValue("annotations", JSON.stringify(annos));
  }
  function loadAnnotations(){
    try { return JSON.parse(GM_getValue("annotations","[]")); }
    catch(e){ return []; }
  }

  //-------------------------------------------------------
  // UI elements
  //-------------------------------------------------------
  const pill = document.createElement("div");
  pill.textContent = "✎ Annotate";
  Object.assign(pill.style, {
    position:"absolute", background:"#333", color:"#fff", padding:"4px 6px",
    borderRadius:"4px", fontSize:"12px", cursor:"pointer", display:"none", zIndex:999999
  });
  document.body.appendChild(pill);

  //-------------------------------------------------------
  // Editor popup
  //-------------------------------------------------------
  function openEditor(range, existing){
    const noteBox = document.createElement("div");
    noteBox.className = "uw-editor";
    Object.assign(noteBox.style, {
      position:"fixed", top:"20%", left:"50%", transform:"translateX(-50%)",
      background:"#fff", border:"1px solid #aaa", padding:"10px", zIndex:999999,
      width:"400px", boxShadow:"0 2px 6px rgba(0,0,0,0.2)"
    });

    noteBox.innerHTML = `
      <div><b>Enter note (Markdown supported)</b></div>
      <textarea style="width:100%;height:120px;">${existing?.text||""}</textarea>
      <div style="margin-top:6px;">Color:
        <input type="color" value="${existing?.color||"#ffff00"}">
      </div>
      <div style="margin-top:8px; text-align:right;">
        <button class="uw-cancel">Cancel</button>
        <button class="uw-save">Save</button>
      </div>
    `;
    document.body.appendChild(noteBox);

    noteBox.querySelector(".uw-cancel").onclick = ()=>noteBox.remove();
    noteBox.querySelector(".uw-save").onclick = ()=>{
      const txt = noteBox.querySelector("textarea").value;
      const col = noteBox.querySelector("input").value;
      if(existing){
        existing.text = txt; existing.color = col;
      } else {
        wrapAndStore(range, txt, col);
      }
      saveAnnotations(allAnnotations);
      location.reload();
    };
  }

  //-------------------------------------------------------
  // Wrapping & rendering
  //-------------------------------------------------------
  let allAnnotations = loadAnnotations();

  function wrapAndStore(range, text, color){
    const span = document.createElement("mark");
    span.className="uw-annot";
    span.style.background=color;
    span.dataset.note=text;
    span.dataset.color=color;

    range.surroundContents(span);
    allAnnotations.push({
      xpath: getXPath(span),
      text, color
    });
  }

  function renderAnnotations(){
    allAnnotations.forEach(a=>{
      const node = getNodeByXPath(a.xpath);
      if(node){
        node.className="uw-annot";
        node.style.background=a.color;
        node.dataset.note=a.text;
        node.dataset.color=a.color;
        node.onmouseenter = ()=>{
          showNotePopup(node);
        };
        node.onmouseleave = ()=>hideNotePopup();
      }
    });
  }

  //-------------------------------------------------------
  // Note popup on hover
  //-------------------------------------------------------
  const notePopup = document.createElement("div");
  Object.assign(notePopup.style, {
    position:"absolute", background:"#fff", border:"1px solid #aaa", padding:"6px",
    borderRadius:"4px", boxShadow:"0 2px 6px rgba(0,0,0,0.2)", display:"none", zIndex:999999
  });
  document.body.appendChild(notePopup);

  function showNotePopup(node){
    notePopup.textContent=node.dataset.note;
    notePopup.style.left=(node.getBoundingClientRect().left+window.scrollX)+"px";
    notePopup.style.top=(node.getBoundingClientRect().bottom+window.scrollY+4)+"px";
    notePopup.style.display="block";
  }
  function hideNotePopup(){ notePopup.style.display="none"; }

  //-------------------------------------------------------
  // Selection pill logic
  //-------------------------------------------------------
  function updatePillFromSelection(){
    const sel = getSelection();
    if (!sel || sel.rangeCount===0 || sel.isCollapsed) { pill.style.display="none"; return; }

    const r = sel.getRangeAt(0);
    const node = (r.startContainer.nodeType===1 ? r.startContainer : r.startContainer.parentElement);
    if(node && node.closest('input,textarea,.uw-annot')){ pill.style.display="none"; return; }

    const rect = r.getBoundingClientRect();
    if(!rect || (rect.width===0 && rect.height===0)){ pill.style.display="none"; return; }

    pill.style.left=(rect.right+window.scrollX+8)+"px";
    pill.style.top=(rect.top+window.scrollY-8)+"px";
    pill.style.display="block";
  }

  document.addEventListener("mouseup", ()=>setTimeout(updatePillFromSelection,50));
  pill.onclick = ()=>{
    const sel = getSelection();
    if(sel && sel.rangeCount>0) openEditor(sel.getRangeAt(0));
    pill.style.display="none";
  };

  // Keyboard fallback Ctrl+Alt+A
  document.addEventListener("keydown", (e)=>{
    if((e.ctrlKey||e.metaKey)&&e.altKey&&e.key.toLowerCase()==="a"){
      const sel=getSelection();
      if(sel && sel.rangeCount>0 && !sel.isCollapsed){
        e.preventDefault();
        openEditor(sel.getRangeAt(0));
      }
    }
  });

  //-------------------------------------------------------
  // XPath helpers
  //-------------------------------------------------------
  function getXPath(el){
    if(el.id) return '//*[@id="'+el.id+'"]';
    const idx = (sib, name) => sib
      ? idx(sib.previousElementSibling, name||sib.localName)+ (sib.localName==name?1:0)
      : 1;
    const segs=[];
    for(;el && el.nodeType==1;el=el.parentNode){
      let i=idx(el.previousElementSibling, el.localName);
      segs.unshift(el.localName+'['+i+']');
    }
    return segs.length ? '/'+segs.join('/') : null;
  }
  function getNodeByXPath(path){
    try { return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; }
    catch(e){ return null; }
  }

  //-------------------------------------------------------
  // CSS tweaks
  //-------------------------------------------------------
  const style=document.createElement("style");
  style.textContent=`
    .uw-editor textarea{ font-family:monospace; }
    .uw-editor pre, .uw-editor p { margin:6px 0; }
    .uw-editor ul{ margin:0; padding-left:20px; }
    .uw-editor ul li{ margin:2px 0; }

    /* spacing: add margin *after* lists, not before */
    .uw-pop ul{ margin-bottom:0.5em; }
    .uw-pop p{ margin:0.5em 0; }
  `;
  document.head.appendChild(style);

  //-------------------------------------------------------
  // Init
  //-------------------------------------------------------
  renderAnnotations();

})();
