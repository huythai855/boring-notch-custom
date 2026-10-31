const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const driveSend = require('./drive-send.cjs');
const source = fs.readFileSync('Tools/ChatDaemon/ChatBridge.js', 'utf8');

function fixture({host='www.messenger.com', path='/e2ee/t/thread-1', draft='', buttonCount=1,
  renderDelay=0, clearAfterClick=true, remountAfterClick=false, changeThreadOnInsert=false}={}) {
  let clicks=0, inserts=0, readyAt=0;
  const location={hostname:host,pathname:path};
  const root={parentElement:null, querySelectorAll:()=>Date.now() >= readyAt ? Array(buttonCount).fill(button) : []};
  const makeInput=value=>({innerText:value, isConnected:true, parentElement:root, getClientRects:()=>[{}], focus(){}});
  const input=makeInput(draft);
  let currentInput=input;
  const button={isConnected:true,getClientRects:()=>[{}],contains:()=>false,
    getAttribute:k=>k==='aria-label' ? 'Nhấn Enter để gửi' : null,
    click(){
      clicks++;
      if(remountAfterClick){input.isConnected=false;currentInput=makeInput('');}
      else if(clearAfterClick) input.innerText='';
    }};
  const context=vm.createContext({location,setTimeout(){throw Error('Page timer unavailable');},document:{
    querySelectorAll:s=>s==='[contenteditable="true"][role="textbox"]' ? [currentInput] : [],
    getSelection:()=>({removeAllRanges(){},addRange(){}}),
    createRange:()=>({selectNodeContents(){},collapse(){}}),
    execCommand(name,_,value){
      inserts++;input.innerText=value;readyAt=Date.now()+renderDelay;
      if(changeThreadOnInsert) location.pathname='/e2ee/t/other-thread';
      return true;
    }
  }});
  vm.runInContext(source,context);
  return {run:code=>vm.runInContext(code,context),counts:()=>({clicks,inserts}),input};
}

(async()=>{
  for(const host of ['evil.example','evilmessenger.com']){
    const f=fixture({host});
    await assert.rejects(driveSend(f,"thread-1","hello"),/Hội thoại/);
    assert.equal(f.counts().clicks,0);
  }
  let f=fixture();
  await assert.rejects(driveSend(f,"other-thread","hello"),/Hội thoại/);
  assert.equal(f.counts().inserts,0);
  f=fixture({draft:'user draft'});
  await assert.rejects(driveSend(f,"thread-1","hello"),/bản nháp/);
  assert.equal(f.counts().inserts,0);
  f=fixture({buttonCount:2});
  await assert.rejects(driveSend(f,"thread-1","hello"),/nút gửi/);
  assert.equal(f.counts().clicks,0);
  assert.equal(f.input.innerText,'hello');
  f=fixture({renderDelay:180});
  await driveSend(f,"thread-1","hello");
  assert.equal(f.counts().clicks,1);
  assert.equal(f.input.innerText,'');
  f=fixture({draft:'hello'});
  await driveSend(f,"thread-1","hello");
  assert.equal(f.counts().inserts,0);
  assert.equal(f.counts().clicks,1);
  f=fixture({changeThreadOnInsert:true});
  await assert.rejects(driveSend(f,"thread-1","hello"),/Hội thoại/);
  assert.equal(f.counts().clicks,0);
  for(const options of [{clearAfterClick:false},{remountAfterClick:true}]){
    f=fixture(options);
    await assert.rejects(driveSend(f,"thread-1","hello"),/chưa xác nhận/);
    assert.equal(f.counts().clicks,1,'Must not retry ambiguous sends');
  }
  f=fixture({host:'id.zalo.me',path:'/account'});
  assert.equal(f.run('bridge.snapshot("Zalo").state'),'login');
  console.log('Bridge tests passed with page timers disabled: delayed button, exact draft retry, conflicting draft, stale target, ambiguous acknowledgement, one-click limit.');
})().catch(error=>{console.error(error);process.exitCode=1;});
