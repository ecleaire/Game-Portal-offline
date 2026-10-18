// Launcher-only compatibility for the system WebKit shipped with older Macs.
if(!String.prototype.replaceAll)String.prototype.replaceAll=function(search,replacement){if(typeof search!=='string')return this.replace(search,replacement);return this.split(search).join(replacement);};
if(!Array.prototype.at)Array.prototype.at=function(index){index=Math.trunc(index)||0;return this[index<0?this.length+index:index];};
if(!Array.prototype.flat)Array.prototype.flat=function(depth=1){return depth>0?this.reduce((out,item)=>out.concat(Array.isArray(item)?item.flat(depth-1):item),[]):this.slice();};
if(!Array.prototype.flatMap)Array.prototype.flatMap=function(fn,thisArg){return this.map(fn,thisArg).flat();};
if(!Object.fromEntries)Object.fromEntries=entries=>{const out={};for(const [key,value]of entries)Object.defineProperty(out,key,{value,enumerable:true,writable:true,configurable:true});return out;};
if(!Promise.allSettled)Promise.allSettled=items=>Promise.all(Array.from(items,item=>Promise.resolve(item).then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}))));
if(!Object.hasOwn)Object.hasOwn=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
if(!String.prototype.matchAll)String.prototype.matchAll=function(pattern){const expression=new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g'),text=String(this);return {[Symbol.iterator](){return this;},next(){const value=expression.exec(text);if(value&&value[0]==='')expression.lastIndex++;return {value,done:!value};}};};
if(!('reason' in AbortSignal.prototype)){const abort=AbortController.prototype.abort;AbortController.prototype.abort=function(reason){if(!this.signal.aborted)Object.defineProperty(this.signal,'reason',{value:reason===undefined?new DOMException('操作を中止しました。','AbortError'):reason});return abort.call(this);};}
if(!AbortSignal.prototype.throwIfAborted)AbortSignal.prototype.throwIfAborted=function(){if(this.aborted)throw this.reason;};
if(!crypto.randomUUID)crypto.randomUUID=()=>{const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=bytes[6]&15|64;bytes[8]=bytes[8]&63|128;const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);};
if(!Blob.prototype.arrayBuffer)Blob.prototype.arrayBuffer=function(){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(this);});};
if(!Blob.prototype.text)Blob.prototype.text=function(){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsText(this);});};
if(!window.ResizeObserver)window.ResizeObserver=class{constructor(callback){this.callback=callback;this.listener=()=>{if(this.target)this.callback([{contentRect:this.target.getBoundingClientRect(),target:this.target}]);};}observe(target){this.target=target;window.addEventListener('resize',this.listener);this.listener();}disconnect(){window.removeEventListener('resize',this.listener);this.target=null;}};
if(!document.createElement('dialog').showModal){
  document.documentElement.classList.add('mac-dialog-polyfill');
  for(const dialog of document.querySelectorAll('dialog')){
    Object.defineProperty(dialog,'open',{get(){return this.hasAttribute('open');}});
    dialog.showModal=function(){if(this.open)throw new DOMException('すでに開いています。','InvalidStateError');this.setAttribute('open','');this.setAttribute('aria-modal','true');this.setAttribute('role','dialog');this._previousFocus=document.activeElement;this.appendChild(document.createTextNode(''));const first=this.querySelector('button,input,select,textarea,[tabindex]');if(first)first.focus();};
    dialog.close=function(){if(!this.open)return;this.removeAttribute('open');this.removeAttribute('aria-modal');this.dispatchEvent(new Event('close'));if(this._previousFocus)this._previousFocus.focus();};
  }
  document.addEventListener('keydown',event=>{const dialogs=Array.from(document.querySelectorAll('dialog[open]')),dialog=dialogs[dialogs.length-1];if(!dialog)return;if(event.key==='Escape'){const cancel=new Event('cancel',{cancelable:true});if(dialog.dispatchEvent(cancel))dialog.close();event.preventDefault();}if(event.key==='Tab'){const nodes=Array.from(dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')).filter(node=>!node.disabled&&node.tabIndex>=0&&node.getClientRects().length);if(!nodes.length){event.preventDefault();return;}const index=nodes.indexOf(document.activeElement),next=event.shiftKey?(index<=0?nodes.length-1:index-1):(index+1)%nodes.length;nodes[next].focus();event.preventDefault();}});
}
