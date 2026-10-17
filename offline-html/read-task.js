// Only for reads: stopping the wait must never interrupt a write or its verification.
export function readWithSignal(operation,signal) {
  if(!signal)return Promise.resolve().then(operation);
  return new Promise((resolve,reject)=>{
    const finish=(done,value)=>{signal.removeEventListener('abort',abort);done(value);};
    const abort=()=>finish(reject,signal.reason);
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>{signal.throwIfAborted();return operation();}).then(value=>finish(resolve,value),error=>finish(reject,error));
  });
}

// Independent startup work overlaps, but a started save must drain before release.
export async function prepareTogether(operations,signal){
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  let failure;
  try{
    const results=await Promise.allSettled(operations.map(operation=>Promise.resolve().then(()=>{controller.signal.throwIfAborted();return operation(controller.signal);}).catch(error=>{failure??=error;controller.abort(error);throw error;})));
    if(failure)throw failure;
    controller.signal.throwIfAborted();return results.map(result=>result.value);
  }finally{signal?.removeEventListener('abort',abort);}
}
