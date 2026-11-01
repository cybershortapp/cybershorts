#!/usr/bin/env bash
# On the emulator: install the test app, run the crash-check flow, keep the phone log and any crash.
set -u
APK="$1"; OUT="$2"; mkdir -p "$OUT"
adb install -r -g "$APK" > "$OUT/install.txt" 2>&1; cat "$OUT/install.txt"
adb logcat -c
adb logcat -v time > "$OUT/logcat.txt" 2>&1 &
LOG=$!
export PATH="$PATH:$HOME/.maestro/bin"
(cd "$OUT" && timeout 600 maestro test "$GITHUB_WORKSPACE/design/emu/flow.yaml" --test-output-dir "$OUT/maestro" > "$OUT/maestro.log" 2>&1) && echo "FLOW PASSED" > "$OUT/result.txt" || echo "FLOW FAILED" > "$OUT/result.txt"
sleep 8
adb shell pidof app.cybersid.news > "$OUT/pid.txt" 2>&1 || echo "app not running" >> "$OUT/pid.txt"
adb exec-out screencap -p > "$OUT/z-final.png" || true
kill $LOG 2>/dev/null
grep -nE "FATAL EXCEPTION|AndroidRuntime|E/ReactNativeJS|F/libc|F/DEBUG|SIGSEGV|SIGABRT|Abort message|backtrace|#0[0-9] pc|EXGL|expo\.modules\.gl|GLThread|ExpoGL|Exception|Process: app.cybersid" "$OUT/logcat.txt" | head -150 > "$OUT/crash.txt" || true
echo "== result: $(cat "$OUT/result.txt"), pid: $(cat "$OUT/pid.txt" | tr '\n' ' ')"
head -60 "$OUT/crash.txt"
