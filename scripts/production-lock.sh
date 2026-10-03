#!/usr/bin/env bash
# Source this before any shared production-host mutation. FD 9 is deliberately
# inherited by child processes, so a timed-out caller cannot release a live job's lock.
production_lock() {
  local root lock inode inherited
  root="$(realpath "${1:?missing project directory}")"
  lock="$root/.production.lock"
  touch "$lock"
  chmod 600 "$lock"
  inode="$(stat -Lc '%d:%i' "$lock")"
  inherited="$(stat -Lc '%d:%i' "/proc/$$/fd/9" 2>/dev/null || true)"
  if [[ "$inherited" != "$inode" ]]; then
    exec 9>"$lock"
  fi
  if ! flock --exclusive --wait 120 9; then
    echo '另一项生产维护仍持有主机锁；未修改配置或服务。' >&2
    return 75
  fi
}
