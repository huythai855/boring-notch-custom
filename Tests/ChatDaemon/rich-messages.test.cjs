const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {JSDOM}=require('../../build/chat-tests/node_modules/jsdom');
const source=fs.readFileSync('Tools/ChatDaemon/ChatBridge.js','utf8');
const dom=new JSDOM(`
  <div id="pane-side"><div role="row" aria-selected="true"><span title="Nhóm Demo" dir="auto">Nhóm Demo</span></div>
    <div role="row" id="other"><span title="Other" dir="auto">Other</span></div></div>
  <div id="main"><header><span title="Nhóm Demo" dir="auto">Nhóm Demo</span></header>
  <span data-testid="group-chat-profile-picture"></span>
  <div data-testid="conversation-panel-messages" id="timeline">
    <div data-id="m1"><div data-testid="msg-container">
      <span data-testid="tail-in"></span><span data-testid="author">Anh Huy</span>
      <div data-pre-plain-text="[09:31, 2/11/2026] Anh Huy: "><span class="selectable-text copyable-text" data-testid="selectable-text">chúc <span class="select-all selectable-text copyable-text" data-testid="select-all selectable-text" data-plain-text="@Anh Tuấn">@Anh Tuấn</span> sinh nhật vui vẻ <img class="emoji" alt="🎉" aria-hidden="true"><img class="avatar" alt="?"></span></div>
      <span data-testid="msg-meta">09:31</span><span data-testid="reaction-bubble" class="selectable-text copyable-text">❤️ 3</span>
    </div></div>
    <div data-id="m2"><div data-testid="msg-container">
      <span data-testid="tail-in"></span>
      <div data-pre-plain-text="[09:32, 2/11/2026] Chị Lan: ">
        <div data-testid="quoted-message"><span data-testid="author">Anh Huy</span><span class="quoted-mention selectable-text copyable-text" data-testid="selectable-text">Tin trước <span class="mention">@Anh Tuấn</span></span></div>
        <span class="selectable-text copyable-text" data-testid="selectable-text">Đồng ý, cảm ơn!</span>
      </div><span data-testid="msg-meta">09:32</span>
    </div></div>
    <div data-id="m3"><div data-testid="msg-container"><span data-testid="selectable-text">My reply</span><span data-testid="msg-meta"><span data-icon="msg-dblcheck"></span>09:33</span></div></div>
    <div data-id="m4"><div data-testid="msg-container"><span data-testid="author">Anh Minh</span><span data-testid="tail-in"></span><div data-testid="image-thumb"><img alt="?"></div></div></div>
    <div data-id="m5" class="virtual"><div data-testid="msg-container" class="virtual"><span data-testid="tail-in"></span><span data-testid="author">Anh Huy</span><span data-testid="selectable-text" class="virtual">Tin gần đây ở ngoài viewport</span></div></div>
    <div data-id="m6"><div data-testid="msg-container"><span data-testid="tail-in"></span><span data-testid="author">Anh Huy</span><span data-testid="selectable-text">?</span></div></div>
    <div data-id="m7"><div data-testid="msg-container"><span data-testid="tail-in"></span><span data-testid="author">Chị Lan</span><div data-testid="image-thumb"></div><span data-testid="image-caption selectable-text">Chú thích ảnh</span></div></div>
    <div data-id="m8"><div data-testid="msg-container"><span data-testid="tail-in"></span><span data-testid="author">Anh Minh</span><div data-testid="sticker-container"><canvas data-testid="lottie-animated-emoji-container"></canvas></div></div></div>
  </div><footer><div contenteditable="true" role="textbox"></div></footer></div>
`,{url:'https://web.whatsapp.com/'});
const {document}=dom.window;
dom.window.HTMLElement.prototype.getClientRects=function(){return this.classList.contains('virtual') ? [] : [{}];};
let now=0,top=0;
const timeline=document.querySelector('#timeline');
Object.defineProperties(timeline,{clientHeight:{value:300},scrollHeight:{value:1600},scrollTop:{get:()=>top,set:value=>{top=Math.max(0,Math.min(value,1300));}}});
const context=vm.createContext({document,location:dom.window.location,Date:{now:()=>now},getComputedStyle:dom.window.getComputedStyle.bind(dom.window)});
vm.runInContext(source,context);
const run=code=>vm.runInContext(code,context);
const snapshot=()=>JSON.parse(run('JSON.stringify(bridge.snapshot("WhatsApp"))'));
let s=snapshot();
assert.equal(s.messages.length,8,'Read active-chat DOM rows even when WebKit skips their layout');
assert.equal(s.messages[0].text,'chúc @Anh Tuấn sinh nhật vui vẻ 🎉');
assert.equal(s.messages[0].senderName,'Anh Huy');
assert.deepEqual(s.messages[0].runs.filter(r=>r.mention).map(r=>r.text),['@Anh Tuấn']);
assert.equal(s.messages[0].runs.map(r=>r.text).join(''),s.messages[0].text);
assert.equal(s.messages[1].text,'Đồng ý, cảm ơn!');
assert.equal(s.messages[1].senderName,'Chị Lan','Reply author must not replace the actual sender');
assert.deepEqual(s.messages[1].reply,{senderName:'Anh Huy',text:'Tin trước @Anh Tuấn'});
assert.equal(s.messages[2].outgoing,true,'Consecutive outgoing bubbles can use semantic receipt markers');
assert.equal(s.messages[2].senderName,null);
assert.equal(s.messages[3].text,'[Ảnh]');
assert.equal(s.messages[4].text,'Tin gần đây ở ngoài viewport');
assert.equal(s.messages[5].text,'?','A literal question mark is valid user text');
assert.equal(s.messages[6].text,'Chú thích ảnh');
assert.equal(s.messages[7].text,'[Nhãn dán]');
run('bridge.beginRecent("wa-name:Nh%C3%B3m%20Demo")');
assert.equal(top,1300,'Recent messages must scroll the actual timeline to its end');
now=200;assert.equal(run('bridge.recentStep("wa-name:Nh%C3%B3m%20Demo")'),false);
now=500;assert.equal(run('bridge.recentStep("wa-name:Nh%C3%B3m%20Demo")'),true);
top=0;run('bridge.snapshot("WhatsApp", false)');assert.equal(top,0,'A visible Connection window must retain manual history scrolling');
run('bridge.snapshot("WhatsApp", true)');assert.equal(top,1300,'A hidden connection must follow new messages');
const target=document.querySelector('#other');
target.addEventListener('mousedown',()=>{
 document.querySelector('#pane-side [aria-selected]').setAttribute('aria-selected','false');
 target.setAttribute('aria-selected','true');document.querySelector('#main header span').title='Other';
});
assert.equal(run('bridge.select("wa-name:Other")'),false,'New header with stale old bubbles is not a completed selection');
assert.equal(run('bridge.selectionReady("wa-name:Other")'),false);
timeline.innerHTML='<div data-id="other-new"><div data-testid="msg-container"><span data-testid="selectable-text">New chat content</span></div></div>';
document.querySelector('#main footer').remove();
assert.equal(run('bridge.selectionReady("wa-name:Other")'),true,'Read-only conversations need no composer');
assert.equal(snapshot().canSend,false);
console.log('Rich message tests passed: complete mentions, quote separation, sender identity, media placeholders, virtual rows, latest scrolling, stale-transition and read-only guards.');
