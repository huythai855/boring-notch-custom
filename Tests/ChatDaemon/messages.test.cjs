const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {JSDOM} = require('../../build/chat-tests/node_modules/jsdom');
const source = fs.readFileSync('Tools/ChatDaemon/ChatBridge.js', 'utf8');
const dom = new JSDOM(`
  <section role="log" aria-live="polite">
  <a href="/e2ee/t/123/">Friend<span>Preview, not a message</span></a>
  <div role="row"><h4 role="heading">Bạn đã gửi</h4>
    <div data-scope="messages_table"><h4 dir="auto">Bạn đã gửi</h4><div dir="auto"><span dir="auto">hello</span></div><span dir="auto">Đã gửi 1 phút trước</span><span dir="auto">00:53</span></div>
  </div>
  <div role="row" aria-label="Lúc 09:30, Bạn: another outgoing"><div data-scope="messages_table"><div dir="auto">second</div></div></div>
  <div role="row"><div data-scope="messages_table"><div dir="auto">reply</div></div></div>
  <div role="row"><div data-scope="messages_table"><time dir="auto">00:53</time><div role="status" dir="auto">Đã gửi</div></div></div>
  <div role="row"><div data-scope="messages_table"><div data-ad-rendering-role="text-message" dir="auto">Bạn đã gửi</div></div></div>
  <div role="row"><div data-scope="messages_table"><div style="border-radius:18px;background-color:rgb(20,100,220)"><span dir="auto">00:53</span></div></div></div>
  <div role="row"><div data-scope="messages_table"><div dir="auto">Đã gửi bài cho bạn rồi</div></div></div>
  <div role="row"><div data-scope="messages_table"><div style="border-radius:18px;background-color:rgb(20,100,220)"><span dir="auto">Đã gửi 1 phút trước</span></div></div></div>
  <div contenteditable="true" role="textbox">unsent draft, not a message</div>
  </section>
`,{url:'https://www.messenger.com/e2ee/t/123/'});
dom.window.HTMLElement.prototype.getClientRects = () => [{}];
const context = vm.createContext({document:dom.window.document,location:dom.window.location,setTimeout,getComputedStyle:dom.window.getComputedStyle.bind(dom.window)});
vm.runInContext(source,context);
const snapshot = JSON.parse(vm.runInContext('JSON.stringify(bridge.snapshot("Messenger"))',context));
assert.deepEqual(snapshot.messages.map(m=>m.text),['hello','second','reply','Bạn đã gửi','00:53','Đã gửi bài cho bạn rồi','Đã gửi 1 phút trước']);
assert.equal(snapshot.messages[0].outgoing,true);
assert.equal(snapshot.messages[1].outgoing,true);
assert.equal(snapshot.messages[2].outgoing,false);
assert.equal(snapshot.activeID,'123');
assert.equal(snapshot.threads.length,1);
assert.equal(snapshot.canSend,true);
console.log('Message extraction tests passed: scoped bubbles, nested-text deduplication, direction, sidebar/draft exclusion.');
