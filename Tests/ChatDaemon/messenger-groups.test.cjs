const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {JSDOM} = require('../../build/chat-tests/node_modules/jsdom');
const source = fs.readFileSync('Tools/ChatDaemon/ChatBridge.js', 'utf8');
function snapshot({group = true, rows, sidebar = true}) {
  const dom = new JSDOM(`
    ${sidebar ? `<div role="row"><div role="gridcell" aria-label="${group ? 'Nhóm chat: ' : ''}Demo"><a href="/t/demo">Demo</a></div></div>` : ''}
    <section role="log">${rows}<div contenteditable="true" role="textbox"></div></section>
  `, {url:'https://www.messenger.com/t/demo'});
  dom.window.HTMLElement.prototype.getClientRects = () => [{}];
  const context = vm.createContext({document:dom.window.document, location:dom.window.location,
    getComputedStyle:dom.window.getComputedStyle.bind(dom.window)});
  vm.runInContext(source, context);
  return JSON.parse(vm.runInContext('JSON.stringify(bridge.snapshot("Messenger"))', context));
}
const bubble = (label, body, heading = '') => `<div aria-label="${label}"><div data-scope="messages_table">${heading}<div data-ad-rendering-role="text-message" dir="auto">${body}</div></div></div>`;
let s = snapshot({rows:
  bubble('Lúc 22:24 16 Tháng 10, 2026, Anh Huy: Chào nhóm', 'Chào nhóm', '<h4 dir="auto">Anh Huy</h4>') +
  bubble('Lúc 22:24 16 Tháng 10, 2026, Anh Huy: Tin thứ hai', 'Tin thứ hai') +
  bubble('At 8:49 AM, Chị Lan: Hello', 'Hello', '<h4 dir="auto">Chị Lan</h4>') +
  bubble('Lúc 09:02, Bạn: Tin của mình', 'Tin của mình', '<h4 dir="auto">Bạn đã gửi</h4>') +
  bubble('Lúc 09:02, Bạn: Tin tiếp theo', 'Tin tiếp theo') +
  `<div><div data-scope="messages_table"><h4 dir="auto">Anh Minh</h4><div data-ad-rendering-role="text-message" dir="auto">Có heading riêng</div></div></div>` +
  `<div><div data-scope="messages_table"><div data-ad-rendering-role="text-message" dir="auto">Không biết người gửi</div></div></div>`
});
assert.deepEqual(s.messages.map(m=>m.senderName), ['Anh Huy','Anh Huy','Chị Lan',null,null,'Anh Minh',null]);
assert.deepEqual(s.messages.map(m=>m.outgoing), [false,false,false,true,true,false,false]);
assert.equal(s.messages[0].text,'Chào nhóm','Sender heading must not be included in the body');
assert.equal(s.messages[4].text,'Tin tiếp theo');
// The sidebar group marker must work even if only one sender is currently loaded.
s = snapshot({rows:bubble('Lúc 09:31, Anh Huy: Tin đơn', 'Tin đơn')});
assert.equal(s.messages[0].senderName,'Anh Huy');
// A quoted author's heading must not replace the actual sender from the row label.
s = snapshot({rows:bubble('Lúc 09:32, Chị Lan: Trả lời', 'Trả lời', '<blockquote><h4>Anh Huy</h4></blockquote>')});
assert.equal(s.messages[0].senderName,'Chị Lan');
// A common ancestor containing multiple rows must never supply a neighbor's name.
s = snapshot({rows:`<div><h4>Anh Huy</h4><div data-scope="messages_table"><div dir="auto">Một</div></div><div data-scope="messages_table"><div dir="auto">Hai</div></div></div>`});
assert.deepEqual(s.messages.map(m=>m.senderName),[null,null]);
// Direct chats keep their existing compact layout.
s = snapshot({group:false, rows:bubble('Lúc 09:31, Anh Huy: Chào bạn', 'Chào bạn', '<h4 dir="auto">Anh Huy</h4>')});
assert.equal(s.messages[0].senderName,null);
// A collapsed sidebar can still identify groups from multiple distinct senders.
s = snapshot({sidebar:false, rows:bubble('Lúc 09:31, Anh Huy: Một', 'Một')+bubble('At 09:32, Chị Lan: Hai','Hai')});
assert.deepEqual(s.messages.map(m=>m.senderName),['Anh Huy','Chị Lan']);
// Real Messenger also prefixes the clock with a weekday, and reply headings
// contain both participants. The row's actual author takes precedence.
s = snapshot({rows:
  bubble('Lúc Chủ Nhật 12:51ch, Chị Lan: Trả lời', 'Trả lời', '<h4 dir="auto">Chị Lan đã trả lời Anh Huy</h4>') +
  bubble('Lúc Chủ Nhật 12:52ch, Chị Lan: Tiếp theo', 'Tiếp theo') +
  bubble('At Sunday 12:53 PM, Anh Minh: Reply', 'Reply', '<h4 dir="auto">Anh Minh replied to Anh Huy</h4>')
});
assert.deepEqual(s.messages.map(m=>m.senderName),['Chị Lan','Chị Lan','Anh Minh']);
s = snapshot({rows:`<div><div data-scope="messages_table"><h4 dir="auto">Chị Lan đã trả lời Anh Huy</h4><div dir="auto">Không có nhãn thời gian</div></div></div>`});
assert.equal(s.messages[0].senderName,'Chị Lan');
console.log('Messenger group tests passed: Vietnamese/English labels, dated timestamps, continuation messages, heading fallback, quote isolation, self messages, single-sender groups and direct chats.');
