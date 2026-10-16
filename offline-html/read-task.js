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
