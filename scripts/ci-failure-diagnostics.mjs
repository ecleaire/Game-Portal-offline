// Preserve Node's normal failure behavior while exposing bounded test failures
// through the check API when hosted-runner log downloads are unavailable.
if(process.env.GITHUB_ACTIONS==='true')process.on('uncaughtExceptionMonitor',error=>{
 const value=String(error?.stack||error).slice(0,3600);
 for(let start=0;start<value.length;start+=1800){const message=value.slice(start,start+1800).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');console.log('::error title=Mac test failure::'+message);}
});
