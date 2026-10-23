// Conservative static checks only. This module never runs game code or fetches URLs.
function resolveReference(value,base){
  if(!value||/^(?:data:|blob:|#)/i.test(value))return null;
  if(/^(?:[a-z][\w+.-]*:|\/\/)/i.test(value))return {external:value};
  try{return {path:decodeURIComponent(new URL(value.replaceAll('&amp;','&'),'https://library.invalid/'+base).pathname).replace(/^\//,'')};}catch{return {unverified:'参照URLを解釈できません：'+value};}
}
function decodeLiteral(raw){
  return raw.replace(/\\(?:u([0-9a-f]{4})|x([0-9a-f]{2})|([\s\S]))/gi,(_,u,x,c)=>u||x?String.fromCharCode(parseInt(u||x,16)):({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'}[c]??c));
}
function attributesOf(tag){
  const attrs=new Map();let i=tag.match(/^<[\w:-]+/)?.[0].length||tag.length;
  while(i<tag.length){while(/\s/.test(tag[i]||''))i++;const start=i;while(i<tag.length&&!/[\s=>/]/.test(tag[i]))i++;if(start===i){i++;continue;}const name=tag.slice(start,i).toLowerCase();while(/\s/.test(tag[i]||''))i++;let value='';if(tag[i]==='='){i++;while(/\s/.test(tag[i]||''))i++;const quote=tag[i];if(quote==='"'||quote==="'"){const begin=++i;while(i<tag.length&&tag[i]!==quote)i++;value=tag.slice(begin,i++);}else{const begin=i;while(i<tag.length&&!/[\s>]/.test(tag[i]))i++;value=tag.slice(begin,i);}}attrs.set(name,value);}
  return attrs;
}
function htmlTags(markup){
  const tags=[];let at=0;
  while((at=markup.indexOf('<',at))>=0){if(!/[a-z]/i.test(markup[at+1]||'')){at++;continue;}const start=at++;let quote=null;while(at<markup.length){const c=markup[at++];if(quote){if(c===quote)quote=null;}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}const tag=markup.slice(start,at),name=tag.match(/^<([\w:-]+)/)?.[1].toLowerCase();if(name)tags.push({name,attrs:attributesOf(tag)});}
  return tags;
}
function tokensOf(source){
  const out=[];let i=0;
  while(i<source.length){
    const c=source[i];if(/\s/.test(c)){i++;continue;}
    if(source.startsWith('//',i)){i=source.indexOf('\n',i+2);if(i<0)break;continue;}
    if(source.startsWith('/*',i)){const end=source.indexOf('*/',i+2);if(end<0)break;i=end+2;continue;}
    if(c==='"'||c==="'"||c==='`'){let raw='',closed=false;i++;while(i<source.length){if(source[i]==='\\'&&i+1<source.length){raw+=source.slice(i,i+2);i+=2;}else if(source[i]===c){i++;closed=true;break;}else raw+=source[i++];}out.push({type:'string',value:decodeLiteral(raw),dynamic:!closed||c==='`'&&raw.includes('${')});continue;}
    if(/[\w$]/.test(c)){const start=i++;while(i<source.length&&/[\w$]/.test(source[i]))i++;out.push({type:'word',value:source.slice(start,i)});continue;}
    // Skip a probable regex literal so embedded text is never a dependency call.
    if(c==='/'&&(!out.length||['=','(','[',',',':','return','!','>',';','{'].includes(out.at(-1).value))){i++;let bracket=false;while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i]==='[')bracket=true;if(source[i]===']')bracket=false;if(source[i++]==='/'&&!bracket)break;}while(i<source.length&&/[a-z]/i.test(source[i]))i++;continue;}
    out.push({type:'punct',value:c});i++;
  }
  return out;
}
export function analyzeDependencies(source,path,type,documentEntry=path){
  const required=new Set(),external=new Set(),unverified=new Set(),workerEntries=new Set();
  const add=(value,base=path)=>{const ref=resolveReference(value,base);if(ref?.path)required.add(ref.path);if(ref?.external)external.add(ref.external);if(ref?.unverified)unverified.add(ref.unverified);};
  const css=text=>{
    const clean=text.replace(/\/\*[\s\S]*?\*\//g,'');
    for(const m of clean.matchAll(/\burl\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s)'"]+))\s*\)/gi))add(decodeLiteral(m[1]??m[2]??m[3]));
    for(const m of clean.matchAll(/@import\s+(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/gi))add(decodeLiteral(m[1]??m[2]));
    if(/\b(?:var|image-set)\s*\(/i.test(clean))unverified.add('動的なCSS画像・変数は実行時の確認が必要です。');
  };
  const js=(text,base=path)=>{
    const t=tokensOf(text),v=i=>t[i]?.value;
    const addImport=value=>{if(/^(?:\.{1,2}\/|\/|[a-z][\w+.-]*:)/i.test(value))add(value,base);else unverified.add('import map等が必要なモジュール指定は未確認です：'+value);};
    const literal=(i,at,call,worker=false)=>{const token=t[i];if(token?.type==='string'&&!token.dynamic&&[',',')',';'].includes(v(i+1))){if(call==='import'||call==='require')addImport(token.value);else add(token.value,at);if(worker){const ref=resolveReference(token.value,at);if(ref?.path)workerEntries.add(ref.path);}return true;}unverified.add(call+' の動的な参照は静的に確認できません。');return false;};
    for(let i=0;i<t.length;i++){
      if(t[i].type!=='word')continue;const name=v(i);
      const member=v(i-1)==='.',owner=i-(v(i-2)==='?'?3:2);
      const globalMember=member&&['window','self','globalThis'].includes(v(owner))&&v(owner-1)!=='.';
      if(name==='import'||name==='export'){
        // Object methods named import/export are not JavaScript module syntax.
        if(member){if(v(i+1)==='(')unverified.add(name+' のオブジェクト経由の呼び出しは静的に確認できません。');continue;}
        if(name==='import'&&v(i+1)==='.')continue;
        if(name==='import'&&v(i+1)==='('){literal(i+2,base,'import');continue;}
        if(name==='import'&&t[i+1]?.type==='string'&&!t[i+1].dynamic){addImport(t[i+1].value);continue;}
        for(let n=i+1;n<Math.min(t.length,i+50)&&v(n)!==';';n++)if(v(n)==='from'&&t[n+1]?.type==='string'){if(!t[n+1].dynamic)addImport(t[n+1].value);break;}
      }
      if(['fetch','Worker','SharedWorker','importScripts','require'].includes(name)&&v(i+1)==='('){
        // A game may use these names for data methods. Only a bare call or a
        // directly named browser global is evidence of a file dependency.
        if(member&&!globalMember){unverified.add(name+' のオブジェクト経由の呼び出しは静的に確認できません。');continue;}
        if(['Worker','SharedWorker'].includes(name)&&v(i+2)==='new'&&v(i+3)==='URL')continue;
        literal(i+2,name==='require'?base:documentEntry,name,['Worker','SharedWorker'].includes(name));
        if(name==='importScripts'){for(let n=i+3;n<t.length&&v(n)!==')';n++)if(v(n)===',')literal(n+1,documentEntry,name);}
      }
      if(name==='URL'&&v(i-1)==='new'&&v(i+1)==='('){
        const isMeta=v(i+3)===','&&v(i+4)==='import'&&v(i+5)==='.'&&v(i+6)==='meta'&&v(i+7)==='.'&&v(i+8)==='url';
        if(isMeta)literal(i+2,base,'new URL',['Worker','SharedWorker'].includes(v(i-3)));else unverified.add('new URL の基準URL・動的参照は実行時に確認してください。');
      }
    }
  };
  if(type==='css')css(source);
  else if(type==='js')js(source);
  else{
    let markup='',cursor=0;
    // Raw script text can contain CSS/HTML strings. Match its own closing tag,
    // and do not parse comment markers or nested-looking tags inside that text.
    for(const m of source.matchAll(/<!--[\s\S]*?-->|(<(script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)<\/\2\s*>/gi)){
      markup+=source.slice(cursor,m.index);cursor=m.index+m[0].length;
      if(m[1]){markup+=m[1];if(m[2].toLowerCase()==='style')css(m[3]);else js(m[3],path);}
    }
    markup+=source.slice(cursor);
    for(const {name,attrs}of htmlTags(markup)){
      if(attrs.has('style'))css(attrs.get('style'));
      if(name==='base')unverified.add('base指定は隔離プレイヤーで無効になります。参照を起動後に確認してください。');
      if(!['script','img','link','audio','video','source','iframe','object'].includes(name))continue;
      if(name==='link'&&!/(?:^|\s)(?:stylesheet|icon|apple-touch-icon|preload|modulepreload)(?:\s|$)/i.test(attrs.get('rel')||''))continue;
      for(const attr of ['src','href','poster','data'])if(attrs.has(attr)&&(attr!=='data'||name==='object'))add(attrs.get(attr));
      if(attrs.has('srcset')){const srcset=attrs.get('srcset');if(/data:/i.test(srcset))unverified.add('data URLを含むsrcsetは起動後に確認してください。');else for(const part of srcset.split(','))add(part.trim().split(/\s+/)[0]);}
    }
  }
  return {required:[...required],external:[...external],unverified:[...unverified],workerEntries:[...workerEntries]};
}
export async function inspectUploadDependencies(contents,entry,localResources){
  const queue=[{path:entry,base:entry}],visited=new Set(),missing=new Set(),external=new Set(),unverified=new Set();let analyzedBytes=0;
  while(queue.length){
    const {path,base}=queue.shift(),key=path+'\0'+base;if(visited.has(key))continue;visited.add(key);
    const value=contents.get(path);if(!value){missing.add(path);continue;}
    const type=/\.css$/i.test(path)?'css':/\.(?:m?js|cjs)$/i.test(path)?'js':/\.html?$/i.test(path)?'html':null;if(!type)continue;
    const size=value instanceof Uint8Array?value.byteLength:value.size;
    if(size>8*1024*1024||analyzedBytes+size>32*1024*1024){unverified.add(path+'：静的解析の容量上限で未確認です。');continue;}analyzedBytes+=size;
    const text=value instanceof Uint8Array?new TextDecoder().decode(value):await value.text();
    const documentBase=type==='html'?path:base,result=analyzeDependencies(text,path,type,documentBase);
    const refs=new Set(result.required);if(type==='html')for(const ref of localResources(text,path))refs.add(ref);
    for(const ref of refs){if(!contents.has(ref))missing.add(ref);else if(/\.(?:html?|css|m?js|cjs)$/i.test(ref))queue.push({path:ref,base:result.workerEntries.includes(ref)?ref:documentBase});}
    for(const ref of result.external)external.add(ref);for(const item of result.unverified)unverified.add(path+'：'+item);
  }
  return {missing:[...missing],external:[...external],unverified:[...unverified],checkedFiles:visited.size,analyzedBytes};
}
