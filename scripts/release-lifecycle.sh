#!/usr/bin/env bash
# Sourced by the trusted release controller; no environment file is executed.

release_container_snapshot() {
  local id="$1" service="$2" destination="$3"
  [[ "$id" =~ ^[a-f0-9]{64}$ && "$service" =~ ^(app|worker)$ ]] || return 1
  timeout --kill-after=5s 15s docker inspect --format '{{json .}}' "$id" |
    jq -e --arg id "$id" --arg service "$service" '
      select(.Id==$id and .Config.Labels["com.docker.compose.project"]=="miaomiao-points"
        and .Config.Labels["com.docker.compose.service"]==$service) |
      {id:.Id,image:.Image,service:$service,state:(.State |
        {Status,Running,Restarting,Paused,OOMKilled,ExitCode,StartedAt,FinishedAt})}
    ' > "$destination" || return 1
}

release_drain_container() {
  local id="$1" service="$2" destination="$3" before
  before="${destination}.before"
  release_container_snapshot "$id" "$service" "$before" || return 1
  # docker stop may succeed after SIGKILL; its exit status is not a drain result.
  if jq -e '.state.Running==true' "$before" >/dev/null; then
    timeout --kill-after=10s 90s docker stop --time 75 "$id" >/dev/null || return 1
  fi
  release_container_snapshot "$id" "$service" "$destination" || return 1
  # The pinned Next server explicitly exits 143 after awaiting server.close()
  # on SIGTERM. Worker must return its supervisor's explicit clean exit 0.
  # Neither status alone proves quiescence: the controller also checks DB clients.
  jq -e --arg service "$service" '.state.Status=="exited" and .state.Running==false and .state.Restarting==false
    and .state.Paused==false and .state.OOMKilled==false
    and (.state.ExitCode==0 or ($service=="app" and .state.ExitCode==143))' "$destination" >/dev/null || {
    printf '服务未正常排空：%s；禁止执行 migration。\n' "$service" >&2
    return 1
  }
}

release_set_gate() {
  local runtime="$1" mode="$2" id="$3" temporary
  [[ "$runtime" == /* && ! -L "$runtime" && "$id" =~ ^[1-9][0-9]*-[1-9][0-9]*$ ]] || return 1
  mkdir -p "$runtime" || return 1
  chmod 755 "$runtime" || return 1
  [[ ! -L "$runtime/maintenance" ]] || return 1
  if [[ "$mode" == closed ]]; then
    temporary="$(mktemp "$runtime/gate.XXXXXX")" || return 1
    printf '%s\n' "$id" > "$temporary" || return 1
    chmod 644 "$temporary" || return 1
    mv "$temporary" "$runtime/maintenance" || return 1
  elif [[ "$mode" == open ]]; then
    rm -f -- "$runtime/maintenance" || return 1
  else
    return 1
  fi
}

release_prepare_ingress() {
  local runtime="$1" template="$2" id="$3" temporary
  [[ -f "$template" && ! -L "$template" ]] || return 1
  release_set_gate "$runtime" closed "$id" || return 1
  [[ ! -L "$runtime/nginx.conf" ]] || return 1
  temporary="$(mktemp "$runtime/config.XXXXXX")" || return 1
  cat "$template" > "$temporary" || return 1
  chmod 644 "$temporary" || return 1
  mv "$temporary" "$runtime/nginx.conf" || return 1
  # The controller mounts the directory; atomic replacements remain visible.
}

release_verify_gate() {
  local domain="$1" evidence="$2" code route method
  [[ "$domain" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || return 1
  for route in /login /api/__release_gate_probe; do
    method=GET
    [[ "$route" != /api/* ]] || method=POST
    code="$(curl --silent --show-error --connect-timeout 3 --max-time 8 --request "$method" \
      --dump-header "$evidence" --output /dev/null --write-out '%{http_code}' "https://$domain$route")" || return 1
    [[ "$code" == 503 ]] || return 1
    tr -d '\r' < "$evidence" | grep -Eiq '^x-miaomiao-maintenance: 1$' || return 1
    tr -d '\r' < "$evidence" | grep -Eiq '^cache-control: no-store$' || return 1
  done
}
