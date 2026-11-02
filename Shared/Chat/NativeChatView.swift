import SwiftUI
import AppKit

/// A native client of the local daemon. The notch process owns no WKWebView.
struct ChatWorkspace: View {
    @ObservedObject private var client = ChatDaemonClient.shared
    @FocusState private var composerFocused: Bool
    private var draftKey: String { client.service.rawValue + ":" + (client.snapshot.activeID ?? "") }
    private var draft: Binding<String> {
        let key = draftKey
        return Binding(get: { client.drafts[key] ?? "" }, set: { client.drafts[key] = $0 })
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                ForEach(ChatService.allCases) { service in
                    Button { client.choose(service) } label: {
                        Text(service.rawValue)
                            .font(.system(size: 12, weight: .semibold))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(client.service == service ? Color.white.opacity(0.18) : .clear, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(client.sending || client.selecting)
                }
                Spacer()
                Button("Kết nối") { client.openConnection() }
                    .font(.caption)
                    .help("Mở phiên web của daemon để đăng nhập hoặc kiểm tra kết nối")
            }
            .padding(.horizontal, 14).padding(.bottom, 10)

            if !client.snapshot.threads.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(client.snapshot.threads) { thread in
                            Button { Task { await client.select(thread) } } label: {
                                VStack(spacing: 5) {
                                    avatar(thread)
                                        .overlay(Circle().stroke(client.snapshot.activeID == thread.id ? Color.accentColor : .clear, lineWidth: 2))
                                    Text(thread.name).font(.system(size: 10)).lineLimit(1).frame(width: 52)
                                }
                            }
                            .buttonStyle(.plain)
                            .help(thread.name + (thread.preview.isEmpty ? "" : "\n" + thread.preview))
                            .disabled(client.selecting || client.sending)
                        }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 8)
                }
                Divider().overlay(.white.opacity(0.1))
            }

            if let error = client.error {
                Text(error).font(.caption).foregroundStyle(.orange).padding(10)
            }
            if let detail = client.snapshot.detail {
                Text(detail).font(.caption).foregroundStyle(.secondary).padding(10)
            }

            if ["login", "connecting", "unsupported", "inactive"].contains(client.snapshot.state) {
                Spacer()
                Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 32)).foregroundStyle(.secondary)
                Text(client.snapshot.state == "login" ? "Đăng nhập \(client.service.rawValue) trong daemon" : client.snapshot.state == "inactive" ? "Kích hoạt lại phiên Zalo" : "Kết nối với \(client.service.rawValue)")
                    .font(.subheadline).padding(.top, 8)
                Button("Mở cửa sổ kết nối") { client.openConnection() }.padding(.top, 8)
                Spacer()
            } else {
                HStack {
                    Text(client.snapshot.title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                    Spacer()
                    if client.selecting || client.sending { ProgressView().controlSize(.mini) }
                    Button { Task { await client.refreshRecent() } } label: {
                        Image(systemName: "arrow.down.to.line")
                    }
                    .buttonStyle(.plain)
                    .help("Tải tin nhắn mới nhất")
                    .disabled(client.snapshot.activeID == nil || client.selecting || client.sending)
                }
                .padding(.horizontal, 16).padding(.top, 10)
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            if client.snapshot.messages.isEmpty {
                                Text(client.snapshot.loadingMessages == true ? "Đang tải tin nhắn mới nhất…" : client.snapshot.activeID == nil ? "Chọn một cuộc trò chuyện ở trên." : "Chưa có tin nhắn văn bản được tải từ trang web.")
                                    .font(.caption).foregroundStyle(.secondary).padding(.vertical, 20)
                            }
                            ForEach(client.snapshot.messages) { message in
                                ChatMessageBubble(message: message)
                                .id(message.id)
                            }
                            Color.clear.frame(height: 1).id("bottom")
                        }
                        .padding(14)
                    }
                    .defaultScrollAnchor(.bottom)
                    .onChange(of: client.snapshot.messages.last?.id) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
                    .onChange(of: client.snapshot.activeID) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }

            HStack(alignment: .bottom, spacing: 10) {
                TextField("Tin nhắn…", text: draft, axis: .vertical)
                    .focused($composerFocused)
                    .onKeyPress(.return, phases: .down) { key in
                        // Enter must finish an IME composition before it can send.
                        let editor = NSApp.keyWindow?.firstResponder as? NSTextView
                        guard editor?.hasMarkedText() != true else { return .ignored }
                        if key.modifiers.contains(.shift) {
                            editor?.insertNewlineIgnoringFieldEditor(nil)
                            return .handled
                        }
                        guard key.modifiers.intersection([.command, .control, .option]).isEmpty else { return .ignored }
                        send()
                        return .handled
                    }
                    .lineLimit(1...4).textFieldStyle(.plain)
                    .padding(10)
                    .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 13))
                    .disabled(!client.snapshot.canSend || client.sending || client.selecting)
                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 27))
                }
                .buttonStyle(.plain)
                .help("Gửi tin nhắn")
                .disabled(!client.snapshot.canSend || client.sending || client.selecting || draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(12)
        }
        .onAppear { client.start(); focusComposerIfReady() }
        .onReceive(NotificationCenter.default.publisher(for: .chatComposerFocusRequested)) { _ in
            focusComposerIfReady()
        }
        .onChange(of: client.snapshot.canSend) { _, _ in focusComposerIfReady() }
        .onChange(of: client.selecting) { _, selecting in
            if !selecting { focusComposerIfReady() }
        }
        .onChange(of: client.sending) { _, sending in
            if !sending { focusComposerIfReady() }
        }
    }

    private func focusComposerIfReady() {
        guard client.snapshot.canSend, !client.sending, !client.selecting else { return }
        composerFocused = true
    }

    @ViewBuilder
    private func avatar(_ thread: ChatThread) -> some View {
        ZStack {
            Circle().fill(.white.opacity(0.13))
            Text(String(thread.name.prefix(1)).uppercased()).font(.headline)
            if let raw = thread.avatar, let url = URL(string: raw), url.scheme == "https" {
                AsyncImage(url: url) { image in image.resizable().scaledToFill() }
                    placeholder: { Color.clear }
            }
        }
        .frame(width: 40, height: 40).clipShape(Circle()).padding(2)
    }

    private func send() {
        guard let id = client.snapshot.activeID, client.snapshot.canSend,
              !client.sending, !client.selecting else { return }
        let key = draftKey
        let text = client.drafts[key] ?? ""
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        Task {
            if await client.send(text, expectedID: id), client.drafts[key] == text { client.drafts[key] = "" }
        }
    }
}

private struct ChatMessageBubble: View {
    let message: ChatMessage

    private var sender: String? {
        guard !message.outgoing, let name = message.senderName, !name.isEmpty else { return nil }
        return name
    }

    private var senderColor: Color {
        let colors: [Color] = [.pink, .mint, .cyan, .orange, .purple]
        let value = (message.senderName ?? "").utf8.reduce(UInt32(2166136261)) { ($0 ^ UInt32($1)) &* 16777619 }
        return colors[Int(value % UInt32(colors.count))]
    }

    private var bodyText: Text {
        guard let runs = message.runs, runs.map(\.text).joined() == message.text else { return Text(message.text) }
        return runs.reduce(Text("")) { result, run in
            result + (run.mention
                ? Text(run.text).foregroundColor(message.outgoing ? .white : .mint).fontWeight(.semibold)
                : Text(run.text))
        }
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 7) {
            if message.outgoing { Spacer(minLength: 45) }
            if let sender {
                Text(String(sender.prefix(1)).uppercased())
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(senderColor)
                    .frame(width: 26, height: 26)
                    .background(senderColor.opacity(0.18), in: Circle())
                    .accessibilityLabel("Avatar mặc định của \(sender)")
            }
            VStack(alignment: .leading, spacing: 5) {
                if let sender {
                    Text(sender)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(senderColor)
                        .lineLimit(1)
                }
                if let reply = message.reply {
                    HStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 1).fill(senderColor).frame(width: 2)
                        VStack(alignment: .leading, spacing: 2) {
                            if let name = reply.senderName, !name.isEmpty {
                                Text(name).font(.system(size: 10, weight: .semibold)).foregroundStyle(senderColor)
                            }
                            Text(reply.text).font(.system(size: 11)).lineLimit(3)
                        }
                        .padding(.vertical, 5)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 7)
                    .background(.black.opacity(0.12), in: RoundedRectangle(cornerRadius: 7))
                }
                bodyText.font(.system(size: 13)).textSelection(.enabled)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(message.outgoing ? Color.accentColor : Color.white.opacity(0.12),
                        in: RoundedRectangle(cornerRadius: 15))
            if !message.outgoing { Spacer(minLength: 45) }
        }
    }
}
