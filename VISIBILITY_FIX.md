# Visibility fix: 3.9.15

## 3.9.15 theme-compatible controls

- Removed quick-button appearance overrides (including minimum width/height,
  font, border, background and padding). Its native QR/menu classes now receive
  the user's theme styles. Only touch gesture behavior is retained.
- The supplied theme expands the QR bar only while send_textarea is focused.
  Primary pointerdown now prevents default focus transfer, allowing a hold
  without collapsing the bar. Keyboard activation remains available.
- The quantity picker is mounted under body, outside any QR opacity/overflow
  ancestors, and uses a manual popover where supported (fixed-position fallback
  otherwise). It does not autofocus the numeric field. Cleanup removes it and
  outside-click detection includes both button and detached picker.
- 31 local tests pass. Added coverage for focus-preserving pointerdown, detached
  picker interaction and cleanup. Real mobile theme/touch behavior is not
  verified; the previous browser-launch limitation remains. Theme JSON and
  chat visibility logic were not modified.

## 3.9.14 QR placement

- The previous control was inserted before send_form, outside the actual QR
  surface, and mounted only once. It could be obscured by an input-form theme
  or lost when the input surface was replaced.
- The supplied stage script declares Tavern Helper script buttons. Its host
  places them inside send_form's qr--bar (or a combined qr--buttons group):
  https://github.com/N0VI028/JS-Slash-Runner/blob/main/src/panel/script/use_button_destination_element.ts
- Hide now joins that same existing QR surface, with its own direct manual-hide
  handler and long-press picker. No script import or QR configuration is needed.
  A fallback QR bar is created only when no bar exists; other plugins' controls
  are never removed. An input-shell-only DOM observer repairs placement after
  QR/group/form replacement, without scheduling visibility checks or chat saves.
- Added mounting regression coverage for late QR creation, combined groups,
  repeated reconciliation, removal, form replacement and cleanup. All 30 local
  model/controller/mounting tests pass. Browser tests now assert QR placement
  and rebuilding, but Edge again failed during launch (crashpad pipe error);
  actual mobile theme appearance remains unverified.
- Visibility ownership and existing historical flags are unchanged.

## 3.9.13 quick-button interaction

- The plugin-owned 隐藏楼层 button now lives in its own quick-action row directly
  above the chat input form. The old manual action is removed from the wand menu;
  the existing Hide Helper settings entry remains.
- Tap immediately hides the last two message IDs. Hold for 500ms opens a small
  picker with 1/2/4/6 presets, minus/plus, and confirm. Only explicitly tapping
  the numeric field enables text entry. Each opening defaults to two; custom
  counts do not change the next tap's behavior.
- Long-press release cannot also trigger tap. Movement over 12px, pointer cancel,
  window blur, outside tap and Escape cancel the relevant interaction.
- All actions use the same manual-ownership function and snapshot guards as the
  previous fixes. No separate QR/script import or input popup is needed.
- Verification: 26 model tests plus 3 event-controller tests pass:
  node --test tests/visibility.cjs tests/manual-hide-controls.cjs
- A Playwright mobile/desktop interaction and screenshot test is included at
  tests/manual-hide-ui.cjs (requires playwright; HH_TEST_BROWSER can specify a
  Chromium executable, HH_TEST_SCREENSHOTS an optional output directory).
  The local Edge process failed to launch in this environment, so browser
  screenshots and real-device layout have NOT been verified.
- Added native-style regenerate/Continue retries for N=1/4/10, including newly
  created AI messages with no is_system field. These simulations pass, but the
  original hidden-after-regenerate transition was not reproduced.
- The supplied JSONL's final message had is_system=true, helper mode=none,
  and bbs_omit/bbs_omit_hidden=true. The user's ST-BaiBai-Book fork explicitly
  hides omitted floors in setFloorOmit/setFloorsOmit and its hiding pass.
  This identifies a compatible external hiding path, not proof of how the
  latest message acquired the omit flag. The user reports changing that plugin.
  No private chat text is included in this repository or its tests.
- Regression tests now exercise the built-in action through floors 121-200,
  a window with fewer than N eligible messages, hiding every floor, reload,
  refill by new messages, extra replacement and independent historical shows.
  Manual hides never fill the quota; N is a recent eligible-message window,
  not a required minimum visible count. No historical flags are cleared.
- Existing unexplained external hides remain conservative. Reapplying the
  built-in action records explicit intent for its selected latest IDs, but does
  not retroactively classify every historical external hide as manual.

## 3.9.12 follow-up

- Added one built-in "隐藏楼层" button next to Hide Helper in the input wand menu.
  It opens the native input popup with default 2, accepts a positive integer,
  and directly records the last N message IDs as manual hides. No separate
  Tavern Helper script or QR import is required. Already-hidden IDs in the
  selected range also become explicit manual hides.
- Cancel and invalid input do nothing. A chat switch, inserted/deleted message,
  or array replacement while the popup is open cancels the action. Concurrent
  clicks cannot open multiple dialogs. Explicit hiding works with auto-hide off.
- Floor ownership is stored in message.hideHelperVisibility, outside extra.
  SillyTavern 1.19.0 syncSwipeToMes restores extra from swipe_info, which could
  erase a manual hide or revive a superseded old hide. Legacy flags are adopted
  conservatively once; extra remains a compatibility mirror. No historical
  manual hide is automatically discarded and no message text is changed.
- Both extra-replacement failures were reproduced before this follow-up fix.
  Added tests cover persistence, ordinary USER/AI generation after manual hiding,
  popup count/cancel validation, stale-chat rejection, and duplicate clicks.
  Current result: 23 local tests passed. No real mobile instance was exercised.
- The supplied Mini Stage JSON loads a mutable remote script. The version
  fetched on 2026-11-14 reports 3.8.3 and its hideLastPair button uses
  setChatMessages(is_hidden=true), bypassing native /hide and this plugin's
  manual records. Use the built-in Hide Helper button instead. The original
  remote script was not modified.
  Source: https://cdn.jsdelivr.net/gh/Sanjs333/stage/stage.js
- This identifies an unsupported entry path, not proof of every reported
  ordinary-generation failure. Old false manual markers cannot be safely
  distinguished from genuine ones; explicitly Unhide confirmed false positives.

The following sections document the preceding 3.9.11 work.

## Confirmed defects in 3.9.10

- getKeepVisibleIndices used the size of the manual-show set as the recent-message
  counter. Running the original HEAD code with N=4, 102 messages and explicit
  shows at floors 10/20/30/40 returned only [10,20,30,40]. Neither latest message
  was retained.
- observeMessageVisibility installed an is_system accessor on native message
  objects. An ordinary external assignment, including a repeated value, created
  a permanent manual override and requested a save. This was reproduced against
  the original HEAD code.
- syncManualVisibilityOverrides inferred manual intent from unexplained hidden
  states. No user action was required.
- runFullHideCheck treated DOM repairs as data changes, causing redundant saves.
- Every descendant element insertion/removal scheduled multiple full checks.
  Timer callbacks had no chat identity guard, followed by another debounce.
- The generation interceptor invoked a live-chat check and cleared flags on
  shared message objects. A request-array shallow copy did not isolate extra.
- manifest.json did not register the interceptor. It was not automatically called
  by the standard SillyTavern extension dispatcher.

## Changes

- The recent N counter is separate from the manual-show set. The result is the
  union of recent eligible messages and explicit manual shows. A recent manual
  show is counted once; a historical manual show is an additional exception.
- Removed native-object accessors. Only explicit Hide/Unhide button handlers and
  native /hide or /unhide commands record overrides. The existing native command
  callback, range parser, name filter and return value are retained. Explicit
  commands issued by scripts are recorded as command intent, not proof of a
  human click. Third-party replacement commands are not wrapped.
- Plain external/native assignments never create manual flags. Unknown hidden
  messages remain hidden without becoming permanent manual overrides.
- Existing manual flags retain priority. Source metadata is added only for new
  explicit actions. Synchronization writes only actual value changes.
- DOM observation only repairs visibility attributes when message roots appear.
  Streaming text and theme metadata do not schedule model changes or saves.
- Data-event checks coalesce into one chat-scoped timer. Chat switches cancel it,
  and array identity, chat ID and epoch are checked before execution.
- MESSAGE_SENT and GENERATION_AFTER_COMMANDS perform checks before native prompt
  construction. Other message/edit/swipe/end events retain scheduled checks.
- Request filtering uses a snapshot, never truncates live chat, and clones the
  message/extra fields it modifies. Prompt-only text and swipe payloads are not
  regenerated from raw chat. The interceptor is registered in manifest.json.
- Global/character/group setting lookup, UI and statistics were not redesigned.
  N is always read from the existing effective configuration.

## Compatibility and recovery

No automatic JSONL migration, mass flag deletion or mass Unhide is performed.
Historical hideHelperManuallyHidden flags cannot prove whether an old override
was genuine or produced by the old accessor. They remain authoritative.

After installing, fully refresh the SillyTavern page to discard the old module's
in-memory accessors. Back up a conversation before repairing it. For confirmed
false positives only, use its native Unhide button or /unhide with the selected
message ID/range. This explicitly replaces that message's old hidden override.
Do not use Unhide All unless all messages really should become visible.

Unknown hidden messages are not automatically restored. New messages created by
this plugin receive no copied manual flags, but imported/externally copied legacy
flags are still respected. Direct third-party assignments are not a substitute
for the explicit button/command override interface.

## Local verification

Run with Node.js:

    node --test tests/visibility.cjs
    node --check index.js
    git -c core.whitespace=cr-at-eol diff --check

The repository has existing mixed Windows line endings; the last command treats
CR at end of line as a line ending rather than trailing whitespace.

16 tests passed without API calls:

- A: N=1,4,10,17,150; repeat-check idempotence.
- B: four historical manual shows plus newly added USER and AI.
- C: repeated latest-message hides through floor 200, hide-all, reload, refill.
- D: alternating USER/AI additions with no manufactured manual flags.
- E: 100 streaming/metadata mutations, no redundant saves or visibility writes.
- F: repeated unexplained assignments; native-style button overrides.
- G: conservative legacy state and targeted repair.
- H: Continue/Swipe/edit payloads; live, shallow and deep request arrays.
- H: coalesced timers and chat identity/epoch cancellation.
- Effective global and per-character N.
- Explicit commands, repeated values, filters, results and single installation.
- Actual plugin data-event handlers before simulated native prompt filtering.
- Continue/Swipe/edit/chat-switch event combinations.
- DOM-only mismatch without chat saves.
- Disabled, unconfigured and N=0 behavior.
- Same-length request replacement with isolated auto flags.

Tests evaluate the production functions and event handlers in a VM. Native
command callbacks, jQuery DOM, timers, event bus and saving are simulated.
No live SillyTavern instance, mobile browser or real API was exercised.

## Evidence and remaining uncertainty

Reviewed upstream 1.19.0 sources:

- https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/script.js
  sendMessageAsUser initializes is_system=false. Native coreChat filters Hidden
  messages before extension interception and applies prompt transformations.
- https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/chats.js
  hideChatMessageRange directly assigns is_system, updates DOM, then saves.
- https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/slash-commands.js
  hide/unhide callbacks use stringToRange and optional name filtering.
- https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/extensions.js
  the interceptor dispatcher requires manifest.generate_interceptor.

These defects explain a reproducible failure path, not every observed incident.
The particular external writer that produced the user's old manual-hide flags
has not been identified. There is no evidence that the theme writes is_system.
Native system/tool messages may legitimately be hidden. We do not unhide them.
The interceptor cannot restore messages already removed upstream or determine
the provenance of arbitrary third-party writes. Native Swipe prompt removal,
token limits, promptOnly/Continue behavior and custom command replacements still
need real-environment validation; no SillyTavern core changes are included.

No push, deployment or SillyTavern upgrade was performed.
