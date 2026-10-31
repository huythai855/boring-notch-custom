# Standalone chat probe

UI chính ở tab Chat bên trong notch. Tool này là một client SwiftUI độc lập
để kiểm tra adapter/daemon mà không cần build toàn bộ Xcode host.
Nó dùng chung `ChatWorkspace`, RPC và profile với daemon của bản tích hợp.
Không chạy probe song song khi đang thao tác gửi/chọn hội thoại trong notch.

```sh
bash Tools/ChatProbe/build.sh
open "build/Notch Chat Probe.app"
```

Helper và probe có thể build bằng macOS Command Line Tools. Host notch đầy đủ
vẫn cần Xcode. Chọn dịch vụ rồi bấm Kết nối để đăng nhập trong daemon; cửa sổ
probe hiển thị chat native, không nhúng hoặc chỉnh giao diện website.

Mở/đóng probe không đăng xuất daemon. Nếu cần kiểm tra bridge mới, thoát daemon
cũ trước khi chạy helper vừa build. Không dùng tool này làm bằng chứng rằng
animation/focus/tích hợp trong notch đã hoạt động; các phần đó cần kiểm tra host.

Trước khi thử gửi thật, dùng hội thoại của chính mình, thống nhất nội dung thử
và kiểm tra kết quả trước khi gửi lại. Fixture bàn phím không gửi thật nằm tại
`Tests/ChatDaemon/build-focus-test.sh`.

Kiến trúc: [chat-daemon.md](chat-daemon.md). Hướng dẫn chính: [README](../README.md).
