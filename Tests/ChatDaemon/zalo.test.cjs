const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const driveSend=require('./drive-send.cjs');
const {JSDOM}=require('../../build/chat-tests/node_modules/jsdom');
const source=fs.readFileSync('Tools/ChatDaemon/ChatBridge.js','utf8');
function fixture({inactive=false,mouseDownSelection=false}={}) {
  const dom=new JSDOM(inactive ? '<p>Nhấn kích hoạt để sử dụng trên Tab này</p>' : `
    <div class="conv-item selected"><span class="conv-item-title__name">My Documents</span></div>
    <div class="conv-item"><span class="conv-item-title__name">Other</span></div>
    <div id="messageViewContainer">
      <div class="chat-message me" id="message-frame-1"><div class="text-message__container"><span class="text">hello</span></div><span class="card-send-time">00:53</span></div>
      <div class="chat-message" id="message-frame-2"><div class="text-message__container">reply</div><span class="message-action">reaction</span></div>
    </div>
    <div><div id="richInput" class="rich-input" contenteditable="false"></div><div class="z--btn--v2 chat-box-input-button" title="Gửi nhanh biểu tượng cảm xúc">Send</div></div>
  `,{url:'https://chat.zalo.me/'});
  dom.window.HTMLElement.prototype.getClientRects=()=>[{}];
  let ticks=0,clicks=0;
  const input=dom.window.document.querySelector('#richInput');
  const sendControl=dom.window.document.querySelector('.chat-box-input-button');
  input?.addEventListener('mousedown',()=>input.setAttribute('contenteditable','true'));
  if(mouseDownSelection) for(const row of dom.window.document.querySelectorAll('.conv-item')) row.addEventListener('mousedown',()=>{
    for(const e of dom.window.document.querySelectorAll('.conv-item'))e.classList.remove('selected');
    row.classList.add('selected');
  });
  dom.window.document.execCommand=(name,_,value)=>{
    assert.equal(input.getAttribute('contenteditable'),'true');
    input.textContent=value;sendControl.classList.add('send-msg-btn');sendControl.title='Gửi';return true;
  };
  sendControl?.addEventListener('click',()=>{clicks++;input.textContent='';});
  const context=vm.createContext({document:dom.window.document,location:dom.window.location,
    getComputedStyle:dom.window.getComputedStyle.bind(dom.window),
    setTimeout:()=>{ticks++;throw Error('Page timer unavailable');}});
  vm.runInContext(source,context);
  return {run:code=>vm.runInContext(code,context),counts:()=>({ticks,clicks})};
}
(async()=>{
  let f=fixture();
  const s=JSON.parse(f.run('JSON.stringify(bridge.snapshot("Zalo"))'));
  assert.equal(s.canSend,true);
  assert.equal(s.activeID,s.threads[0].id);
  assert.deepEqual(s.messages.map(m=>m.text),['hello','reply']);
  assert.equal(s.messages[0].outgoing,true);
  assert.equal(s.messages[1].outgoing,false);
  await driveSend(f,s.activeID,"test");
  assert.equal(f.counts().clicks,1);
  f=fixture({mouseDownSelection:true});
  const next=f.run('bridge.snapshot("Zalo").threads[1].id');
  assert.equal(f.run(`bridge.select(${JSON.stringify(next)})`),true);
  assert.equal(f.run('bridge.snapshot("Zalo").activeID'),next);
  f=fixture({inactive:true});
  assert.equal(f.run('bridge.snapshot("Zalo").state'),'inactive');
  f=fixture();
  const other=f.run('bridge.snapshot("Zalo").threads[1].id');
  assert.equal(f.run(`bridge.select(${JSON.stringify(other)})`),false);
  assert.equal(f.run(`bridge.selectionReady(${JSON.stringify(other)})`),false);
  assert.equal(f.counts().ticks,0,'Commands must not depend on page timers');
  console.log('Zalo tests passed: richInput, selected thread, message bodies/direction, inactive session, bounded background wait.');
})().catch(error=>{console.error(error);process.exitCode=1;});
