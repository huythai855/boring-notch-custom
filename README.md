# Boring Notch Chat — bản fork cá nhân

Chat nhanh Messenger, Zalo và WhatsApp **ngay trong notch**, dùng giao diện SwiftUI native.
Bản fork dựa trên [TheBoredTeam/boring.notch](https://github.com/TheBoredTeam/boring.notch).
Thông tin và credits của dự án gốc giữ tại [README.upstream.md](README.upstream.md); giấy phép giữ nguyên trong [LICENSE](LICENSE).

Mã nguồn fork riêng: [huythai855/boring-notch-custom](https://github.com/huythai855/boring-notch-custom),
nhánh tính năng `feature/notch-chat`. Quy trình đóng gói arm64 nằm ở
nhánh `codex/build-chat-release`.

## Hiện đã có

- Tab **Chat** cạnh Home/Shelf, nằm trong cùng cửa sổ và hình notch.
- Chọn Messenger/Zalo/WhatsApp, chọn hội thoại, đọc và gửi tin nhắn văn bản.
- Messenger/WhatsApp: tên người gửi và avatar mặc định cho tin nhóm; WhatsApp giữ nguyên tag, tách trích dẫn khỏi nội dung trả lời.
- Chuột phải lên nội dung → **Sao chép tin nhắn**.
- Khi chọn hội thoại, tải xuống cuối timeline để đọc tin mới nhất; nút mũi tên xuống cạnh tiêu đề cho phép tải lại.
- Tự khôi phục tiến trình web bị dừng và chọn lại hội thoại, không tự gửi lại tin nhắn.
- Enter để gửi, Shift+Enter để xuống dòng; Enter khi IME còn đang ghép chữ dành cho IME.
- Nhớ tab Home/Shelf/Chat và dịch vụ chat vừa dùng khi mở lại; tự focus ô soạn khi hội thoại sẵn sàng.
- Cuộn trong Chat chỉ cuộn nội dung, không kích hoạt gesture thu gọn notch. Home/Shelf vẫn dùng gesture như trước.
- Phần nhạc bỏ qua nguồn chat/thông báo hệ thống, kể cả WebKit của daemon; tiếng thông báo vẫn phát bình thường.
- Bản nháp riêng theo dịch vụ/hội thoại, giữ khi đổi tab hoặc thu gọn notch trong cùng lần chạy app.
- Chat cao mặc định **380 pt**; chuyển Home ↔ Chat animate **0,24 giây**, giữ khung cửa sổ ổn định.
- Daemon riêng giữ WebView và phiên đăng nhập; không cần bật VS Code hoặc cài extension.
- Bấm **Kết nối** mới mở cửa sổ web để đăng nhập/kích hoạt lại phiên.

Đây là bản thử nghiệm dùng cá nhân. Adapter đọc và thao tác DOM của website gốc,
không gọi Business API, không sửa CSS/giao diện website. Website thay đổi
cấu trúc có thể làm adapter ngừng hoạt động.

## Cách sử dụng

1. Mở **Boring Notch Chat.app**. Chỉ chạy một bản notch tại một thời điểm.
2. Đưa chuột lên notch, chọn biểu tượng **Chat** (hai bong bóng).
3. Chọn **Messenger**, **Zalo** hoặc **WhatsApp**, bấm **Kết nối** nếu chưa đăng nhập.
4. Đăng nhập trực tiếp trong cửa sổ của dịch vụ; nhập mật khẩu/OTP tại đó.
5. Đóng cửa sổ kết nối sau khi đăng nhập: thao tác này chỉ ẩn WebView, không đăng xuất.
6. Chọn hội thoại trên hàng avatar, nhập nội dung rồi bấm gửi hoặc Enter.
7. Escape để thu gọn; Home/Shelf để trở về chức năng khác. Chat giữ mở khi đang nhận focus bàn phím.

Với **WhatsApp**, mở WhatsApp trên điện thoại → **Thiết bị liên kết / Linked devices**
→ **Liên kết thiết bị**, rồi quét mã QR trong cửa sổ Kết nối. Phiên WhatsApp Web
được WebKit giữ riêng trong daemon, không dùng lại phiên của ứng dụng WhatsApp desktop.
Adapter chỉ mở gửi khi xác định được một hàng đang chọn trong sidebar và tiêu đề
hội thoại khớp chính xác. Hội thoại trùng tên vẫn có thể chọn để đọc, nhưng khóa gửi.
Hội thoại đã cuộn khỏi sidebar có thể cần mở cửa sổ Kết nối để xử lý; app sẽ khóa gửi
khi không xác định chắc chắn người nhận. Ảnh, video, nhãn dán và tệp chưa xem trực tiếp
trong notch sẽ có nhãn nội dung thay vì bị bỏ qua; mở Kết nối để xem bản đầy đủ.

Phiên được giữ bằng website storage và cookie local, nhưng dịch vụ vẫn có thể hết hạn
hoặc thu hồi phiên. Bản nháp native hiện **không lưu qua việc thoát/restart app**.

## Yêu cầu build

- macOS 14 trở lên theo deployment target; đã kiểm tra thực tế trên **macOS 26.5.2, Apple Silicon, Xcode 26.5**.
- **Xcode đầy đủ** và Command Line Tools trỏ vào Xcode. CLI tools riêng đủ cho helper,
  nhưng không đủ để build toàn bộ dự án Xcode và asset catalog.
- Internet cho lần tải Swift Package đầu tiên.
- Node.js/npm chỉ cần nếu chạy các bài kiểm tra JavaScript.

Script build tích hợp hiện chọn **arm64**; chưa xác minh bản fork trên Intel.
Không cần tài khoản Apple Developer: bản local ký ad hoc; script tắt Hardened
Runtime cho kiểu ký không có Team ID này để nạp được framework nhúng. App sandbox
và các entitlement của host vẫn được giữ.

```sh
xcode-select -p
xcodebuild -version
```

Nếu đang trỏ vào `/Library/Developer/CommandLineTools`, chọn Xcode đã cài:

```sh
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

Mở Xcode một lần để hoàn thành bước thiết lập nếu cần.

## Build

Chạy tại thư mục repository:

```sh
bash Tools/build-chat-fork.sh
```

Script build/ký `build/Notch Chat Daemon.app` trước, rồi build host bằng Xcode.
Nếu mở dự án bằng Xcode để build thủ công, cũng cần chạy
`bash Tools/ChatDaemon/build.sh` trước vì project nhúng helper từ `build/`.

Log: `build/daemon-build.log` và `build/integrated-build.log`.
Host nằm ở `build/DerivedData/Build/Products/Debug/Boring Notch.app`.
Có thể build cấu hình Release bằng `CONFIGURATION=Release bash Tools/build-chat-fork.sh`.

### Đóng gói Release và build khi máy chưa có Xcode

`bash Tools/package-chat-fork.sh` build Release arm64, xác minh chữ ký host/helper,
rồi tạo ZIP, DMG và `SHA256SUMS.txt` tại `build/packages/`. Mỗi lần đóng gói
cần staging mới; xóa `build/package-stage` của lần trước nếu chạy lại.

Workflow **Build Chat fork (Apple Silicon)** chạy trên GitHub Actions khi push
nhánh `codex/build-chat-release`, không cần Apple Developer secrets.
Tải artifact **Boring-Notch-Chat-arm64**, giải nén để lấy ZIP/DMG.
Bản này ký ad hoc, chưa notarize; nếu macOS chặn bản tải về, cho phép mở trong
**System Settings → Privacy & Security**. Gói cài đặt chỉ chứa app, không kèm
cookie, token RPC hoặc dữ liệu tài khoản local.

## Cài hoặc cập nhật bản local

1. Thoát bản notch đang chạy bằng Quit để tránh hai notch chồng nhau. Bản đóng gói
   mới dùng bundle ID riêng `local.huythai.boringnotch.chat`, với settings/container
   riêng để không xung đột chữ ký của bản gốc.
2. Nếu có sửa helper/`ChatBridge.js`, mở cửa sổ **Kết nối**, chọn menu
   **Notch Chat Daemon → Quit Chat Daemon** trước khi thay app. Helper cũ có thể tiếp tục
   chạy sau khi host đã thoát. Nếu chỉ sửa host/UI, có thể giữ daemon đang chạy.
3. Copy **toàn bộ** sản phẩm Xcode sang `/Applications/Boring Notch Chat.app`.
   Thay đường dẫn nguồn bên dưới bằng thư mục sản phẩm vừa tìm:

```sh
ditto "/đường/dẫn/Build/Products/Debug/Boring Notch.app" \
  "/Applications/Boring Notch Chat.app"
codesign --verify --deep --strict "/Applications/Boring Notch Chat.app"
open "/Applications/Boring Notch Chat.app"
```

Không ghi đè app gốc `/Applications/boringNotch.app`. Fork đã tắt khởi động
Sparkle updater để tránh bản upstream thay mất tính năng chat. Nếu muốn quay lại
bản gốc, thoát fork rồi mở app gốc. Profile không bị xóa khi thay bản build.

## Kiểm tra

Các test dưới đây chạy local, không đăng nhập và không gửi tin nhắn thật:

```sh
mkdir -p build
npm install --prefix build/chat-tests --ignore-scripts --no-audit --no-fund jsdom@26.1.0
node Tests/ChatDaemon/bridge.test.cjs
node Tests/ChatDaemon/messages.test.cjs
node Tests/ChatDaemon/zalo.test.cjs
node Tests/ChatDaemon/whatsapp.test.cjs
node Tests/ChatDaemon/rich-messages.test.cjs
xcrun swiftc -parse-as-library Tools/ChatDaemon/LocalRPC.swift \
  Tests/ChatDaemon/RPCTests.swift -o build/rpc-tests
build/rpc-tests
```

Fixture kiểm tra bàn phím với client giả, không kết nối tài khoản:

```sh
bash Tests/ChatDaemon/build-focus-test.sh
open "build/Notch Focus Test.app"
```

Sau khi sửa UI, kiểm tra thêm trên bản thật: Home ↔ Chat, thu gọn/mở lại,
gõ tiếng Việt, giữ bản nháp khi đổi tab, Enter/Shift+Enter trong fixture.
Nếu kiểm tra gửi thật, dùng hội thoại của chính mình và kiểm tra kết quả trước khi gửi lại.

## Lỗi thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| Zalo yêu cầu kích hoạt hoặc ngừng cập nhật | Kết nối → **Kích hoạt**. Zalo có thể tạm dừng khi tab khác hoạt động hoặc để lâu. |
| Chưa đăng nhập/hết phiên | Mở Kết nối và đăng nhập lại tại website. |
| Timeout khi gửi | Kiểm tra hội thoại trong cửa sổ web trước. App không tự gửi lại vì có nguy cơ trùng tin. |
| Website đã có bản nháp khác | Mở Kết nối, xử lý bản nháp web trước; daemon không ghi đè bản nháp khác. |
| Sửa bridge nhưng hành vi vẫn cũ | Thoát daemon cũ, build lại, thay toàn bộ app rồi mở lại. |
| Thiếu Chat Daemon hoặc build resource không tồn tại | Chạy `bash Tools/build-chat-fork.sh`, không chỉ build host. |
| Không gõ được/chữ vào app khác | Chọn tab Chat và click ô nhập; kiểm tra đang chạy đúng bản fork mới. |
| Website đổi markup, không đọc/chọn/gửi được | Kiểm tra adapter tại `Tools/ChatDaemon/ChatBridge.js`; đừng thêm cơ chế tự retry gửi. |

## Kiến trúc và nơi sửa code

```text
Tab Chat / SwiftUI → ChatDaemonClient → HTTP RPC local có token
                                         ↓
                               Notch Chat Daemon
                                         ↓
                         WKWebView + DOM adapter riêng
                             Messenger / Zalo / WhatsApp
```

| Thành phần | File |
| --- | --- |
| Giao diện, composer, Enter/Shift+Enter | `Shared/Chat/NativeChatView.swift` |
| Client RPC, polling, bản nháp trong RAM | `Shared/Chat/ChatDaemonClient.swift` |
| DTO và đường dẫn dữ liệu | `Shared/Chat/ChatProtocol.swift` |
| Entry point menu/notification, không tạo panel riêng | `Shared/Chat/ChatPanelController.swift` |
| Nhúng Chat, animation, focus cửa sổ | `boringNotch/ContentView.swift` |
| Chiều cao mặc định | `chatNotchSize` trong `boringNotch/sizing/matters.swift` |
| Tab và model kích thước | `boringNotch/components/Tabs/`, `boringNotch/models/BoringViewModel.swift` |
| DOM selector, nội dung tin, thao tác chọn/gửi | `Tools/ChatDaemon/ChatBridge.js` |
| WebView, polling gửi/chọn bằng Swift | `Tools/ChatDaemon/DaemonWebSession.swift` |
| HTTP parser và bảo vệ RPC | `Tools/ChatDaemon/LocalRPC.swift` |
| Cookie phiên local | `Tools/ChatDaemon/SessionCookies.swift` |

Chi tiết kỹ thuật và các lần kiểm chứng: [docs/chat-daemon.md](docs/chat-daemon.md).
Mốc để tiếp tục lần sau: [docs/development-checkpoint.md](docs/development-checkpoint.md).
`Tools/ChatProbe` là công cụ thử riêng, không phải UI chính tích hợp notch.

## Dữ liệu và giới hạn

- RPC chỉ lắng nghe `127.0.0.1`, port ngẫu nhiên, bearer token mỗi lần daemon chạy;
  từ chối browser Origin. Không có server cloud riêng của fork.
- Discovery: `~/.local/share/notch-chat-daemon/endpoint/daemon.json`.
- Cookie phiên: `~/.local/share/notch-chat-daemon/profile/session-cookies.plist`.
  Thư mục 0700, file 0600; đây là dữ liệu nhạy cảm, **không commit/chia sẻ**.
- WebKit còn giữ website storage riêng của daemon. Cookie không đi qua RPC.
- Chỉ đọc các hội thoại/tin nhắn website đã tải; chưa hỗ trợ toàn bộ lịch sử,
  file đính kèm, gọi điện, reactions, badge thông báo hay delivery receipt đầy đủ.
- Thao tác gửi thành công xác nhận website đã nhận thao tác, không bảo đảm người nhận đã nhận/đọc.
- `build/` chứa artifact, log và ảnh kiểm tra cá nhân, được Git ignore.
