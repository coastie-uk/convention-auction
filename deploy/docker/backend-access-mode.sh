#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
base_compose="$script_dir/compose.yaml"
test_compose="$script_dir/compose.test-access.yaml"

usage() {
  cat <<EOF
Usage: $(basename "$0") normal|test|status

  normal  Recreate the backend without a host port.
  test    Recreate the backend with 127.0.0.1:3000 mapped to port 3000.
  status  Show the backend container and any published port 3000.
EOF
}

show_status() {
  docker compose -f "$base_compose" ps backend

  local container_id
  local published_port
  container_id="$(docker compose -f "$base_compose" ps -q backend)"
  published_port=""
  if [[ -n "$container_id" ]]; then
    published_port="$(
      docker inspect --format \
        '{{with index .NetworkSettings.Ports "3000/tcp"}}{{range .}}{{.HostIp}}:{{.HostPort}}{{end}}{{end}}' \
        "$container_id"
    )"
  fi

  if [[ -n "$published_port" ]]; then
    printf 'Backend test access: enabled at %s\n' "$published_port"
  else
    printf 'Backend test access: disabled (port 3000 is private)\n'
  fi
}

mode="${1:-}"
case "$mode" in
  normal)
    docker compose -f "$base_compose" up -d --force-recreate backend
    printf 'Backend switched to normal mode.\n'
    show_status
    ;;
  test)
    printf '%s\n' \
      'Warning: test access uses the current application data volume.' \
      'The integration tests modify data; do not run them against production data.'
    docker compose -f "$base_compose" -f "$test_compose" up -d --force-recreate backend
    printf 'Backend switched to test mode.\n'
    show_status
    ;;
  status)
    show_status
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
