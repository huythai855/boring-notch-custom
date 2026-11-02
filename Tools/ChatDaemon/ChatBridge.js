// Runs in an isolated WKContentWorld. Never changes site CSS or intercepts
// network traffic. A small DOM adapter maps the web UI to a local chat model.
const bridge = globalThis.__notchChatBridge ??= (() => {
  const visible = e => !!e && e.getClientRects().length > 0;
  const all = (s, root = document) => Array.from(root.querySelectorAll(s)).filter(visible);
  const first = (s, root = document) => all(s, root)[0];
  const text = e => (e?.innerText || e?.textContent || '').trim();
  const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16); };
  const messenger = () => ['messenger.com', 'www.messenger.com'].includes(location.hostname);
  const whatsapp = () => location.hostname === 'web.whatsapp.com';
  const allowed = () => messenger() || location.hostname === 'chat.zalo.me' || whatsapp();
  let targets = new Map();
  const threadPath = href => href?.match(/\/(?:e2ee\/)?t\/([^/?#]+)/)?.[1];
  const composer = () => {
    if (whatsapp()) {
      const inputs = all('#main footer [contenteditable="true"][role="textbox"]');
      return inputs.length === 1 ? inputs[0] : null;
    }
    return messenger() ? first('[contenteditable="true"][role="textbox"]')
      : first('#richInput, #input_line_0[contenteditable="true"], #chat-input-content-id[contenteditable="true"], .chat-input [contenteditable="true"]');
  };
  function whatsappEntries() {
    const rows = all('#pane-side [role="row"]');
    const candidates = (rows.length ? rows : all('#pane-side [role="listitem"]')).map(row => {
      const label = first('span[title][dir="auto"]', row) || first('span[title]', row);
      const name = (label?.getAttribute('title') || text(label)).trim();
      return {row, target:label?.closest('[role="gridcell"]') || row, name, id: 'wa-name:' + encodeURIComponent(name)};
    }).filter(e => e.name);
    // WhatsApp's virtualized sidebar does not always expose a contact JID.
    // Require a unique exact label and a matching main header; duplicate names
    // are ambiguous and must never unlock sending to the wrong person.
    const counts = new Map();
    for (const e of candidates) counts.set(e.name, (counts.get(e.name) || 0) + 1);
    return candidates.filter(e => counts.get(e.name) === 1);
  }
  function whatsappHeader() {
    const label = first('#main header [data-testid="conversation-info-header-chat-title"]') ||
      first('#main header span[title][dir="auto"]') || first('#main header span[title]');
    return (label?.getAttribute('title') || text(label)).trim();
  }
  function whatsappActiveID() {
    const selected = whatsappEntries().filter(({row}) =>
      row.matches('[aria-selected="true"], [data-selected="true"]') ||
      !!row.querySelector('[aria-selected="true"], [data-selected="true"]') ||
      !!row.closest('#pane-side [aria-selected="true"]'));
    return selected.length === 1 && selected[0].name === whatsappHeader() ? selected[0].id : null;
  }
  function whatsappThreads() {
    targets = new Map();
    return whatsappEntries().slice(0, 40).map(({row, target, name, id}) => {
      targets.set(id, target);
      const lines = text(row).split('\n').map(s => s.trim()).filter(Boolean);
      const avatar = row.querySelector('img')?.src;
      return {id, name: name.slice(0, 150), preview: lines.filter(s => s !== name).slice(0, 2).join(' · ').slice(0, 250),
        avatar: avatar?.startsWith('https://') ? avatar : null};
    });
  }
  function whatsappText(element) {
    const read = node => {
      if (node.nodeType === 3) return node.nodeValue || '';
      if (node.nodeName === 'BR') return '\n';
      if (node.nodeName === 'IMG') return node.getAttribute('alt') || '';
      const value = Array.from(node.childNodes).map(read).join('');
      return ['DIV', 'P'].includes(node.nodeName) ? value + '\n' : value;
    };
    return read(element).trim();
  }
  function whatsappMessages() {
    const bodySelector = '[data-testid="msg-text"], [data-testid="selectable-text"], .selectable-text.copyable-text';
    const quoteSelector = '[data-testid^="quoted-"], [aria-label="Quoted message"], [aria-label="Tin nhắn được trích dẫn"]';
    const modern = all('#main [data-testid="msg-container"]').filter(e=>!e.querySelector('[data-testid="msg-container"]'));
    const rows = modern.length ? modern : all('#main .message-in, #main .message-out');
    return rows.slice(-50).flatMap((row, index) => {
      const nodes = all(bodySelector, row).filter(e => !e.querySelector(bodySelector) && !e.closest(quoteSelector));
      const content = nodes.map(whatsappText).filter(Boolean).join('\n');
      if (!content) return [];
      let outgoing = !!row.closest('.message-out') || !!row.querySelector('[data-testid="tail-out"], [data-icon="tail-out"]');
      const incoming = !!row.closest('.message-in') || !!row.querySelector('[data-testid="tail-in"], [data-icon="tail-in"]');
      if (!outgoing && !incoming) {
        // Consecutive bubbles can omit their tail. Use the rendered text
        // alignment inside this conversation, never sender/status strings.
        const pane = first('#main [data-testid="conversation-panel-messages"]') || first('#main');
        const bounds = pane?.getBoundingClientRect();
        if (bounds?.width > 0) {
          const rects = nodes.map(e=>e.getBoundingClientRect()).filter(r=>r.width > 5 && r.width < bounds.width * .95);
          const bubble = rects.sort((a,b)=>b.width-a.width)[0];
          if (bubble) outgoing = bubble.left - bounds.left > bounds.right - bubble.right + 16;
        }
      }
      return [{id: row.getAttribute('data-id') || row.closest('[data-id]')?.getAttribute('data-id') ||
          row.querySelector('[data-id]')?.getAttribute('data-id') || row.id || hash(content + index),
        text: content.slice(0, 8000), outgoing}];
    });
  }
  function whatsappSendButton(input) {
    const footer = input.closest('#main footer');
    if (!footer) return null;
    const candidates = all('button, [role="button"]', footer).filter(e => {
      const label = (e.getAttribute('aria-label') || e.getAttribute('title') || '').trim();
      return (/^(send( message)?|gửi( tin nhắn)?)$/i.test(label) || e.querySelector('[data-icon="send"], [data-testid="send"]')) &&
        !e.contains(input) && e.getAttribute('aria-disabled') !== 'true' && !e.disabled;
    });
    return candidates.length === 1 ? candidates[0] : null;
  }
  const zaloInactive = () => location.hostname === 'chat.zalo.me' && !all('.conv-item').length &&
    (document.body?.innerText || document.body?.textContent || '').includes('Nhấn kích hoạt để sử dụng trên Tab này');
  function zaloClick(element) {
    // Zalo's custom controls activate on mousedown, not only click. Reproduce
    // one normal pointer sequence; never change DOM attributes or send keys.
    const view = element.ownerDocument.defaultView;
    const rect = element.getBoundingClientRect();
    const options = {bubbles:true,cancelable:true,view,button:0,
      clientX:rect.left + rect.width / 2,clientY:rect.top + rect.height / 2};
    if (view.PointerEvent) element.dispatchEvent(new view.PointerEvent('pointerdown', {...options,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true}));
    element.dispatchEvent(new view.MouseEvent('mousedown', {...options,buttons:1}));
    if (view.PointerEvent) element.dispatchEvent(new view.PointerEvent('pointerup', {...options,buttons:0,pointerId:1,pointerType:'mouse',isPrimary:true}));
    element.dispatchEvent(new view.MouseEvent('mouseup', {...options,buttons:0}));
    element.dispatchEvent(new view.MouseEvent('click', {...options,buttons:0,detail:1}));
  }
  function activeID() {
    if (whatsapp()) return whatsappActiveID();
    if (messenger()) return threadPath(location.pathname) || null;
    const selected = first('.conv-item.selected, .conv-item.active, .conv-item.is-selected, [data-id].conv-item--selected');
    return selected ? zaloID(selected) : null;
  }
  function zaloID(e) {
    return e.getAttribute('data-id') || e.getAttribute('data-conv-id') ||
      'z-' + hash(text(first('.conv-item-title__name, .conv-item-title, .conv-item__name', e)) || text(e).split('\n')[0]);
  }
  function threads() {
    if (whatsapp()) return whatsappThreads();
    targets = new Map();
    const result = [];
    const rows = messenger()
      ? all('a[href*="/t/"], a[href*="/e2ee/t/"]')
      : all('.conv-item');
    for (const e of rows) {
      const id = messenger() ? threadPath(e.getAttribute('href')) : zaloID(e);
      if (!id || targets.has(id)) continue;
      const lines = text(e).split('\n').map(x => x.trim()).filter(Boolean);
      const name = messenger() ? lines[0] : text(first('.conv-item-title__name, .conv-item-title, .conv-item__name', e)) || lines[0];
      if (!name) continue;
      const avatar = e.querySelector('img')?.src;
      result.push({id, name: name.slice(0, 150), preview: lines.slice(1, 3).join(' · ').slice(0, 250),
        avatar: avatar?.startsWith('https://') ? avatar : null});
      targets.set(id, e);
      if (result.length >= 40) break;
    }
    return result;
  }
  function messages() {
    if (whatsapp()) return whatsappMessages();
    const rows = messenger()
      ? all('[data-scope="messages_table"]').filter(e => !e.querySelector('[data-scope="messages_table"]'))
      : all('#messageViewContainer .chat-message, #messageViewContainer .message-item, #messageViewContainer .msg-item');
    const result = [];
    for (const [index, row] of rows.slice(-50).entries()) {
      const nodes = messenger()
        ? all('[data-ad-rendering-role="text-message"], [dir="auto"]', row)
            .filter(e => !e.querySelector('[dir="auto"], [data-ad-rendering-role="text-message"]') &&
              !e.closest('button, [role="button"], a[href*="facebook.com/"]') &&
              !messageMetadata(e, row))
        : all('.text-message__container, .text-message, .message-content .text', row);
      const content = nodes.map(text).filter(Boolean).join('\n');
      if (!content) continue;
      // Missing direction metadata defaults to incoming; never infer from text.
      const group = row.closest('[role="row"]') || row.parentElement || row;
      const outgoing = messenger()
        ? isOutgoing(row, nodes, group)
        : row.classList.contains('me') || row.classList.contains('message-item--me') || !!row.querySelector('.me');
      result.push({id: row.getAttribute('data-id') || row.id || hash(content + index), text: content.slice(0, 8000), outgoing});
    }
    return result;
  }
  function messageMetadata(element, row) {
    // Filter by DOM role first, rather than stripping lines out of the author's
    // message. Quoted status text and literal times inside bubbles must survive.
    const metadata = element.closest('h1,h2,h3,h4,h5,h6,[role="heading"],time,[role="status"],[data-testid*="receipt"],[data-testid*="timestamp"]');
    if (metadata && row.contains(metadata)) return true;
    if (element.closest('[data-ad-rendering-role="text-message"]')) return false;
    const value = text(element);
    const sender = /^(bạn đã gửi|you sent)$/i.test(value);
    const clock = /^(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?(?:am|pm|sa|ch))?$/i.test(value);
    const receipt = /^(?:đã gửi|đã nhận|đã xem|đang gửi|chưa gửi|sent|sending|delivered|seen|read)(?:\s+(?:(?:lúc\s+)?\d{1,2}:\d{2}|\d+\s+(?:giây|phút|giờ|ngày|tuần|tháng|năm)(?:\s+trước)?|hôm qua|hôm nay|\d+\s*(?:seconds?|minutes?|hours?|days?|s|m|h|d)(?:\s+ago)?))?$/i.test(value);
    if (!sender && !clock && !receipt) return false;
    // Some Messenger receipts have no semantic role. They sit outside the
    // rounded, painted message bubble; use that layout evidence as a fallback.
    if (typeof getComputedStyle === 'function') {
      for (let node = element; node && node !== row; node = node.parentElement) {
        const style = getComputedStyle(node);
        const painted = style.backgroundColor && !['transparent','rgba(0, 0, 0, 0)'].includes(style.backgroundColor);
        const image = style.backgroundImage && style.backgroundImage !== 'none';
        const rounded = parseFloat(style.borderRadius) > 3 || parseFloat(style.borderTopLeftRadius) > 3;
        if (rounded && (painted || image)) return false;
      }
    }
    return true;
  }
  function isOutgoing(row, nodes, group) {
    const selfLabel = label => /^(you sent|bạn đã gửi)$/i.test(label) || /,\s*(you|bạn)(?:\s*[:：]|\s*$)/i.test(label);
    if (group.querySelector('[data-sender="self"], [data-is-outgoing="true"], [data-testid*="outgoing"]') ||
        all('[role="heading"], h4', group).some(e => selfLabel(text(e)))) return true;
    // Messenger exposes a localized accessible sender label on a surrounding
    // message container, outside the data-scope grid cell.
    for (let node = row, depth = 0; node && depth < 7; node = node.parentElement, depth++) {
      if (selfLabel(node.getAttribute('aria-label') || '')) return true;
    }
    // Some message groups omit repeated sender labels. Use rendered alignment
    // only inside the conversation landmark, with a margin for centered rows.
    const pane = composer()?.closest('[role="main"]');
    if (!pane) return false;
    const bounds = pane.getBoundingClientRect();
    const rects = nodes.map(e => e.getBoundingClientRect()).filter(r => r.width > 5 && r.width < bounds.width * 0.95);
    if (!rects.length) return false;
    const bubble = rects.sort((a,b) => b.width - a.width)[0];
    return bubble.left - bounds.left > bounds.right - bubble.right + 16;
  }
  function sendButton(input) {
    if (whatsapp()) return whatsappSendButton(input);
    // Search only the composer's surrounding toolbar. Generic [title] wrappers
    // can duplicate the real accessible button and make one button look like two.
    for (let scope = input.parentElement, depth = 0; scope && depth < 10; scope = scope.parentElement, depth++) {
      const selector = messenger() ? 'button, [role="button"], [data-id="btnSend"]'
        : 'button, [role="button"], [data-id="btnSend"], .send-msg-btn[title]';
      const candidates = all(selector, scope).filter(e => {
        const label = (e.getAttribute('aria-label') || e.getAttribute('title') || '').trim();
        return (/^(send( message)?|gửi( tin nhắn)?|nhấn enter để gửi|press enter to send)$/i.test(label) ||
          e.getAttribute('data-id') === 'btnSend') && !e.contains(input) &&
          e.getAttribute('aria-disabled') !== 'true' && !e.disabled;
      });
      if (candidates.length) return candidates.length === 1 ? candidates[0] : null;
    }
    return null;
  }
  function snapshot(service) {
    if (zaloInactive()) return {service, state:'inactive', title:service, threads:[], messages:[], activeID:null, canSend:false,
      detail:'Zalo đang tạm dừng vì tab khác hoạt động hoặc phiên đã để lâu. Mở Kết nối và bấm Kích hoạt.'};
    if (!allowed() || first('input[type="password"]') ||
        (whatsapp() && !first('#pane-side') && !composer())) {
      return {service, state:'login', title:service, threads:[], messages:[], activeID:null, canSend:false,
        detail: whatsapp() ? 'Mở Kết nối, rồi dùng WhatsApp trên điện thoại → Thiết bị liên kết để quét mã QR.'
          : 'Mở Kết nối để đăng nhập trong cửa sổ của daemon.'};
    }
    const list = threads(), id = activeID(), input = composer();
    const title = list.find(t => t.id === id)?.name || (whatsapp() ? whatsappHeader() : text(first('h2'))) || service;
    const state = list.length || input ? 'ready' : 'unsupported';
    return {service, state, title, threads:list, messages:id ? messages() : [], activeID:id,
      diagnostics:{messageScopes:all('[data-scope="messages_table"]').length,
        semanticMessages:all('[data-ad-rendering-role="text-message"]').length,
        scopedText:all('[data-scope="messages_table"] [dir="auto"]').length},
      canSend:!!(id && input), detail: state === 'unsupported'
        ? 'Chưa nhận diện được giao diện trang. Mở Kết nối để kiểm tra đăng nhập hoặc trạng thái tab.'
        : (!id && input ? 'Chưa xác định chắc chắn hội thoại đang mở; chức năng gửi đang khóa.' : null)};
  }
  function select(id) {
    threads();
    const target = targets.get(id);
    if (!target?.isConnected) throw Error('Hội thoại không còn trong danh sách. Hãy tải lại.');
    if (!allowed()) throw Error('Trang kết nối không hợp lệ.');
    if (location.hostname === 'chat.zalo.me' || whatsapp()) zaloClick(target); else target.click();
    return selectionReady(id);
  }
  const selectionReady = id => allowed() && activeID() === id && !!composer();
  let pendingSend = null;
  let sendSequence = 0;
  function sendAccepted(pending) {
    if (pending.editor?.isConnected && composer() === pending.editor && !text(pending.editor)) return true;
    return messages().some(m => m.outgoing && !pending.previousMessages.has(m.id) &&
      (whatsapp() ? m.text.trim() === pending.wanted : m.text.trim().endsWith(pending.wanted)));
  }
  // All bridge calls below are synchronous. The Swift daemon owns polling and
  // deadlines, because hidden WKWebViews can suspend page setTimeout callbacks.
  function beginSend(id, value) {
    if (!allowed() || !id || activeID() !== id) throw Error('Hội thoại đã thay đổi. Không gửi tin.');
    if (pendingSend?.clicked && !sendAccepted(pendingSend))
      throw Error('Lần gửi trước chưa được xác nhận. Kiểm tra hội thoại trong Kết nối trước khi gửi lại.');
    const input = composer();
    if (!input) throw Error('Không tìm thấy ô soạn tin.');
    if (!value.trim() || value.length > 16000) throw Error('Tin nhắn rỗng hoặc quá dài.');
    const wanted = value.trim();
    if (text(input) && text(input) !== wanted)
      throw Error('Trang web đang có bản nháp khác. Mở Kết nối để xử lý bản nháp trước; chưa gửi tin.');
    const ticket = String(++sendSequence);
    pendingSend = {ticket, id, value, wanted, stage:'place', clicked:false};
    if (location.hostname === 'chat.zalo.me') {
      zaloClick(input);
      input.focus();
    }
    return ticket;
  }
  function sendStep(ticket) {
    const pending = pendingSend;
    if (!pending || pending.ticket !== ticket) throw Error('Phiên gửi đã thay đổi; không tự gửi lại.');
    if (!allowed() || activeID() !== pending.id) throw Error('Hội thoại đã thay đổi; không tự gửi lại.');
    if (pending.stage === 'ack') {
      if (sendAccepted(pending)) { pendingSend = null; return 'submitted'; }
      return 'waiting';
    }
    const input = composer();
    if (!input) return 'waiting';
    if (pending.stage === 'place') {
      if (text(input) && text(input) !== pending.wanted)
        throw Error('Trang web đang có bản nháp khác; chưa gửi tin.');
      if (!text(input)) {
      input.focus();
      const selection = document.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, pending.value);
      }
      pending.stage = 'control';
      return 'waiting';
    }
    if (text(input) !== pending.wanted) return 'waiting';
    const button = sendButton(input);
    if (!button?.isConnected) return 'waiting';
    pending.previousMessages = new Set(messages().map(m => m.id));
    pending.editor = input;
    pending.stage = 'ack';
    pending.clicked = true; // Mark before dispatch, including exceptions mid-click.
    if (location.hostname === 'chat.zalo.me') zaloClick(button); else button.click();
    return 'waiting';
  }
  function expireSend(ticket) {
    if (pendingSend?.ticket !== ticket) throw Error('Phiên gửi đã thay đổi; không tự gửi lại.');
    if (pendingSend.clicked) throw Error('Đã bấm gửi nhưng chưa xác nhận được. Kiểm tra hội thoại trước khi gửi lại.');
    pendingSend = null;
    throw Error('Chưa nhận diện được ô soạn hoặc nút gửi. Bản nháp còn trong Kết nối; chưa bấm gửi.');
  }
  function diagnostics() {
    // Structural metadata only: no message text, cookies, contact names, or
    // arbitrary script execution. Used to tune provider adapters locally.
    const unique = values => [...new Set(values)].slice(0, 80).join(' | ');
    const testid = e => (e.getAttribute('data-testid') || '').replace(/^conv-msg-.*/, 'conv-msg-*');
    const describe = e => e ? {tag:e.tagName,role:e.getAttribute('role'),classes:e.className,
      testid:testid(e),attributes:e.getAttributeNames()} : null;
    return {
      whatsappNodes: whatsapp() ? JSON.stringify({
        testids:unique(all('#main [data-testid]').map(testid)),
        selectedRows:all('#pane-side [aria-selected="true"]').slice(0,2).map(e=>({node:describe(e),parent:describe(e.parentElement)})),
        messageNodes:all('#main [data-testid="msg-container"], #main [data-pre-plain-text]').slice(-4).map(e=>({node:describe(e),parent:describe(e.parentElement)}))
      }) : '{}',
      whatsappStructure: JSON.stringify({sidebar:all('#pane-side').length, rows:all('#pane-side [role="row"]').length,
        selected:all('#pane-side [aria-selected="true"]').length, headers:all('#main header span[title]').length,
        editors:all('#main footer [contenteditable="true"][role="textbox"]').length,
        messages:all('#main [data-testid="msg-container"], #main .message-in, #main .message-out').length}),
      threadClasses: unique(all('.conv-item').map(e => e.className)),
      threadAttributeNames: unique(all('.conv-item').flatMap(e => e.getAttributeNames())),
      editorDescriptors: unique(all('[contenteditable], #richInput').map(e => [e.tagName,e.id,e.className,e.getAttribute('role'),e.getAttribute('contenteditable')].join(':'))),
      messageClasses: unique(all('#messageViewContainer [class], .message-view [class]').map(e => e.className).filter(c => /message|msg|bubble|text|time/i.test(c))),
      relevantElementIds: unique(all('[id]').map(e => e.id).filter(id => /^(message|chat|input|rich|conv)/i.test(id))),
      selectedAttributes: unique(all('.conv-item[aria-selected], .conv-item [aria-selected]').map(e => e.getAttribute('aria-selected')))
      ,sendControlDescriptors: unique(all('#chat-box-input-container-id [title], #chatInput [title], [data-id="btnSend"]').filter(e => /gửi|send/i.test(e.getAttribute('title') || '')).map(e => [e.tagName,e.className,e.getAttribute('role'),e.getAttribute('title'),e.getAttribute('data-id')].join(':')))
    };
  }
  return {snapshot, select, selectionReady, beginSend, sendStep, expireSend, diagnostics};
})();
