#!/usr/bin/env bash
# Runs every test flow in app/e2e/flows on the running Android emulator, one by one, like a real user.
# Usage: run.sh <app.apk> <output folder>
# Each flow gets its own folder with its screenshots and Maestro's notes; the whole phone log is kept too.
set -u
APK="$1"
OUT="$2"
FLOWS="$(cd "$(dirname "$0")/flows" && pwd)"
export PATH="$PATH:$HOME/.maestro/bin"
mkdir -p "$OUT"

adb install -r -g "$APK" > "$OUT/install.txt" 2>&1 || { echo "::error title=Install failed::$(tail -c 800 "$OUT/install.txt")"; exit 1; }
adb shell settings put system screen_off_timeout 1800000
adb logcat -c
adb logcat -v time > "$OUT/logcat.txt" 2>&1 &
LOGPID=$!

summary=""
failed=0
for f in "$FLOWS"/*.yaml; do
  name=$(basename "$f" .yaml)
  mkdir -p "$OUT/$name"
  start=$(date +%s)
  # screenshots from takeScreenshot land in the working folder
  if (cd "$OUT/$name" && timeout 900 maestro test "$f" --test-output-dir "$OUT/$name/maestro" > "$OUT/$name/maestro.log" 2>&1); then
    result="passed"
  else
    result="FAILED"
    failed=$((failed + 1))
    adb exec-out screencap -p > "$OUT/$name/zz-at-failure.png" 2>/dev/null
    # the last lines of Maestro's notes say which step failed
    echo "::error title=$name failed::$(grep -vE '^\s*$' "$OUT/$name/maestro.log" | tail -n 12 | tr '\n' ' ' | cut -c1-1500)"
  fi
  secs=$(( $(date +%s) - start ))
  summary="$summary $name: $result (${secs}s) |"
  echo "$name: $result in ${secs}s"
done

kill $LOGPID 2>/dev/null
sleep 1
# crashes and app errors from the phone log
grep -nE "FATAL EXCEPTION|AndroidRuntime: |ReactNativeJS.*(Error|error|Warning)|E/ReactNative|E/unknown:ReactNative|ANR in app.cybersid|Process app.cybersid.news.*(died|crashed)" "$OUT/logcat.txt" > "$OUT/problems.txt" || true
problems=$(wc -l < "$OUT/problems.txt")
echo "::notice title=Phone test summary::$summary $problems problem lines in the phone log"
if [ "$problems" -gt 0 ]; then
  echo "::warning title=Phone log problems::$(head -n 15 "$OUT/problems.txt" | cut -c1-200 | tr '\n' ' ' | cut -c1-3000)"
fi
echo "$failed" > "$OUT/failed-count.txt"
exit 0
