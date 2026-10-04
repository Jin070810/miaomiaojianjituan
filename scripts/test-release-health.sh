#!/usr/bin/env bash
set -euo pipefail
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/bin"
export HEALTH_CALLS="$test_root/calls" HEALTH_ARGS="$test_root/args"
export RELEASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
cat > "$test_root/bin/curl" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$HEALTH_ARGS"
count=0
if [[ -f "$HEALTH_CALLS" ]]; then count="$(cat "$HEALTH_CALLS")"; fi
count=$((count + 1))
echo "$count" > "$HEALTH_CALLS"
case "$HEALTH_CASE" in
  timeout) exit 28 ;;
  mismatch) worker_sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ;;
  recover)
    if (( count < 3 )); then exit 7; fi
    worker_sha="$RELEASE_SHA" ;;
  *) worker_sha="$RELEASE_SHA" ;;
esac
worker_status=ok
if [[ "$HEALTH_CASE" == worker-failed ]]; then worker_status=stale; fi
jq -n --arg sha "$RELEASE_SHA" --arg worker "$worker_sha" --arg status "$worker_status" \
  '{ok:true,database:"ok",redis:"ok",worker:$status,app:{commit:$sha},workerVersion:{commit:$worker}}'
FAKE
printf '#!/usr/bin/env bash\nexit 0\n' > "$test_root/bin/sleep"
chmod +x "$test_root/bin/curl" "$test_root/bin/sleep"
export PATH="$test_root/bin:$PATH"
for scenario in healthy recover mismatch worker-failed timeout; do
  export HEALTH_CASE="$scenario"
  echo 0 > "$HEALTH_CALLS"
  if bash scripts/verify-release-health.sh http://127.0.0.1:3000 "$RELEASE_SHA" > "$test_root/result"; then
    [[ "$scenario" == healthy || "$scenario" == recover ]]
    if [[ "$scenario" == recover ]]; then [[ "$(cat "$HEALTH_CALLS")" == 3 ]]; fi
  else
    [[ "$scenario" == mismatch || "$scenario" == worker-failed || "$scenario" == timeout ]]
    [[ "$(cat "$HEALTH_CALLS")" == 18 ]]
  fi
done
grep -Fq -- '--connect-timeout 3 --max-time 8' "$HEALTH_ARGS"
echo "同版本健康门禁、恢复与超时测试通过。"
