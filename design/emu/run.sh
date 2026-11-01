#!/usr/bin/env bash
# On the emulator: install the test app, open it to the first card (Maestro), then swipe through ~20 cards with
# plain adb, taking a picture after each, and keep the phone log and any crash.
# Passes when the app is still running at the end and the log has no crash or "not responding" for it.
set -u
APK="$1"; OUT="$2"; mkdir -p "$OUT/shots"
PKG=app.cybersid.news
# a freshly started emulator is slow, and its launcher sometimes shows "isn't responding" over everything
sleep 25
adb shell settings put global hide_error_dialogs 1 || true
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null 2>&1 || true
adb install -r -g "$APK" > "$OUT/install.txt" 2>&1; cat "$OUT/install.txt"
adb logcat -c
adb logcat -v time > "$OUT/logcat.txt" 2>&1 &
LOG=$!
export PATH="$PATH:$HOME/.maestro/bin"
(cd "$OUT" && timeout 300 maestro test "$GITHUB_WORKSPACE/design/emu/flow.yaml" --test-output-dir "$OUT/maestro" > "$OUT/maestro.log" 2>&1) \
  && echo "opened" > "$OUT/open.txt" || echo "open step failed" > "$OUT/open.txt"
shot() { adb exec-out screencap -p > "$OUT/shots/$1.png" 2>/dev/null || true; }
up() { adb shell input swipe 540 1900 540 600 "${1:-400}"; }
down() { adb shell input swipe 540 600 540 1900 "${1:-400}"; }
sleep 4; shot a2-first-card-later
sleep 4; shot a3-first-card-later
for i in $(seq -w 1 18); do up; sleep 3; shot "b$i"; done
down; sleep 2; down; sleep 3; shot c-back-two
for i in 1 2 3 4 5; do up 250; sleep 0.5; done
sleep 4; shot d-after-fast-swipes
sleep 6
adb shell pidof $PKG > "$OUT/pid.txt" 2>&1 || echo "app not running" > "$OUT/pid.txt"
shot z-final
kill $LOG 2>/dev/null
grep -nE "FATAL EXCEPTION|Process: $PKG|ANR in $PKG|F/libc|F/DEBUG|SIGSEGV|SIGABRT|Abort message|#0[0-9] pc|E/ReactNativeJS|IllegalStateException|ExpoGL|EXGL" "$OUT/logcat.txt" | head -150 > "$OUT/crash.txt" || true
if grep -qE "^[0-9]+" "$OUT/pid.txt" && ! grep -qE "FATAL EXCEPTION|ANR in $PKG|SIGSEGV|SIGABRT" "$OUT/crash.txt"; then
  echo "PASSED: still running after $(ls "$OUT/shots" | wc -l) screens, no crash" > "$OUT/result.txt"
else
  echo "FAILED" > "$OUT/result.txt"
fi
echo "== result: $(cat "$OUT/result.txt"), open: $(cat "$OUT/open.txt"), pid: $(tr '\n' ' ' < "$OUT/pid.txt")"
head -60 "$OUT/crash.txt"
