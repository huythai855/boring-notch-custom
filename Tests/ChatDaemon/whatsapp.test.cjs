const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {JSDOM} = require('../../build/chat-tests/node_modules/jsdom');
const driveSend = require('./drive-send.cjs');
const source = fs.readFileSync('Tools/ChatDaemon/ChatBridge.js', 'utf8');

function fixture({login=false, duplicate=false, selected=true, buttonCount=1, modern=false,
  clearAfterClick=true, changeThreadOnInsert=false, host='web.whatsapp.com'}={}) {
  const dom = new JSDOM(login ? '<div data-ref="private-qr"><canvas></canvas></div>' : `
    <div contenteditable="true" role="textbox" id="search">Search draft</div>
    <div id="pane-side"><div role="grid">
      <div role="row" aria-selected="${selected}" id="alice"><span title="Alice" dir="auto">Alice</span><div>Sidebar preview</div></div>
      <div role="row" aria-selected="false" id="bob"><span title="${duplicate ? 'Alice' : 'Bob'}" dir="auto">Bob</span></div>
    </div></div>
    <div class="message-out"><span class="selectable-text copyable-text">Outside conversation</span></div>
    <div id="main">
      <header><span dir="auto" title="Alice">Alice</span></header>
      <div class="message-in" data-id="msg-1"><span class="selectable-text copyable-text"><span>Hello <img alt="👋"></span><br>line two</span><span>09:30</span></div>
      <div class="message-out" data-id="msg-2"><div data-testid="quoted-message"><span class="selectable-text copyable-text">Quoted text</span></div><span data-testid="msg-text" class="selectable-text copyable-text">My reply</span><span data-testid="msg-dblcheck">Read</span></div>
      <div class="message-in" data-id="image-only"><img alt="Photo"></div>
      <footer><div contenteditable="true" role="textbox" id="input"></div>
        ${Array.from({length:buttonCount}, () => '<button aria-label="Send"><span data-icon="send"></span></button>').join('')}
      </footer>
    </div>`, {url:`https://${host}/`});
  const {document} = dom.window;
  dom.window.HTMLElement.prototype.getClientRects = () => [{}];
  if (modern) {
    for (const row of document.querySelectorAll('#pane-side [role="row"]')) {
      const outer = document.createElement('div'); outer.setAttribute('role','gridcell');
      const marker = document.createElement('div'); marker.setAttribute('aria-selected',row.getAttribute('aria-selected'));
      row.removeAttribute('aria-selected');
      const cell = document.createElement('div'); cell.setAttribute('role','gridcell');
      while (row.firstChild) cell.append(row.firstChild);
      marker.append(cell); outer.append(marker); row.append(outer);
    }
    for (const bubble of document.querySelectorAll('#main .message-in, #main .message-out')) {
      const wrapper = document.createElement('div'); wrapper.setAttribute('role','row');
      wrapper.setAttribute('data-id',bubble.getAttribute('data-id'));
      const tail = document.createElement('span');
      tail.setAttribute('data-testid',bubble.classList.contains('message-out') ? 'tail-out' : 'tail-in');
      bubble.removeAttribute('data-id'); bubble.className=''; bubble.setAttribute('data-testid','msg-container');
      bubble.before(wrapper); wrapper.append(bubble); bubble.prepend(tail);
    }
    const repeated = document.createElement('div'); repeated.setAttribute('data-id','msg-3');
    repeated.innerHTML='<div data-testid="msg-container" data-fixture-align="right"><span data-testid="selectable-text">Second outgoing</span></div>';
    document.querySelector('#main footer').before(repeated);
    dom.window.HTMLElement.prototype.getBoundingClientRect = function() {
      if (this.id==='main') return {left:0,right:1000,width:1000,top:0,height:600};
      if (this.closest('[data-fixture-align="right"]')) return {left:700,right:950,width:250,top:0,height:20};
      return {left:0,right:0,width:0,top:0,height:20};
    };
  }
  let clicks = 0, inserts = 0, ticks = 0;
  const input = document.querySelector('#input');
  const select = (row, updateHeader=true) => {
    for (const e of document.querySelectorAll('#pane-side [aria-selected]')) e.setAttribute('aria-selected','false');
    (row.querySelector('[aria-selected]') || row).setAttribute('aria-selected','true');
    if (updateHeader) {
      document.querySelector('#main header span').setAttribute('title', row.querySelector('[title]').title);
      for (const msg of document.querySelectorAll('#main [data-id]')) msg.setAttribute('data-id', row.id+'-'+msg.getAttribute('data-id'));
    }
  };
  for (const row of document.querySelectorAll('#pane-side [role="row"]')) {
    const target = modern ? row.querySelector('span[title]').closest('[role="gridcell"]') : row;
    target.addEventListener(modern ? 'mousedown' : 'click', () => select(row));
  }
  document.execCommand = (name, _, value) => {
    assert.equal(name,'insertText');
    inserts++;
    input.textContent = value;
    if (changeThreadOnInsert) select(document.querySelector('#bob'));
    return true;
  };
  for (const button of document.querySelectorAll('footer button')) button.addEventListener('click', () => {
    clicks++;
    if (clearAfterClick) input.textContent = '';
  });
  const context = vm.createContext({document, location:dom.window.location,
    setTimeout(){ ticks++; throw Error('Page timer unavailable'); }});
  vm.runInContext(source, context);
  return {run:code => vm.runInContext(code, context), document, input, select,
    counts:() => ({clicks,inserts,ticks}), snapshot:() => JSON.parse(vm.runInContext('JSON.stringify(bridge.snapshot("WhatsApp"))',context))};
}

(async () => {
  let f = fixture({login:true});
  assert.equal(f.snapshot().state,'login');
  assert.equal(f.snapshot().canSend,false);
  assert.match(f.snapshot().detail,/QR/);
  assert(!JSON.stringify(f.snapshot()).includes('private-qr'));
  for (const host of ['evilwhatsapp.com','web.whatsapp.com.evil.example','whatsapp.com']) {
    f = fixture({host});
    assert.equal(f.snapshot().state,'login');
    await assert.rejects(driveSend(f,'wa-name:Alice','hello'),/Hội thoại/);
    assert.equal(f.counts().clicks,0);
  }
  f = fixture();
  const s = f.snapshot();
  assert.deepEqual(s.threads.map(t => t.name),['Alice','Bob']);
  assert.equal(s.activeID,'wa-name:Alice');
  assert.equal(s.canSend,true);
  assert.deepEqual(s.messages.map(m => [m.id,m.text,m.outgoing]),[
    ['msg-1','Hello 👋\nline two',false],['msg-2','My reply',true]
  ]);
  await driveSend(f,s.activeID,'Tiếng Việt 👋\nsecond line');
  assert.deepEqual(f.counts(),{clicks:1,inserts:1,ticks:0});
  assert.equal(f.document.querySelector('#search').textContent,'Search draft');
  assert.equal(f.run('bridge.select("wa-name:Bob")'),true);
  assert.equal(f.snapshot().activeID,'wa-name:Bob');

  f = fixture({modern:true});
  assert.deepEqual(f.snapshot().messages.map(m=>[m.id,m.text,m.outgoing]),[
    ['msg-1','Hello 👋\nline two',false],['msg-2','My reply',true],['msg-3','Second outgoing',true]
  ],'Modern semantic bubbles must exclude quotes/metadata and preserve parent message IDs');
  assert.equal(f.run('bridge.select("wa-name:Bob")'),true,'WhatsApp selects on mousedown inside its grid cell');
  assert.equal(f.snapshot().activeID,'wa-name:Bob');
  await driveSend(f,'wa-name:Bob','modern text');
  assert.equal(f.counts().clicks,1);

  f = fixture();
  f.select(f.document.querySelector('#bob'),false);
  assert.equal(f.snapshot().activeID,null,'Sidebar and header must agree before sending');
  assert.equal(f.run('bridge.selectionReady("wa-name:Bob")'),false);
  await assert.rejects(driveSend(f,'wa-name:Bob','hello'),/Hội thoại/);
  f.document.querySelector('#main header span').setAttribute('title','Bob');
  assert.equal(f.run('bridge.selectionReady("wa-name:Bob")'),true);
  f.document.querySelector('#bob span').title = 'Recycled virtual row';
  assert.equal(f.snapshot().canSend,false);
  f = fixture({duplicate:true});
  assert.equal(f.snapshot().threads.length,2,'Duplicate labels remain readable');
  assert.notEqual(f.snapshot().threads[0].id,f.snapshot().threads[1].id,'Duplicate labels must not alias another contact');
  assert.equal(f.snapshot().canSend,false);
  f = fixture({selected:false});
  assert.equal(f.snapshot().canSend,false,'A matching header alone is not enough');
  f = fixture();
  f.document.querySelector('#bob').setAttribute('aria-selected','true');
  assert.equal(f.snapshot().canSend,false,'Two selected rows are ambiguous');

  f = fixture();
  f.input.textContent = 'Existing draft';
  await assert.rejects(driveSend(f,'wa-name:Alice','new text'),/bản nháp/);
  assert.equal(f.input.textContent,'Existing draft');
  assert.equal(f.counts().clicks,0);
  f = fixture();
  f.input.textContent = 'same text';
  await driveSend(f,'wa-name:Alice','same text');
  assert.equal(f.counts().inserts,0);
  for (const buttonCount of [0,2]) {
    f = fixture({buttonCount});
    await assert.rejects(driveSend(f,'wa-name:Alice','hello',40),/nút gửi/);
    assert.equal(f.counts().clicks,0);
  }
  f = fixture();
  f.document.querySelector('footer button').setAttribute('aria-disabled','true');
  await assert.rejects(driveSend(f,'wa-name:Alice','hello',40),/nút gửi/);
  assert.equal(f.counts().clicks,0);
  f = fixture();
  f.document.querySelector('footer button').setAttribute('aria-label','Enviar');
  await driveSend(f,'wa-name:Alice','hello'); // Semantic send icon supports other locales.
  assert.equal(f.counts().clicks,1);
  f = fixture({changeThreadOnInsert:true});
  await assert.rejects(driveSend(f,'wa-name:Alice','hello'),/Hội thoại/);
  assert.equal(f.counts().clicks,0);
  f = fixture({clearAfterClick:false});
  await assert.rejects(driveSend(f,'wa-name:Alice','hello',60),/chưa xác nhận/);
  assert.equal(f.counts().clicks,1);
  await assert.rejects(driveSend(f,'wa-name:Alice','hello',60),/Lần gửi trước/);
  assert.equal(f.counts().clicks,1,'An ambiguous send must never be repeated');
  assert.equal(f.counts().ticks,0);
  console.log('WhatsApp tests passed: QR login, scoped text/emoji, guarded selection, duplicate names, drafts, one-click sends, hidden-page polling.');
})().catch(error => { console.error(error); process.exitCode = 1; });
