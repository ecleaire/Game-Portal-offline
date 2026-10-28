// A failed transport can still have committed the remote ref. Never retry or
// overwrite it blindly: accept only the exact content-addressed commit.
export function publishWithConfirmation(push,readRemote,expected){
 try{push();return false;}
 catch(error){
  let remote;try{remote=readRemote();}catch{throw error;}
  if(remote!==expected)throw error;
  return true;
 }
}
