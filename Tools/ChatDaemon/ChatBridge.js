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
  const normalizedName = value => value.normalize('NFC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').replace(/\s+/g,' ').trim();
  const threadPath = href => href?.match(/\/(?:e2ee\/)?t\/([^/?#]+)/)?.[1];
  const composer = () => {
    if (whatsapp()) {
      const inputs = all('#main footer [contenteditable="true"][role="textbox"]');
      return inputs.length === 1 ? inputs[0] : null;
    }
    return messenger() ? first('[contenteditable="true"][role="textbox"]')
      : first('#richInput, #input_line_0[contenteditable="true"], #chat-input-content-id[contenteditable="true"], .chat-input [contenteditable="true"]');
  };
  const rowTokens = new WeakMap();
  let nextRowToken = 0;
  function whatsappEntries() {
    const rows = all('#pane-side [role="row"]');
    const candidates = (rows.length ? rows : all('#pane-side [role="listitem"]')).map(row => {
      const label = first('span[title][dir="auto"]', row) || first('span[title]', row);
      const name = normalizedName(label?.getAttribute('title') || text(label));
      return {row, target:label?.closest('[role="gridcell"]') || row, name, id: 'wa-name:' + encodeURIComponent(name)};
    }).filter(e => e.name);
    // WhatsApp's virtualized sidebar does not always expose a contact JID.
    // Keep duplicate labels readable using a per-row token, while their send
    // controls remain locked because the recipient identity is ambiguous.
    const counts = new Map();
    for (const e of candidates) counts.set(e.name, (counts.get(e.name) || 0) + 1);
    return candidates.map(e => {
      if (counts.get(e.name) === 1) return {...e,ambiguous:false};
      if (!rowTokens.has(e.row)) rowTokens.set(e.row,++nextRowToken);
      return {...e,id:'wa-row:'+rowTokens.get(e.row),ambiguous:true};
    });
  }
  function whatsappHeader() {
    const label = first('#main header [data-testid="conversation-info-header-chat-title"]') ||
      first('#main header span[title][dir="auto"]') || first('#main header span[title]');
    return normalizedName(label?.getAttribute('title') || text(label));
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
  const rawAll = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const bodySelector = '[data-testid="msg-text"], [data-testid~="selectable-text"], .selectable-text.copyable-text';
  const quoteSelector = '[data-testid^="quoted-"], [aria-label="Quoted message"], [aria-label="Tin nhắn được trích dẫn"]';
  const metadataSelector = '[data-testid="author"], [data-testid="msg-meta"], [data-testid^="reaction-"], [data-testid="forwarded-header"], [data-testid="link-preview-container"], [aria-hidden="true"]';
  function outerTextNodes(root, excludeQuotes = true) {
    const candidates = rawAll(bodySelector, root).filter(e =>
      !e.closest(metadataSelector) && (!excludeQuotes || !e.closest(quoteSelector)));
    const set = new Set(candidates);
    return candidates.filter(e => {
      for (let p = e.parentElement; p && p !== root; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
  }
  function richText(nodes, excludeQuotes = true) {
    const runs = [];
    const append = (value, mention = false) => {
      if (!value) return;
      const previous = runs[runs.length - 1];
      if (previous?.mention === mention) previous.text += value;
      else runs.push({text:value, mention});
    };
    const read = (node, mention = false) => {
      if (node.nodeType === 3) { append(node.nodeValue || '', mention); return; }
      if (node.nodeType !== 1) return;
      if (node.nodeName === 'BR') { append('\n', mention); return; }
      if (node.nodeName === 'IMG') {
        const alt = node.getAttribute('alt') || '';
        if (node.classList.contains('emoji') || /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(alt)) append(alt, mention);
        return;
      }
      if (node.matches(metadataSelector) || (excludeQuotes && node.matches(quoteSelector))) return;
      const tagged = mention || node.matches('[data-mention], .mention, .select-all, [data-testid~="select-all"]');
      const plain = node.getAttribute('data-plain-text') || '';
      if (tagged && !mention && plain.startsWith('@') && !text(node).startsWith('@')) append('@', true);
      for (const child of node.childNodes) read(child, tagged);
      if (['DIV','P','LI'].includes(node.nodeName) && runs.length && !runs[runs.length-1].text.endsWith('\n')) append('\n');
    };
    for (const node of nodes) read(node);
    if (runs.length) {
      runs[0].text = runs[0].text.trimStart();
      runs[runs.length-1].text = runs[runs.length-1].text.trimEnd();
    }
    let remaining = 8000;
    const bounded = runs.filter(r=>r.text).flatMap(r=>{
      const value = r.text.slice(0,remaining); remaining -= value.length;
      return value ? [{text:value,mention:r.mention}] : [];
    });
    return {text:bounded.map(r=>r.text).join(''), runs:bounded};
  }
  function whatsappRows() {
    const modern = rawAll('#main [data-testid="msg-container"]').filter(e=>!e.querySelector('[data-testid="msg-container"]'));
    return modern.length ? modern : rawAll('#main .message-in, #main .message-out');
  }
  function whatsappRowID(row, index = 0) {
    return row.getAttribute('data-id') || row.closest('[data-id]')?.getAttribute('data-id') ||
      row.querySelector('[data-id]')?.getAttribute('data-id') || row.id || hash(text(row) + index);
  }
  function mediaLabel(root) {
    if (root.querySelector('[data-testid="media-album"], [data-testid="image-thumb"]')) return '[Ảnh]';
    if (root.querySelector('[data-testid="video-thumb"], [data-icon="video-play"]')) return '[Video]';
    if (root.querySelector('[data-testid="ptt-play"], [data-testid="audio-play"], [data-icon="audio-play"]')) return '[Tin nhắn thoại]';
    if (root.querySelector('[data-testid="document-thumb"], [data-testid="document-message"]')) return '[Tệp đính kèm]';
    if (root.querySelector('[data-testid="sticker"], [data-testid="sticker-thumb"], [data-testid="sticker-container"], [data-testid="lottie-animated-emoji-container"]')) return '[Nhãn dán]';
    return '';
  }
  function whatsappMessages() {
    const group = !!document.querySelector('#main [data-testid="group-chat-profile-picture"], #main header [data-icon="default-group"]');
    return whatsappRows().slice(-50).flatMap((row,index)=>{
      const nodes = outerTextNodes(row);
      const body = richText(nodes);
      const content = body.text || mediaLabel(row);
      if (!content) return [];
      const meta = rawAll('[data-testid="msg-meta"]',row).find(e=>!e.closest(quoteSelector));
      let outgoing = !!row.closest('.message-out') || !!row.querySelector('[data-testid="tail-out"], [data-icon="tail-out"]') ||
        !!meta?.querySelector('[data-icon="msg-check"], [data-icon="msg-dblcheck"], [data-testid="msg-check"], [data-testid="msg-dblcheck"]');
      const incoming = !!row.closest('.message-in') || !!row.querySelector('[data-testid="tail-in"], [data-icon="tail-in"]');
      if (!outgoing && !incoming) {
        const pane = document.querySelector('#main [data-testid="conversation-panel-messages"]') || document.querySelector('#main');
        const bounds = pane?.getBoundingClientRect();
        if (bounds?.width > 0) {
          const rects = nodes.map(e=>e.getBoundingClientRect()).filter(r=>r.width>5 && r.width<bounds.width*.95);
          const bubble = rects.sort((a,b)=>b.width-a.width)[0];
          if (bubble) outgoing = bubble.left-bounds.left > bounds.right-bubble.right+16;
        }
      }
      const author = rawAll('[data-testid="author"]',row).find(e=>!e.closest(quoteSelector));
      const pre = rawAll('[data-pre-plain-text]',row).find(e=>!e.closest(quoteSelector))?.getAttribute('data-pre-plain-text') || '';
      const senderName = !outgoing && (author || group) ? (text(author) || pre.match(/^\[[^\]]+\]\s*(.+):\s*$/)?.[1] || null) : null;
      const quote = row.querySelector(quoteSelector);
      let reply = null;
      if (quote) {
        const quoted = richText(outerTextNodes(quote,false),false).text || mediaLabel(quote);
        if (quoted) reply = {senderName:text(quote.querySelector('[data-testid="author"]')) || null,text:quoted};
      }
      return [{id:whatsappRowID(row,index),text:content,outgoing,senderName,reply,
        runs:body.runs.some(r=>r.mention) ? body.runs : null}];
    });
  }
  let pendingSelection = null;
  let recent = null;
  const messageFingerprint = () => whatsappRows().map(whatsappRowID).join('|');
  function messageScroller() {
    let pane = document.querySelector('#main [data-testid="conversation-panel-messages"]');
    for (let e = pane; e && e.id !== 'main'; e = e.parentElement) {
      if (e.clientHeight>0 && e.scrollHeight>e.clientHeight+8) return e;
    }
    return pane;
  }
  function beginRecent(id) {
    if (!allowed() || activeID() !== id) throw Error('Hội thoại đã thay đổi. Chưa tải tin mới.');
    recent = {id, started:Date.now(), fingerprint:null, stable:0, ready:false};
    return recentStep(id);
  }
  function recentStep(id) {
    if (!recent || recent.id !== id || activeID() !== id) return false;
    if (!whatsapp()) { recent.ready=true; return true; }
    const scroller = messageScroller();
    if (scroller && scroller.scrollHeight>scroller.clientHeight+8) scroller.scrollTop=scroller.scrollHeight;
    const fingerprint = messageFingerprint();
    recent.stable = fingerprint===recent.fingerprint ? recent.stable+1 : 0;
    recent.fingerprint = fingerprint;
    const atBottom = !scroller || scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<=10;
    recent.ready = atBottom && recent.stable>=2 && Date.now()-recent.started>=350;
    return recent.ready;
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
      result.push({id: row.getAttribute('data-id') || row.id || hash(content + index), text: content.slice(0, 8000), outgoing,
        senderName: messenger() && !outgoing ? messengerSender(row) : null});
    }
    if (messenger() && !messengerGroupThread(result)) {
      for (const message of result) message.senderName = null;
    }
    return result;
  }
  function messengerSender(row) {
    // Each Messenger message has an accessible timestamp/sender container,
    // including continuation bubbles whose visible sender heading is omitted.
    // Never search a common timeline ancestor: that would borrow another sender.
    const scopes = [];
    for (let scope = row, depth = 0; scope && depth < 7; scope = scope.parentElement, depth++) {
      if (scope.matches('[role="log"], [role="main"]') ||
          rawAll('[data-scope="messages_table"]', scope).some(e =>
            e !== row && !e.contains(row) && !row.contains(e))) break;
      scopes.push(scope);
      const label = scope.getAttribute('aria-label') || '';
      const prefix = label.match(/^(?:Lúc|At)\s+[^:\n]*?\d{1,2}:\d{2}([^:\n]*):/i);
      const accessibleName = prefix?.[1].split(',').pop();
      if (accessibleName) return messengerSenderName(accessibleName);
    }
    // Prefer the actual per-message accessible author over headings such as
    // 'Alice replied to Bob'. Keep headings as a bounded fallback only.
    for (const scope of scopes) {
      const headings = rawAll('h4, [role="heading"][aria-level="4"]', scope).filter(e =>
        !e.closest('[data-ad-rendering-role="text-message"], blockquote, [role="blockquote"]'));
      if (headings.length === 1) return messengerSenderName(text(headings[0]).replace(/\s+(?:đã trả lời|replied to)\s+.+$/i, ''));
    }
    return null;
  }
  function messengerSenderName(value) {
    const name = normalizedName(value);
    return name && name.length <= 150 && !/^(you|bạn|you sent|bạn đã gửi)$/i.test(name) ? name : null;
  }
  function messengerGroupThread(messages) {
    const target = targets.get(activeID());
    const entry = target?.closest('[role="row"]') || target?.closest('[role="gridcell"]') || target;
    if (entry) {
      const labels = [entry, ...rawAll('[aria-label]', entry)];
      if (labels.some(e => /^(?:nhóm chat|group chat):/i.test(e.getAttribute('aria-label') || '')) ||
          /^(?:nhóm chat|group chat):/im.test(text(entry))) return true;
    }
    if (all('button, [role="button"]').some(e =>
        /^(?:tùy chọn nhóm|group options|thành viên trong đoạn chat|chat members)$/i.test(e.getAttribute('aria-label') || text(e)))) return true;
    // When the sidebar is collapsed, distinct incoming senders are additional
    // evidence of a group. A direct conversation retains its compact layout.
    return new Set(messages.map(m => m.senderName).filter(Boolean)).size > 1;
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
  function snapshot(service, followRecent = false) {
    if (followRecent && recent && activeID() === recent.id) recentStep(recent.id);
    if (zaloInactive()) return {service, state:'inactive', title:service, threads:[], messages:[], activeID:null, canSend:false,
      detail:'Zalo đang tạm dừng vì tab khác hoạt động hoặc phiên đã để lâu. Mở Kết nối và bấm Kích hoạt.'};
    if (!allowed() || first('input[type="password"]') ||
        (whatsapp() && !first('#pane-side') && !composer())) {
      return {service, state:'login', title:service, threads:[], messages:[], activeID:null, canSend:false,
        detail: whatsapp() ? 'Mở Kết nối, rồi dùng WhatsApp trên điện thoại → Thiết bị liên kết để quét mã QR.'
          : 'Mở Kết nối để đăng nhập trong cửa sổ của daemon.'};
    }
    const list = threads(), id = activeID(), input = composer();
    const ambiguous = whatsapp() && whatsappEntries().some(e=>e.id===id && e.ambiguous);
    const title = list.find(t => t.id === id)?.name || (whatsapp() ? whatsappHeader() : text(first('h2'))) || service;
    const state = list.length || input ? 'ready' : 'unsupported';
    return {service, state, title, threads:list, messages:id ? messages() : [], activeID:id,
      loadingMessages:!!(whatsapp() && recent?.id === id && !recent.ready && Date.now()-recent.started<3000),
      diagnostics:{messageScopes:all('[data-scope="messages_table"]').length,
        semanticMessages:all('[data-ad-rendering-role="text-message"]').length,
        scopedText:all('[data-scope="messages_table"] [dir="auto"]').length},
      canSend:!!(id && input && !ambiguous), detail: state === 'unsupported'
        ? 'Chưa nhận diện được giao diện trang. Mở Kết nối để kiểm tra đăng nhập hoặc trạng thái tab.'
        : (ambiguous ? 'Hội thoại trùng tên: vẫn đọc được tin nhắn, nhưng chức năng gửi đang khóa để tránh nhầm người nhận.'
          : !id && input ? 'Chưa xác định chắc chắn hội thoại đang mở; chức năng gửi đang khóa.' : null)};
  }
  function select(id) {
    threads();
    const target = targets.get(id);
    if (!target?.isConnected) throw Error('Hội thoại không còn trong danh sách. Hãy tải lại.');
    if (!allowed()) throw Error('Trang kết nối không hợp lệ.');
    pendingSelection = {id,previousID:activeID(),fingerprint:whatsapp() ? messageFingerprint() : ''};
    if (location.hostname === 'chat.zalo.me' || whatsapp()) zaloClick(target); else target.click();
    return selectionReady(id);
  }
  const selectionReady = id => {
    if (!allowed() || activeID() !== id) return false;
    if (!whatsapp()) return !!composer();
    if (!document.querySelector('#main header')) return false;
    return !pendingSelection || pendingSelection.id !== id || pendingSelection.previousID === id ||
      !pendingSelection.fingerprint || messageFingerprint() !== pendingSelection.fingerprint;
  };
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
    if (whatsapp() && whatsappEntries().some(e=>e.id===id && e.ambiguous))
      throw Error('Hội thoại trùng tên; không gửi khi chưa xác định chắc chắn người nhận.');
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
      whatsappContentStructure: whatsapp() ? JSON.stringify({
        unsupported:whatsappRows().slice(-50).filter(row=>!richText(outerTextNodes(row)).text && !mediaLabel(row)).slice(0,8).map(row=>({
          testids:unique(rawAll('[data-testid]',row).map(testid)),icons:unique(rawAll('[data-icon]',row).map(e=>e.getAttribute('data-icon'))),
          tags:unique(rawAll('img,video,audio,canvas,button',row).map(e=>e.tagName)),textLength:text(row).length
        })),
        rows:all('#main [data-testid="msg-container"]').slice(-8).map(row=>({
          nodes:all('[data-testid], [data-pre-plain-text], [data-mention], [data-jid]',row).slice(0,35).map(e=>({
            ...describe(e),children:e.children.length,textLength:text(e).length
          }))
        })),
        scroll:all('#main, #main div').filter(e=>e.scrollHeight > e.clientHeight+20 && e.clientHeight>100).slice(0,8).map(e=>({
          ...describe(e),top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight,overflow:typeof getComputedStyle==='function' ? getComputedStyle(e).overflowY : ''
        }))
      }) : '{}',
      whatsappStructure: JSON.stringify({sidebar:all('#pane-side').length, rows:all('#pane-side [role="row"]').length,
        selected:all('#pane-side [aria-selected="true"]').length, headers:all('#main header span[title]').length,
        editors:all('#main footer [contenteditable="true"][role="textbox"]').length,
        messages:whatsappRows().length}),
      threadClasses: unique(all('.conv-item').map(e => e.className)),
      threadAttributeNames: unique(all('.conv-item').flatMap(e => e.getAttributeNames())),
      editorDescriptors: unique(all('[contenteditable], #richInput').map(e => [e.tagName,e.id,e.className,e.getAttribute('role'),e.getAttribute('contenteditable')].join(':'))),
      messageClasses: unique(all('#messageViewContainer [class], .message-view [class]').map(e => e.className).filter(c => /message|msg|bubble|text|time/i.test(c))),
      relevantElementIds: unique(all('[id]').map(e => e.id).filter(id => /^(message|chat|input|rich|conv)/i.test(id))),
      selectedAttributes: unique(all('.conv-item[aria-selected], .conv-item [aria-selected]').map(e => e.getAttribute('aria-selected')))
      ,sendControlDescriptors: unique(all('#chat-box-input-container-id [title], #chatInput [title], [data-id="btnSend"]').filter(e => /gửi|send/i.test(e.getAttribute('title') || '')).map(e => [e.tagName,e.className,e.getAttribute('role'),e.getAttribute('title'),e.getAttribute('data-id')].join(':')))
    };
  }
  return {snapshot, select, selectionReady, beginRecent, recentStep, beginSend, sendStep, expireSend, diagnostics};
})();
