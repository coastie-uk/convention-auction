#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
compose_file="$script_dir/compose.yaml"
test_access_compose="$script_dir/compose.test-access.yaml"
reset=false
assume_yes=false
test_access=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--test-access|--debug] [--reset] [--yes]

Rebuild the ManeBid images and recreate the containers.

  --test-access
  --debug  Keep backend port 3000 available at 127.0.0.1:3000 after rebuilding.
           The port remains inaccessible from the LAN and public interfaces.
  --reset  Remove all Compose volumes before starting the rebuilt containers.
           This permanently deletes the database, uploads, resources, backups,
           generated files, logs, messages, and Caddy certificate state.
  --yes    Skip the interactive RESET confirmation. Valid only with --reset.
  -h, --help
           Show this help.

With no options, application and Caddy data volumes are retained.
EOF
}

while (($# > 0)); do
  case "$1" in
    --test-access|--debug)
      test_access=true
      ;;
    --reset)
      reset=true
      ;;
    --yes)
      assume_yes=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$assume_yes" == true && "$reset" != true ]]; then
  printf '%s\n' '--yes is valid only when used with --reset.' >&2
  exit 2
fi

printf 'Building ManeBid images before changing the running deployment...\n'
docker compose -f "$compose_file" build

compose_up_args=(-f "$compose_file")
if [[ "$test_access" == true ]]; then
  compose_up_args+=(-f "$test_access_compose")
fi

if [[ "$reset" == true ]]; then
  if [[ "$assume_yes" != true ]]; then
    if [[ ! -t 0 ]]; then
      printf '%s\n' \
        'Reset requires an interactive terminal or the explicit --reset --yes options.' >&2
      exit 2
    fi

    printf '%s\n' \
      'WARNING: complete reset permanently deletes all ManeBid and Caddy volumes.'
    read -r -p 'Type RESET to continue: ' confirmation
    if [[ "$confirmation" != "RESET" ]]; then
      printf 'Reset cancelled; the running deployment and volumes were not changed.\n'
      exit 1
    fi
  fi

  docker compose -f "$compose_file" down --volumes --remove-orphans
  docker compose "${compose_up_args[@]}" up -d
  printf 'ManeBid rebuilt and started with new empty data volumes.\n'
else
  docker compose "${compose_up_args[@]}" up -d --force-recreate
  printf 'ManeBid rebuilt and restarted with existing data volumes retained.\n'
fi

if [[ "$test_access" == true ]]; then
  printf 'Backend debug access remains enabled at 127.0.0.1:3000.\n'
else
  printf 'Backend port 3000 remains private to the Compose network.\n'
fi

docker compose -f "$compose_file" ps
