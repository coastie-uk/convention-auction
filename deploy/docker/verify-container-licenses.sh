#!/usr/bin/env bash
set -Eeuo pipefail

backend_image="${1:-manebid-backend:local}"
web_image="${2:-manebid-web:local}"
license_dir="/usr/share/licenses/manebid"

check_file() {
  local image="$1"
  local file="$2"
  docker run --rm --entrypoint sh "$image" -c "test -s '$file'"
  printf 'Verified %s:%s\n' "$image" "$file"
}

check_contains() {
  local image="$1"
  local file="$2"
  local expected="$3"
  docker run --rm --entrypoint grep "$image" -Fq -- "$expected" "$file"
  printf 'Verified content in %s:%s\n' "$image" "$file"
}

check_file "$backend_image" "$license_dir/THIRD_PARTY_NOTICES.md"
check_file "$backend_image" "$license_dir/Apache-2.0.txt"
check_file "$backend_image" "$license_dir/npm-production-packages.tsv"
check_file "$backend_image" "$license_dir/debian-packages.tsv"
check_file "$backend_image" "/usr/local/LICENSE"
check_file "$backend_image" "/usr/share/doc/tini/copyright"

check_file "$web_image" "$license_dir/THIRD_PARTY_NOTICES.md"
check_file "$web_image" "$license_dir/Apache-2.0.txt"
check_file "$web_image" "$license_dir/alpine-packages.tsv"
check_file "$web_image" "$license_dir/caddy-build-info.txt"
check_file "$web_image" "/srv/THIRD_PARTY_NOTICES.md"
check_file "$web_image" "/srv/licenses/Apache-2.0.txt"

check_contains "$backend_image" "$license_dir/npm-production-packages.tsv" $'package\tversion\tdeclared_license'
check_contains "$backend_image" "$license_dir/npm-production-packages.tsv" "LGPL-3.0-or-later"
check_contains "$backend_image" "$license_dir/debian-packages.tsv" $'package\tversion'
check_contains "$web_image" "$license_dir/alpine-packages.tsv" $'package\tversion\tdeclared_license'
check_contains "$web_image" "$license_dir/alpine-packages.tsv" "GPL-2.0-only"
check_contains "$web_image" "$license_dir/caddy-build-info.txt" "github.com/caddyserver/caddy/v2"
check_contains "$web_image" "$license_dir/Apache-2.0.txt" "Apache License"

printf 'Container license bundles are present and non-empty.\n'
