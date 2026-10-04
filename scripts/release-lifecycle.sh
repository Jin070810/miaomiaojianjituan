#!/usr/bin/env bash
# Sourced by the trusted release controller; no environment file is executed.

release_container_snapshot() {
  local id="$1" service="$2" destination="$3"
  [[ "$id" =~ ^[a-f0-9]{64}$ && "$service" =~ ^(app|worker)$ ]] || return 1
  timeout --kill-after=5s 15s docker inspect --format '{{json .}}' "$id" |
    jq -e --arg id "$id" --arg service "$service" '
      select(.Id==$id and .Config.Labels["com.docker.compose.project"]=="miaomiao-points"
        and .Config.Labels["com.docker.compose.service"]==$service) |
      {id:.Id,image:.Image,service:$service,revision:.Config.Labels["org.opencontainers.image.revision"],state:(.State |
        {Status,Running,Restarting,Paused,OOMKilled,ExitCode,StartedAt,FinishedAt})}
    ' > "$destination" || return 1
}

release_restore_legacy_queues() {
  local id="$1" script="$2" previous="$3" evidence="$4"
  [[ "$id" =~ ^[a-f0-9]{64}$ && -f "$script" && ! -L "$script" && -f "$previous" && ! -L "$previous" ]] || return 1
  release_container_snapshot "$id" worker "${evidence}.container" || return 1
  timeout --kill-after=5s 85s docker exec -i -e LEGACY_QUEUE_ACTION=resume \
    -e "LEGACY_QUEUE_PREVIOUS=$(cat "$previous")" "$id" node < "$script" > "$evidence" || return 1
  jq -s -e '([.[0].queues[].paused] == [.[1].queues[].paused])' "$previous" "$evidence" >/dev/null || return 1
  rm -- "$previous" || return 1
}

release_drain_container() {
  local id="$1" service="$2" destination="$3" script="${4:-}" previous="${5:-}" before legacy=false image
  before="${destination}.before"
  release_container_snapshot "$id" "$service" "$before" || return 1
  # docker stop may succeed after SIGKILL; its exit status is not a drain result.
  if jq -e '.state.Running==true' "$before" >/dev/null; then
    if [[ "$service" == worker && "$(jq -r .revision "$before")" == 752b084ec220ce5c827609611e51ce718b28b92d ]]; then
      # Only the actual historical image qualifies for pause-before-stop. Its
      # tsx signal handler was proven to interrupt active jobs in isolated CI.
      [[ -f "$script" && ! -L "$script" && "$previous" == /* && ! -L "$previous" ]] || return 1
      image="$(jq -r .image "$before")"
      timeout 15 docker image inspect "$image" | jq -e '.[0] |
        .Config.Labels["org.opencontainers.image.revision"]=="752b084ec220ce5c827609611e51ce718b28b92d" and
        (.RepoDigests | index("ghcr.io/jin070810/miaomiaojianjituan-worker@sha256:21ae3d56522cf9cd02e249b9804c747b2288195b4bd66bcc2b63a8a9c8ceda71") != null)' >/dev/null || return 1
      if [[ ! -e "$previous" ]]; then
        timeout --kill-after=5s 85s docker exec -i -e LEGACY_QUEUE_ACTION=inspect "$id" node \
          < "$script" > "${previous}.tmp" || return 1
        jq -e '.queues | length==2 and all(.[]; (.paused | type=="boolean"))' "${previous}.tmp" >/dev/null || return 1
        mv "${previous}.tmp" "$previous" || return 1
      fi
      timeout --kill-after=5s 85s docker exec -i -e LEGACY_QUEUE_ACTION=pause "$id" node \
        < "$script" > "${destination}.queues-drained" || return 1
      jq -e '(.queues | map(.name))==["kuaishou-video","weekly-challenges"] and
        all(.queues[]; .paused==true and .active==0)' "${destination}.queues-drained" >/dev/null || return 1
      legacy=true
    fi
    timeout --kill-after=10s 90s docker stop --time 75 "$id" >/dev/null || return 1
  fi
  release_container_snapshot "$id" "$service" "$destination" || return 1
  # The pinned Next server explicitly exits 143 after awaiting server.close()
  # on SIGTERM. New Worker must return its supervisor's explicit clean exit 0.
  # The pinned original image may return 143 only after the above queue drain.
  # Neither status alone proves quiescence: the controller also checks DB clients.
  jq -e --arg service "$service" --argjson legacy "$legacy" '.state.Status=="exited" and .state.Running==false and .state.Restarting==false
    and .state.Paused==false and .state.OOMKilled==false
    and (.state.ExitCode==0 or (($service=="app" or $legacy) and .state.ExitCode==143))' "$destination" >/dev/null || {
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
  local domain="$1" evidence="$2" code route method attempt matched
  [[ "$domain" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || return 1
  for route in /login /api/__release_gate_probe; do
    method=GET
    [[ "$route" != /api/* ]] || method=POST
    matched=false
    # Nginx reload acknowledges its signal before new workers accept traffic.
    # Retry this read-only gate probe briefly; never proceed without evidence.
    for attempt in {1..5}; do
      if code="$(curl --silent --show-error --connect-timeout 3 --max-time 8 --request "$method" \
        --dump-header "$evidence" --output /dev/null --write-out '%{http_code}' "https://$domain$route")" &&
        [[ "$code" == 503 ]] &&
        tr -d '\r' < "$evidence" | grep -Eiq '^x-miaomiao-maintenance: 1$' &&
        tr -d '\r' < "$evidence" | grep -Eiq '^cache-control: no-store$'; then
        matched=true
        break
      fi
      if (( attempt < 5 )); then sleep 1; fi
    done
    [[ "$matched" == true ]] || return 1
  done
}
