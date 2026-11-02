# Local chat daemon architecture

```text
Messenger / Zalo / WhatsApp web (unmodified)
          ↕ DOM adapter in an isolated WKContentWorld
Notch Chat Daemon.app (separate process, owns persistent WKWebViews)
          ↕ authenticated loopback RPC
Boring Notch (native SwiftUI chat client)

Future optional client: VS Code extension
```

VS Code and browser extensions are not runtime dependencies. The referenced
author's implementation is unknown; this is this fork's implementation.

## Lifecycle and sessions

The host starts the embedded daemon with LaunchServices on first opening Chat.
The daemon survives collapsing the notch and quitting the host. It exits on logout,
reboot, or Quit Chat Daemon. The next host client restarts it when required.
There is no LaunchAgent or extra login item. The host's existing login setting
still controls whether Boring Notch itself starts at login.

Only the daemon owns WebKit, cookies, and website storage. The native notch
client has no browser. Each service has one retained web view. Closing a
connection window moves its renderer behind the desktop, outside all screens,
preserving a visible WebKit viewport for lazy timeline mounting without displaying
a second chat UI. Opening Connection restores the saved on-screen frame. Full daemon
restarts restore cookies with their original expiry from an app-local 0600 file,
including session-only cookies that WebKit otherwise discards. The containing
directory is 0700. Cookie properties never go over RPC or into logs. This does
not override server revocation or expiry, and browser storage still belongs to
WebKit. This new bundle has its own website data;
existing credentials are not copied from the old host/probe.

## Local RPC

The listener binds IPv4 `127.0.0.1` on an ephemeral port. Its discovery file is
`~/.local/share/notch-chat-daemon/endpoint/daemon.json`. The sandboxed host has a
narrow read-only home-relative exception for that endpoint directory only.
Private cookies are in the separate `profile/` directory, outside that exception.
Directories are mode 0700, files 0600. Discovery holds the port, a random 256-bit
per-process bearer token, and PID. Do not publish this file or print its token.

Requests: `POST /rpc`, JSON `operation`, `service`, optional `threadID`, `text`.
Supported operations: `snapshot`, `login`, `select`, `recent`, `send`, `diagnostics`. Service values:
`Messenger`, `Zalo`, `WhatsApp`. Responses: `ok`, optional `snapshot`, `error`, `diagnostics`. Diagnostics expose bounded structural metadata, not message bodies or cookie values. Snapshots
contain the loaded conversation list, selected thread, and loaded text messages;
they are kept in memory, not logged. Browser Origin headers are rejected. There
is no CORS allowance, arbitrary JavaScript execution endpoint, private messaging
API, cookie export, remote backend, or CSS modification.

The client polls while running; this initial implementation is not a push/SSE
subscription. Only loaded/virtualized website conversations and messages are
available, not full account history.

## Sending

The daemon checks the selected conversation against the requested ID, refuses to
overwrite a different preexisting web draft, and places text through DOM Selection
and the real website composer. An identical existing draft can be submitted on
an explicit retry without adding its text twice. It yields for React/Lexical to
render the send button, scopes discovery to the composer toolbar, rechecks the
conversation, and clicks exactly once. It then awaits a cleared original composer
or a new outgoing echo. It does not retry an ambiguous click/timeout. This
confirms UI submission, not recipient delivery. JavaScript error messages are
returned to the client and action errors survive background snapshot refreshes.
Unrecognized provider markup fails closed and is surfaced in the native client.

DOM adapters are provider-specific and still require validation against live
authenticated pages. This is a text-only initial implementation; attachments,
calls, reactions, complete history, accurate delivery receipts, and notification
badges are not implemented.

## Build and checks

```sh
bash Tools/build-chat-fork.sh
node Tests/ChatDaemon/bridge.test.cjs
npm install --prefix build/chat-tests --ignore-scripts --no-audit --no-fund jsdom@26.1.0
node Tests/ChatDaemon/messages.test.cjs
node Tests/ChatDaemon/zalo.test.cjs
node Tests/ChatDaemon/whatsapp.test.cjs
node Tests/ChatDaemon/rich-messages.test.cjs
xcrun swiftc -parse-as-library Tools/ChatDaemon/LocalRPC.swift \
  Tests/ChatDaemon/RPCTests.swift -o build/rpc-tests
build/rpc-tests
```

The build script builds and ad-hoc signs the daemon before Xcode embeds it as an
app resource. Old WebView-host build is backed up at
`build/Backups/Boring Notch Chat WebView.app`. The upstream original remains at
`/Applications/boringNotch.app`.

## WhatsApp adapter

WhatsApp opens `https://web.whatsapp.com/` in its retained WebKit view. Link it
from the phone's Linked devices screen; desktop-app credentials are not imported.
Its user agent includes the Safari Version token for this OS's WebKit baseline;
WhatsApp otherwise rejects the default WKWebView UA as an obsolete Safari.
The persistent website store retains IndexedDB/local storage, and the cookie
allowlist also includes `whatsapp.com`. Neither QR payloads nor cookies are
included in RPC diagnostics.

The adapter reads loaded `#pane-side` rows and the active `#main` message DOM,
including rows whose layout WebKit skips outside the viewport. It preserves the
outer rich-text body and complete inline mentions. Quoted content is a separate
reply model; sender headers, timestamps, receipts, and reactions are excluded from
the body. Incoming group messages carry the actual author name and use a native
default avatar. Supported media types have explicit placeholders when no text is
present.

Native message bodies use one attributed string and an explicit context-menu copy
action. Per-bubble SwiftUI text-selection overlays can enter an AppKit update loop
with rich messages on macOS 26.3. The client also compares snapshots before
publishing unchanged polling results to avoid needless layout and selection work.

Selection waits for the header and sidebar to agree and for the old conversation's
message fingerprint to change. It then scrolls the message timeline to its end and
waits for stable rows using native polling. Hidden connections follow the latest
messages; an explicitly opened Connection window retains manual scrolling. The
native latest-messages button invokes `recent`. This loads the website's current
timeline, not a complete account-history export.

Sending requires exactly one selected sidebar row with a unique normalized name
matching the conversation header, plus one editor in `#main footer`. Duplicate
labels get separate per-row read identities but sending stays locked. Missing
selection, recycled rows, mismatched headers, and ambiguous send controls fail
closed. Read-only conversations can be read without a composer. The send control uses its semantic label or send icon, scoped to the
footer. Commands use the same native polling and one-click acknowledgement flow
as the other providers; no website timers or undocumented messaging APIs. A
terminated WebContent process reloads with bounded recovery attempts and restores
the selected conversation using the existing website store; recovery never sends
or retries messages.

The WhatsApp regression fixture covers QR login, incoming/outgoing text and emoji,
selection transitions, duplicate labels, existing drafts, stale targets, and
ambiguous sends. Fixture coverage does not replace authenticated live validation
against the current WhatsApp markup; sending a real message needs a separate user
instruction identifying the conversation and message.

## Authenticated validation (Messenger)

After the owner signed in, the first adapter read 25 Messenger conversations
and the composer, but zero messages. Its message selector incorrectly depended
on an optional text-message marker. The current adapter scopes text to message
tables and removes nested duplicate spans. DOM regression tests cover that
case and exclude sidebar previews/composer drafts. The updated adapter read
25 conversations and 27 loaded messages from the authenticated account. Choosing
a conversation from the native avatar row worked; the notch accessibility tree
contains native message/composer controls and no HTML content.

A separate daemon restart was performed after cookie persistence was added.
The client reconnected and read the 25 conversations without signing in again;
selecting a conversation loaded its messages again. This verifies one real
restart, not immunity to provider expiry/revocation. Outgoing message direction
also checks Messenger's accessible sender labels, with rendered alignment as a
fallback for groups with omitted repeated labels.

The final installed adapter also read 16 messages with 7 outgoing in a live
two-way conversation; the native UI visibly rendered blue outgoing and gray
incoming bubbles. After the final update both processes reconnected with the
existing authenticated session. Cold LaunchServices startup can take several
seconds; the client keeps retrying rather than asking for login during startup.
Evidence: `build/evidence/native-messenger-verified.png` (private local UI capture,
ignored by Git).

With the owner's explicit permission, exactly one `Test notch` message was sent
from the native notch Send button to the owner's self-conversation. The live web
snapshot showed exactly one new outgoing match and Messenger's `Đã gửi` label;
the native composer cleared. The preexisting native draft was retained for
restoration. Evidence: `build/evidence/send-fixed-self-test.png`.
Zalo's authenticated adapter and background native sending were subsequently verified; see the Zalo section below.

## Keyboard focus fix (historical standalone panel)

The chat editor now uses an activating borderless panel, explicitly activates
the host before taking key focus, and requests composer focus when opened or
after choosing a conversation. The original nonactivating style could leave the
keyboard/input-method context with the previously active application. The
upstream hover notch remains nonactivating; only the chat editor takes focus.

Verified using real keystrokes (`xin`) and Unicode paste (` chào, tiếng Việt`)
in the real authenticated native composer. The draft and field focus survived
live snapshot refreshes. The test draft was cleared without sending a message.
Evidence: `build/evidence/composer-focus-fixed.png`. A standalone UI fixture
(`Tests/ChatDaemon/build-focus-test.sh`) reuses the production composer view with
networking and sending stubbed out.

During this fix the daemon was found blocked in `chmod` on the old host-container
directory. The shared discovery/profile data was moved out of protected app
containers; the old private session file was not automatically migrated and the
owner signed in again. IPC startup is now explicit and idempotent. The host
sandbox remains enabled. Host-only reinstalls preserve the running daemon bundle
and re-sign the host so keyboard/UI changes need not restart the service.

## Enter/Shift-Enter

The native composer handles Return explicitly: plain Enter submits through the
same send action as the button, Shift-Enter inserts a newline without committing
the field, and empty drafts are ignored. Marked IME text is left to the input
method for confirmation. The local UI fixture verified a single submission on
Enter, no submission on Shift-Enter, a multiline submission on the next Enter,
and no submission from an empty composer. No additional real messages were sent
for this keyboard regression check.

## Content-only bubbles

Messenger extraction excludes sender headings, timestamp elements, receipt/status
roles, and standalone receipt/clock labels outside painted message bubbles.
It does not remove matching text from a genuine message body. Regression tests
cover nested sender labels, unlabelled receipt spans, clock-only rows, outer
aria-live conversation regions, and literal status/time strings inside messages.
On the live conversation the earlier snapshot included 13 sender labels, one
sent-status line, and two clock-only lines. The installed filter returned actual
message content with zero such metadata lines, confirmed visually. No messages
were sent or edited on the service while checking this change.


## Zalo background operations

Zalo uses `.conv-item.selected`, `#richInput`, and text bodies beneath
`#messageViewContainer .chat-message`. The editor remains discoverable when its
contenteditable attribute changes on blur. Custom controls receive one pointer
sequence, and only the exact send control is accepted (never the quick reaction).

Selection and sending use synchronous bridge steps polled by Swift Task.sleep.
Hidden WKWebViews can suspend page timers even with inactive scheduling disabled;
no operation now depends on JavaScript setTimeout. A send transaction records its
click before dispatch and refuses an unconfirmed retry. Existing web drafts are
protected, and errors remain visible across snapshot refreshes.

Verified on the installed build with the connection window hidden: authenticated
snapshot returned 13 threads; selecting My Documents completed in 0.03 seconds.
With the owner's explicit consent, the native Send button submitted exactly one
“Test notch Zalo” to My Documents. A subsequent snapshot contained exactly one
matching message and the native composer cleared. No other real test messages
were sent. Bridge tests run with page timers disabled, alongside Zalo DOM and
message-extraction regression tests. Full Xcode build and signature checks passed.

Zalo may suspend a web session when another tab is active or after inactivity.
Open Kết nối and choose Kích hoạt to resume the same authenticated session.


## Chat inside the notch

Chat is now a standard tab beside Home and Shelf, rendered directly by
ContentView inside the existing BoringNotchSkyLightWindow. The old standalone
Chat panel has been removed. The notch expands to 380 points tall for chat and
returns to its standard size for Home/Shelf. The same notch shape, header,
transitions, hover opening, and Escape dismissal are reused.

Only the open Chat tab enables key-window status and removes nonactivatingPanel;
it activates the host for text input and restores the previous application on
exit when appropriate. Chat stays open while it holds keyboard focus, then
closes on focus loss outside the notch. Drafts live in the shared client so tab
changes and collapsing the notch do not discard them. Connection/login remains
a separate daemon window opened explicitly by Kết nối.

Live UI validation: Chat and Home rendered in the same notch window, Home
restored the original height, a typed draft survived switching Home → Chat,
Unicode paste preserved Vietnamese text, and Escape collapsed the notch. The
test draft was cleared without sending any additional real message.


## Compact chat and tab transitions

Chat height was reduced from 500 to 380 points. The transparent NSPanel now
keeps a constant backing size with the SwiftUI surface aligned to its top.
Previously a tab change updated ContentView's frame limit immediately, then an
async NSViewRepresentable callback resized/repositioned NSWindow, while an
onChange callback called open() to change the notch size again and refresh music.
These independent layout passes overlapped the tab animation.

The visual height now derives directly from the selected tab in the same render
pass and animates over 0.24 seconds. The view-model bookkeeping no longer calls
open()/MusicManager for tab changes; open() is also idempotent while already open.
No NSWindow frame mutation occurs on a tab change. Keyboard activation remains
separate from layout. Live verification covered repeated Home/Chat transitions,
standard Home height, compact Chat height, and the focused native composer.
Full Xcode build, ad-hoc signature verification, and diff whitespace check passed.
No real messages were sent for this change.
