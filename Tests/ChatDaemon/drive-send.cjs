// Simulates native polling. Page timers are intentionally unavailable in the
// fixtures, reproducing a hidden/frozen WebKit page without real accounts.
module.exports=async function driveSend(f,thread,text,maxMs=450){
  const ticket=f.run(`bridge.beginSend(${JSON.stringify(thread)},${JSON.stringify(text)})`);
  const deadline=Date.now()+maxMs;
  while(Date.now()<deadline){
    if(f.run(`bridge.sendStep(${JSON.stringify(ticket)})`)==='submitted')return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  f.run(`bridge.expireSend(${JSON.stringify(ticket)})`);
};
