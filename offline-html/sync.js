// Compare the existing strings rather than serializing entire catalogues and
// inline thumbnails into two additional, potentially very large JSON strings.
function equalValue(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  if(Array.isArray(a))return a.length===b.length&&a.every((value,i)=>equalValue(value,b[i]));
  const keys=Object.keys(a).filter(key=>a[key]!==undefined),other=Object.keys(b).filter(key=>b[key]!==undefined);
  return keys.length===other.length&&keys.every(key=>Object.hasOwn(b,key)&&equalValue(a[key],b[key]));
}
function sameGame(a,b){
  if(a===b)return true;
  const keys=Object.keys(a).filter(key=>key!=='handle'&&key!=='folder'&&a[key]!==undefined),other=Object.keys(b).filter(key=>key!=='handle'&&key!=='folder'&&b[key]!==undefined);
  return keys.length===other.length&&keys.every(key=>Object.hasOwn(b,key)&&equalValue(a[key],b[key]));
}
export async function sameLibraryView(before,after,{signal}={}){
  signal?.throwIfAborted();
  if(before.length!==after.length)return false;
  if(before.length>512){await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();}
  let deadline=performance.now()+8;
  for(let i=0;i<before.length;i++){
    if(!sameGame(before[i],after[i]))return false;
    if((i&15)===15&&performance.now()>=deadline){await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();deadline=performance.now()+8;}
  }
  signal?.throwIfAborted();return true;
}
// Keep a small snapshot of visible fields. Large thumbnail strings are retained
// by reference; copied tag arrays still detect later in-place edits.
export function cardViewKey(game){
  return [game.id,game.path,game.kind,game.title,[...game.tags],game.developmentEnvironment,game.description?.slice(0,100),game.description?.length>100,game.thumbnail,game.settingsError,game.thumbnail===true?game.updatedAt:null];
}
export function sameCardView(snapshot,game){return equalValue(snapshot,cardViewKey(game));}
