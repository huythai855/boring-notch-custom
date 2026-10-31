# Mốc phát triển — 01/11/2026

Nhánh local: `feature/notch-chat`. Xem commit checkpoint trong `git log`.
Chưa push hoặc tạo GitHub fork. App đang cài: `/Applications/Boring Notch Chat.app`;
app gốc `/Applications/boringNotch.app` được giữ nguyên.

## Trạng thái đã chốt

- Chat native SwiftUI tích hợp trong notch, tab cạnh Home/Shelf; bỏ panel chat tách rời.
- Messenger và Zalo chạy trong daemon WKWebView riêng, không cần VS Code/extension.
- Chọn/đọc/gửi tin nhắn văn bản qua DOM của trang gốc; không sửa UI website.
- Giữ phiên bằng WebKit + cookie local; Messenger đã vượt qua một lần restart thật.
  Không bảo đảm vượt qua hết hạn/thu hồi phiên từ nhà cung cấp.
- Enter gửi, Shift+Enter xuống dòng; tránh gửi lúc IME đang ghép chữ.
- Lọc sender/status/timestamp của Messenger khỏi body khi nhận diện được metadata;
  không loại nội dung thật chỉ vì trùng chuỗi thời gian/trạng thái.
- Zalo dùng `#richInput`, `.conv-item.selected`, `.chat-message`; chọn/gửi chạy ẩn
  nhờ Swift polling, không phụ thuộc timer JavaScript bị WebKit suspend.
- Gửi có kiểm tra đúng hội thoại và bản nháp web; chỉ click một lần, không auto retry.
- Chat cao 380 pt, Home 190 pt. Cửa sổ trong suốt giữ kích thước cố định,
  animate mặt notch 0,24 giây khi đổi tab. Bỏ resize NSWindow bất đồng bộ và
  cập nhật nhạc thừa khi chuyển tab. Người dùng đã xác nhận bản này khá ổn.

## Đã kiểm chứng

- Xcode build arm64, ký ad hoc và `codesign --verify --deep --strict` thành công.
- DOM regression cho Messenger, metadata, Zalo; parser HTTP/RPC local.
- Fixture bàn phím không mạng: Enter, Shift+Enter, draft rỗng.
- Live UI: Home ↔ Chat, focus composer, nhập Unicode tiếng Việt, Escape thu gọn,
  giữ bản nháp khi đổi tab. Bản nháp chỉ ở RAM, không giữ sau quit/restart host.
- Có sự đồng ý riêng của chủ tài khoản: gửi đúng một `Test notch` vào Messenger
  tự nhắn và một `Test notch Zalo` vào Zalo My Documents; đã kiểm tra một bản tin
  mỗi loại. Zalo gửi được khi cửa sổ kết nối bị ẩn. Không dùng lại sự đồng ý này
  như quyền gửi thêm tin thật trong các lần sửa sau.

## Cần nhớ khi sửa tiếp

1. Đọc README trước để build/cài đúng app, tránh chạy bản gốc song song.
2. Sửa host/UI: có thể giữ daemon đang chạy để không ảnh hưởng phiên.
3. Sửa `Tools/ChatDaemon/` hoặc bridge: thoát daemon cũ và thay cả bundle sau build;
   chỉ restart host không nạp bridge mới.
4. Không xóa profile để chữa timeout. Kiểm tra Zalo có cần Kích hoạt không trước.
5. Không tự retry thao tác gửi khi chưa biết kết quả. Kiểm tra hội thoại thật trước.
6. Không commit cookie, discovery token, nội dung hội thoại hoặc ảnh chụp riêng tư.
7. Chiều cao sửa tại `chatNotchSize` trong `boringNotch/sizing/matters.swift`.
   Animation/focus ở `ContentView.swift`. Giữ root top-aligned, không thêm lại
   resize NSWindow trong callback đổi tab.

## Giới hạn / công việc chưa làm

- Đây là adapter DOM thử nghiệm; markup thay đổi có thể làm đọc/gửi lỗi.
- Danh sách và nội dung chỉ là phần trang đã tải, chưa đồng bộ toàn bộ lịch sử.
- Chưa có attachments, calls, reactions, unread badge, delivery receipt đầy đủ.
- Chưa có lưu bản nháp qua restart, push/SSE thay polling, hay client VS Code.
- Chưa xác minh Intel, nhiều màn hình và toàn bộ phiên bản macOS được deployment target hỗ trợ.
- Chưa có DMG/notarization/release công khai riêng; dùng build local.

Không có yêu cầu sửa cụ thể nào còn chờ tại checkpoint này. Lần sau bắt đầu bằng
vấn đề/điều chỉnh mới của người dùng, không tự mở rộng scope.
