#!/usr/bin/env bash

set -u

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_BACKEND_DIR="$SCRIPT_DIR"
SOURCE_CONFIG="$SOURCE_BACKEND_DIR/config.json"
SOURCE_ENV_EXAMPLE="$SOURCE_BACKEND_DIR/auction.env.example"
SOURCE_SERVICE="$SOURCE_BACKEND_DIR/auction-backend.service"

DRY_RUN=0
DEFAULT_BACKEND_DIR="/opt/auction"
DEFAULT_ENV_DIR="/etc/auction"
SERVICE_USER="auction"
SERVICE_GROUP="auction"

PENDING_COMMANDS=()
WARNINGS=()
ROOT_PASSWORD=""
FIRST_RUN_LOG=""
FIRST_RUN_ATTEMPTED=0
FIRST_RUN_OK=0
FIRST_RUN_SKIPPED_REASON=""
DB_ALREADY_EXISTED=0
DEPENDENCIES_OK=0
STAGING_DIR=""

usage() {
  cat <<'USAGE'
Convention Auction backend installer

Usage:
  ./backend/install-backend.sh [--dry-run] [--help]

Options:
  --dry-run   Show detected defaults and planned actions without writing files.
  --help      Show this help text.

The installer deploys the backend only. Frontend/webserver setup remains manual.
USAGE
}

info() {
  printf '%s\n' "$*"
}

warn() {
  WARNINGS+=("$*")
  printf 'WARN: %s\n' "$*" >&2
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

shell_quote() {
  printf '%q' "$1"
}

first_run_command() {
  local inner
  inner="cd $(shell_quote "$BACKEND_DIR") && AUCTION_ENV_FILE=$(shell_quote "$ENV_FILE") NODE_ENV=production node backend.js"
  if can_write_target "$BACKEND_DIR"; then
    printf '%s' "$inner"
  else
    printf 'sudo sh -c %q' "$inner"
  fi
}

add_pending() {
  local existing
  for existing in "${PENDING_COMMANDS[@]}"; do
    if [ "$existing" = "$*" ]; then
      return 0
    fi
  done
  PENDING_COMMANDS+=("$*")
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

is_root() {
  [ "$(id -u)" -eq 0 ]
}

trim_trailing_slash() {
  local value="$1"
  if [ "$value" != "/" ]; then
    value="${value%/}"
  fi
  printf '%s' "$value"
}

join_unique_paths() {
  local result=()
  local candidate existing found
  for candidate in "$@"; do
    found=0
    for existing in "${result[@]}"; do
      if [ "$existing" = "$candidate" ]; then
        found=1
        break
      fi
    done
    if [ "$found" -eq 0 ]; then
      result+=("$candidate")
    fi
  done
  printf '%s' "${result[*]}"
}

ensure_staging_dir() {
  if [ -z "$STAGING_DIR" ]; then
    STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/auction-install.${SERVICE_NAME:-auction}.XXXXXX")"
    chmod 700 "$STAGING_DIR" 2>/dev/null || true
  fi
}

get_staging_dir() {
  ensure_staging_dir
  printf '%s' "$STAGING_DIR"
}

json_key() {
  local key="$1"
  node -e '
    const fs = require("fs");
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = cfg[process.argv[2]];
    process.stdout.write(Array.isArray(value) ? JSON.stringify(value) : String(value));
  ' "$SOURCE_CONFIG" "$key"
}

require_node_and_npm() {
  have_cmd node || fail "Node.js 20 or newer is required. Install Node.js from your OS packages, NodeSource, nvm, or nodejs.org, then rerun this installer."
  have_cmd npm || fail "npm is required. Install npm with Node.js, then rerun this installer."

  local node_major
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null)"
  if [ -z "$node_major" ] || [ "$node_major" -lt 20 ]; then
    fail "Node.js 20 or newer is required. Current version: $(node -v 2>/dev/null || printf unknown)."
  fi
}

prompt_value() {
  local label="$1"
  local default_value="$2"
  local answer
  printf '%s [%s]: ' "$label" "$default_value" >&2
  read -r answer || answer=""
  if [ -z "$answer" ]; then
    answer="$default_value"
  fi
  trim_trailing_slash "$answer"
}

prompt_choice() {
  local label="$1"
  local default_value="$2"
  local answer
  while true; do
    printf '%s [%s]: ' "$label" "$default_value" >&2
    read -r answer || answer=""
    if [ -z "$answer" ]; then
      answer="$default_value"
    fi
    case "$answer" in
      systemd|pm2|overwrite|stop|backup|continue|generate|enter|yes|no)
        printf '%s' "$answer"
        return 0
        ;;
      *)
        printf 'Please enter a valid option.\n' >&2
        ;;
    esac
  done
}

generate_secret() {
  node -e 'process.stdout.write(require("crypto").randomBytes(48).toString("base64url"));'
}

prompt_secret() {
  local choice
  choice="$(prompt_choice "SECRET_KEY: generate or enter" "generate")"
  printf '\n' >&2
  if [ "$choice" = "generate" ]; then
    generate_secret
    return 0
  fi

  local secret
  while true; do
    printf 'Enter SECRET_KEY (minimum 16 characters): ' >&2
    if ! read -r -s secret; then
      printf '\n' >&2
      fail "No SECRET_KEY was entered."
    fi
    printf '\n' >&2
    if [ "${#secret}" -ge 16 ]; then
      printf '%s' "$secret"
      return 0
    fi
    printf 'SECRET_KEY must be at least 16 characters.\n' >&2
  done
}

can_write_target() {
  local path="$1"
  local parent
  if is_root; then
    return 0
  fi
  if [ -e "$path" ]; then
    [ -w "$path" ]
    return $?
  fi
  parent="$(dirname "$path")"
  while [ ! -e "$parent" ] && [ "$parent" != "/" ]; do
    parent="$(dirname "$parent")"
  done
  [ -w "$parent" ]
}

ensure_dir() {
  local dir="$1"
  local mode="${2:-}"
  if [ "$DRY_RUN" -eq 1 ]; then
    info "Would create directory: $dir"
    return 0
  fi
  if mkdir -p "$dir" 2>/dev/null; then
    if [ -n "$mode" ]; then
      chmod "$mode" "$dir" 2>/dev/null || true
    fi
    return 0
  fi
  add_pending "sudo mkdir -p $(shell_quote "$dir")"
  if [ -n "$mode" ]; then
    add_pending "sudo chmod $mode $(shell_quote "$dir")"
  fi
  return 1
}

set_owner_if_root() {
  local owner="$1"
  shift
  if [ "$DRY_RUN" -eq 1 ]; then
    info "Would set owner $owner on: $*"
    return 0
  fi
  if is_root; then
    chown -R "$owner" "$@"
  else
    local path
    for path in "$@"; do
      add_pending "sudo chown -R $owner $(shell_quote "$path")"
    done
  fi
}

set_mode_if_possible() {
  local mode="$1"
  local path="$2"
  if [ "$DRY_RUN" -eq 1 ]; then
    info "Would chmod $mode $path"
    return 0
  fi
  if chmod "$mode" "$path" 2>/dev/null; then
    return 0
  fi
  add_pending "sudo chmod $mode $(shell_quote "$path")"
  return 1
}

copy_backend() {
  if [ "$DRY_RUN" -eq 1 ]; then
    info "Would copy backend from $SOURCE_BACKEND_DIR to $BACKEND_DIR"
    return 0
  fi

  if ! ensure_dir "$BACKEND_DIR" "750"; then
    add_pending "sudo tar -C $(shell_quote "$SOURCE_BACKEND_DIR") --exclude=./node_modules --exclude=./auction.env --exclude=./.env --exclude=./*.log -cf - . | sudo tar -C $(shell_quote "$BACKEND_DIR") -xf -"
    return 1
  fi

  if ! can_write_target "$BACKEND_DIR"; then
    add_pending "sudo tar -C $(shell_quote "$SOURCE_BACKEND_DIR") --exclude=./node_modules --exclude=./auction.env --exclude=./.env --exclude=./*.log -cf - . | sudo tar -C $(shell_quote "$BACKEND_DIR") -xf -"
    return 1
  fi

  (
    cd "$SOURCE_BACKEND_DIR" &&
      tar --exclude='./node_modules' \
          --exclude='./auction.env' \
          --exclude='./.env' \
          --exclude='./*.log' \
          -cf - .
  ) | (
    cd "$BACKEND_DIR" &&
      tar -xf -
  )
}

write_env_file() {
  local env_file="$1"
  local staged_env
  if [ "$DRY_RUN" -eq 1 ]; then
    info "Would write env file: $env_file"
    return 0
  fi

  if ! ensure_dir "$ENV_DIR" "750"; then
    ensure_staging_dir
    staged_env="$STAGING_DIR/auction.env"
    render_env_file "$staged_env"
    add_pending "sudo install -m 0640 $(shell_quote "$staged_env") $(shell_quote "$env_file")"
    return 1
  fi

  if ! can_write_target "$ENV_DIR"; then
    ensure_staging_dir
    staged_env="$STAGING_DIR/auction.env"
    render_env_file "$staged_env"
    add_pending "sudo install -m 0640 $(shell_quote "$staged_env") $(shell_quote "$env_file")"
    return 1
  fi

  render_env_file "$env_file"
  set_mode_if_possible "640" "$env_file" >/dev/null || true
}

render_env_file() {
  local dest="$1"
  node - "$SOURCE_ENV_EXAMPLE" "$dest" "$SECRET_KEY" <<'NODE'
const fs = require('fs');
const [src, dest, secret] = process.argv.slice(2);
let text = fs.readFileSync(src, 'utf8');
if (/^SECRET_KEY=.*/m.test(text)) {
  text = text.replace(/^SECRET_KEY=.*/m, `SECRET_KEY=${secret}`);
} else {
  text = `SECRET_KEY=${secret}\n` + text;
}
fs.writeFileSync(dest, text, { mode: 0o640 });
NODE
}

update_json_files() {
  local target_backend_dir="$BACKEND_DIR"
  local staged_backend_dir=""
  if [ "$DRY_RUN" -eq 1 ]; then
    info "Would update deployed config.json and default PPTX/card resource paths"
    return 0
  fi

  if [ ! -w "$BACKEND_DIR/config.json" ]; then
    ensure_staging_dir
    staged_backend_dir="$STAGING_DIR/backend-overrides"
    mkdir -p "$staged_backend_dir"
    cp "$SOURCE_CONFIG" "$staged_backend_dir/config.json"
    cp "$SOURCE_BACKEND_DIR/default.pptxConfig.json" "$staged_backend_dir/default.pptxConfig.json"
    cp "$SOURCE_BACKEND_DIR/default.cardConfig.json" "$staged_backend_dir/default.cardConfig.json"
    target_backend_dir="$staged_backend_dir"
    add_pending "sudo install -m 0644 $(shell_quote "$staged_backend_dir/config.json") $(shell_quote "$BACKEND_DIR/config.json")"
    add_pending "sudo install -m 0644 $(shell_quote "$staged_backend_dir/default.pptxConfig.json") $(shell_quote "$BACKEND_DIR/default.pptxConfig.json")"
    add_pending "sudo install -m 0644 $(shell_quote "$staged_backend_dir/default.cardConfig.json") $(shell_quote "$BACKEND_DIR/default.cardConfig.json")"
    warn "Cannot update deployed backend config as current user; staged updated config files in $staged_backend_dir."
  fi

  node - "$target_backend_dir" "$CONFIG_IMG_DIR" "$BACKUP_DIR" "$UPLOAD_DIR" "$PPTX_CONFIG_DIR" "$OUTPUT_DIR" "$DB_PATH" "$DB_NAME" "$LOG_DIR" "$LOG_NAME" "$SERVICE_NAME" <<'NODE'
const fs = require('fs');
const path = require('path');

const [
  backendDir,
  configImgDir,
  backupDir,
  uploadDir,
  pptxConfigDir,
  outputDir,
  dbPath,
  dbName,
  logDir,
  logName,
  serviceName
] = process.argv.slice(2);

function rewriteJson(file, mutate) {
  const fullPath = path.join(backendDir, file);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  mutate(data);
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + '\n');
}

rewriteJson('config.json', (cfg) => {
  cfg.CONFIG_IMG_DIR = configImgDir;
  cfg.BACKUP_DIR = backupDir;
  cfg.UPLOAD_DIR = uploadDir;
  cfg.PPTX_CONFIG_DIR = pptxConfigDir;
  cfg.OUTPUT_DIR = outputDir;
  cfg.DB_PATH = dbPath;
  cfg.DB_NAME = dbName;
  cfg.LOG_DIR = logDir;
  cfg.LOG_NAME = logName;
  cfg.SERVICE_NAME = serviceName;
});

const resourceReplacements = new Map([
  ['banner.jpg', path.join(configImgDir, 'banner.jpg')],
  ['default_logo.png', path.join(configImgDir, 'default_logo.png')]
]);

function updateResourcePaths(value) {
  if (Array.isArray(value)) return value.map(updateResourcePaths);
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'path' && typeof child === 'string') {
        const base = path.basename(child);
        if (resourceReplacements.has(base)) value[key] = resourceReplacements.get(base);
      } else {
        value[key] = updateResourcePaths(child);
      }
    }
  }
  return value;
}

for (const file of ['default.pptxConfig.json', 'default.cardConfig.json']) {
  rewriteJson(file, updateResourcePaths);
}
NODE
}

write_systemd_service() {
  local staged_service="$BACKEND_DIR/${SERVICE_NAME}.service"
  local target_service="/etc/systemd/system/${SERVICE_NAME}.service"

  if [ "$DRY_RUN" -eq 1 ]; then
    info "Would generate systemd service: $staged_service"
    info "Would install systemd service: $target_service"
    return 0
  fi

  if [ ! -d "$BACKEND_DIR" ] || [ ! -w "$BACKEND_DIR" ]; then
    ensure_staging_dir
    staged_service="$STAGING_DIR/${SERVICE_NAME}.service"
  fi

  node - "$SOURCE_SERVICE" "$staged_service" "$BACKEND_DIR" "$ENV_FILE" "$DATA_WRITE_PATHS" "$SERVICE_USER" "$SERVICE_GROUP" <<'NODE'
const fs = require('fs');
const [src, dest, backendDir, envFile, writePaths, user, group] = process.argv.slice(2);
let text = fs.readFileSync(src, 'utf8');
text = text.replace(/^User=.*/m, `User=${user}`);
text = text.replace(/^Group=.*/m, `Group=${group}`);
text = text.replace(/^WorkingDirectory=.*/m, `WorkingDirectory=${backendDir}`);
text = text.replace(/^EnvironmentFile=.*/m, `EnvironmentFile=${envFile}`);
text = text.replace(/^ExecStart=.*/m, `ExecStart=/usr/bin/env node ${backendDir}/backend.js`);
text = text.replace(/^ReadWritePaths=.*/m, `ReadWritePaths=${writePaths}`);
text = text.replace(/^ReadOnlyPaths=.*/m, `ReadOnlyPaths=${backendDir}`);
fs.writeFileSync(dest, text);
NODE

  if [ ! -d "$BACKEND_DIR" ] || [ ! -w "$BACKEND_DIR" ]; then
    add_pending "sudo install -m 0644 $(shell_quote "$staged_service") $(shell_quote "$target_service")"
    add_pending "sudo systemctl daemon-reload"
    add_pending "sudo systemctl enable --now $(shell_quote "$SERVICE_NAME")"
    add_pending "sudo systemctl status $(shell_quote "$SERVICE_NAME")"
    warn "Cannot install systemd service as current user; staged service file at $staged_service."
    return 1
  fi

  if is_root; then
    cp "$staged_service" "$target_service"
    if [ "$DEPENDENCIES_OK" -eq 1 ]; then
      systemctl daemon-reload
      systemctl enable --now "$SERVICE_NAME"
    else
      add_pending "sudo systemctl daemon-reload"
      add_pending "sudo systemctl enable --now $(shell_quote "$SERVICE_NAME")"
      warn "Systemd service was installed but not started because dependencies are incomplete."
    fi
  else
    add_pending "sudo cp $(shell_quote "$staged_service") $(shell_quote "$target_service")"
    add_pending "sudo systemctl daemon-reload"
    add_pending "sudo systemctl enable --now $(shell_quote "$SERVICE_NAME")"
    add_pending "sudo systemctl status $(shell_quote "$SERVICE_NAME")"
  fi
}

write_pm2_ecosystem() {
  local ecosystem="$BACKEND_DIR/ecosystem.config.cjs"
  local ecosystem_target="$ecosystem"
  if [ "$DRY_RUN" -eq 1 ]; then
    info "Would generate PM2 ecosystem file: $ecosystem"
    return 0
  fi

  if [ ! -d "$BACKEND_DIR" ] || [ ! -w "$BACKEND_DIR" ]; then
    ensure_staging_dir
    ecosystem="$STAGING_DIR/ecosystem.config.cjs"
    add_pending "sudo install -m 0644 $(shell_quote "$ecosystem") $(shell_quote "$ecosystem_target")"
    warn "Cannot write PM2 ecosystem file in $BACKEND_DIR as current user; staged it at $ecosystem."
  fi

  node - "$ecosystem" "$SERVICE_NAME" "$BACKEND_DIR" "$ENV_FILE" <<'NODE'
const fs = require('fs');
const [dest, name, cwd, envFile] = process.argv.slice(2);
const content = `module.exports = {
  apps: [
    {
      name: ${JSON.stringify(name)},
      cwd: ${JSON.stringify(cwd)},
      script: "backend.js",
      env: {
        NODE_ENV: "production",
        AUCTION_ENV_FILE: ${JSON.stringify(envFile)}
      }
    }
  ]
};
`;
fs.writeFileSync(dest, content);
NODE

  if [ "$DEPENDENCIES_OK" -ne 1 ]; then
    add_pending "cd $(shell_quote "$BACKEND_DIR") && npm ci --omit=dev"
    add_pending "cd $(shell_quote "$BACKEND_DIR") && pm2 start ecosystem.config.cjs --only $(shell_quote "$SERVICE_NAME")"
    add_pending "pm2 save"
    warn "PM2 process was not started because dependencies are incomplete."
    return 1
  fi

  if have_cmd pm2; then
    if (cd "$BACKEND_DIR" && pm2 start "$ecosystem" --only "$SERVICE_NAME"); then
      pm2 save || warn "PM2 started but pm2 save failed. Run pm2 save manually."
    else
      warn "PM2 is installed but could not start $SERVICE_NAME."
      add_pending "cd $(shell_quote "$BACKEND_DIR") && pm2 start ecosystem.config.cjs --only $(shell_quote "$SERVICE_NAME")"
      add_pending "pm2 save"
      return 1
    fi
  else
    add_pending "sudo npm install -g pm2"
    add_pending "cd $(shell_quote "$BACKEND_DIR") && pm2 start ecosystem.config.cjs --only $(shell_quote "$SERVICE_NAME")"
    add_pending "pm2 save"
    add_pending "pm2 startup"
  fi
}

install_dependencies() {
  if [ "$DRY_RUN" -eq 1 ]; then
    info "Would install backend dependencies in $BACKEND_DIR"
    return 0
  fi

  if [ ! -d "$BACKEND_DIR" ] || [ ! -w "$BACKEND_DIR" ]; then
    add_pending "sudo npm ci --omit=dev --prefix $(shell_quote "$BACKEND_DIR")"
    return 1
  fi

  if [ -f "$BACKEND_DIR/package-lock.json" ]; then
    (cd "$BACKEND_DIR" && npm ci --omit=dev) || (cd "$BACKEND_DIR" && npm install --omit=dev)
  else
    (cd "$BACKEND_DIR" && npm install --omit=dev)
  fi
  local status="$?"
  if [ "$status" -ne 0 ]; then
    warn "Dependency installation failed in $BACKEND_DIR."
    add_pending "cd $(shell_quote "$BACKEND_DIR") && npm ci --omit=dev"
    return "$status"
  fi
  DEPENDENCIES_OK=1
}

maybe_create_service_user() {
  if [ "$DRY_RUN" -eq 1 ]; then
    info "Would ensure service user exists: $SERVICE_USER"
    return 0
  fi

  if id "$SERVICE_USER" >/dev/null 2>&1; then
    return 0
  fi

  if ! is_root; then
    add_pending "sudo useradd --system --home $(shell_quote "$BACKEND_DIR") --shell /usr/sbin/nologin $(shell_quote "$SERVICE_USER")"
    return 0
  fi

  if have_cmd useradd; then
    useradd --system --home "$BACKEND_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  else
    warn "useradd was not found. Create a system user named $SERVICE_USER manually before starting systemd."
  fi
}

detect_existing_install() {
  local found=()
  if [ -d "$BACKEND_DIR" ] && [ "$(find "$BACKEND_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | head -n 1)" ]; then
    found+=("backend directory: $BACKEND_DIR")
  fi
  if [ -f "$ENV_FILE" ]; then
    found+=("env file: $ENV_FILE")
  fi
  if [ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
    found+=("systemd service: /etc/systemd/system/${SERVICE_NAME}.service")
  fi
  if have_cmd pm2 && pm2 describe "$SERVICE_NAME" >/dev/null 2>&1; then
    found+=("PM2 process: $SERVICE_NAME")
  fi

  if [ "${#found[@]}" -eq 0 ]; then
    return 0
  fi

  info "Existing installation markers were found:"
  local item
  for item in "${found[@]}"; do
    info "  - $item"
  done

  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi

  local choice
  choice="$(prompt_choice "Overwrite existing backend install or stop (overwrite/stop)" "stop")"
  printf '\n'
  if [ "$choice" != "overwrite" ]; then
    fail "Installation stopped by user."
  fi
}

handle_existing_database() {
  DB_FILE="$DB_PATH/$DB_NAME"
  if [ ! -f "$DB_FILE" ]; then
    DB_ALREADY_EXISTED=0
    return 0
  fi

  DB_ALREADY_EXISTED=1
  info "Existing database found: $DB_FILE"
  if [ "$DRY_RUN" -eq 1 ]; then
    info "Would offer to back up existing database to $BACKUP_DIR"
    return 0
  fi

  local choice
  choice="$(prompt_choice "Backup database, continue without backup, or stop (backup/continue/stop)" "backup")"
  printf '\n'
  case "$choice" in
    stop)
      fail "Installation stopped by user."
      ;;
    continue)
      return 0
      ;;
    backup)
      ensure_dir "$BACKUP_DIR" "750" || return 1
      local stamp backup_file
      stamp="$(date +%Y%m%d-%H%M%S)"
      backup_file="$BACKUP_DIR/${DB_NAME}.${stamp}.bak"
      if cp "$DB_FILE" "$backup_file" 2>/dev/null; then
        info "Database backup created: $backup_file"
      else
        add_pending "sudo cp $(shell_quote "$DB_FILE") $(shell_quote "$backup_file")"
        warn "Could not back up database as current user."
        return 1
      fi
      ;;
  esac
}

attempt_first_run() {
  if [ "$DB_ALREADY_EXISTED" -eq 1 ]; then
    FIRST_RUN_SKIPPED_REASON="Existing database detected; no new root password is expected."
    return 0
  fi

  if [ "$DEPENDENCIES_OK" -ne 1 ] && [ "$DRY_RUN" -ne 1 ]; then
    FIRST_RUN_SKIPPED_REASON="Backend dependencies were not installed successfully."
    add_pending "$(first_run_command)"
    return 1
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    info "Would perform first run and capture initial root password"
    return 0
  fi

  if [ ! -x "$(command -v node)" ]; then
    FIRST_RUN_SKIPPED_REASON="Node.js is not available."
    return 1
  fi
  if [ ! -f "$BACKEND_DIR/backend.js" ]; then
    FIRST_RUN_SKIPPED_REASON="$BACKEND_DIR/backend.js is not available."
    return 1
  fi
  if [ ! -r "$ENV_FILE" ]; then
    FIRST_RUN_SKIPPED_REASON="$ENV_FILE is not readable."
    return 1
  fi
  if [ ! -w "$DB_PATH" ] || [ ! -w "$LOG_DIR" ] || [ ! -w "$CONFIG_IMG_DIR" ] || [ ! -w "$UPLOAD_DIR" ] || [ ! -w "$PPTX_CONFIG_DIR" ] || [ ! -w "$OUTPUT_DIR" ]; then
    FIRST_RUN_SKIPPED_REASON="One or more runtime directories are not writable by the current user."
    add_pending "$(first_run_command)"
    return 1
  fi

  FIRST_RUN_ATTEMPTED=1
  FIRST_RUN_LOG="$(mktemp "${TMPDIR:-/tmp}/auction-first-run.XXXXXX.log")"
  (
    cd "$BACKEND_DIR" &&
      AUCTION_ENV_FILE="$ENV_FILE" NODE_ENV=production node backend.js >"$FIRST_RUN_LOG" 2>&1
  ) &
  local pid="$!"
  local waited=0
  while [ "$waited" -lt 25 ]; do
    if grep -q 'Server startup complete and listening' "$FIRST_RUN_LOG" 2>/dev/null; then
      FIRST_RUN_OK=1
      break
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  else
    wait "$pid" 2>/dev/null || true
  fi

  ROOT_PASSWORD="$(
    node - "$FIRST_RUN_LOG" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const match = text.match(/Initial (?:root )?password \(shown once\):\s*([^\s]+)/i);
process.stdout.write(match ? match[1] : '');
NODE
  )"

  if [ -n "$ROOT_PASSWORD" ]; then
    FIRST_RUN_OK=1
  elif [ "$FIRST_RUN_OK" -ne 1 ]; then
    FIRST_RUN_SKIPPED_REASON="Backend did not complete first-run startup. Check $FIRST_RUN_LOG."
    return 1
  fi
}

show_config_summary() {
  local deployed_config="$BACKEND_DIR/config.json"
  if [ "$DRY_RUN" -eq 1 ]; then
    deployed_config="$SOURCE_CONFIG"
  fi
  if [ ! -f "$deployed_config" ]; then
    return 0
  fi

  info ""
  info "Non-path config options:"
  node - "$deployed_config" <<'NODE'
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const pathKeys = new Set([
  'CONFIG_IMG_DIR',
  'BACKUP_DIR',
  'UPLOAD_DIR',
  'PPTX_CONFIG_DIR',
  'OUTPUT_DIR',
  'DB_PATH',
  'LOG_DIR'
]);
for (const [key, value] of Object.entries(cfg)) {
  if (pathKeys.has(key)) continue;
  console.log(`  ${key}: ${JSON.stringify(value)}`);
}
NODE
}

print_summary() {
  info ""
  info "Installation summary"
  info "  Backend directory: $BACKEND_DIR"
  info "  Env file:          $ENV_FILE"
  info "  Database:          $DB_PATH/$DB_NAME"
  info "  Logs:              $LOG_DIR/$LOG_NAME"
  info "  Operation mode:    $RUN_MODE"
  info ""
  info "Edit runtime config with:"
  info "  nano $BACKEND_DIR/config.json"
  info "  nano $ENV_FILE"

  if [ "$DB_ALREADY_EXISTED" -eq 1 ]; then
    info ""
    info "Root password: existing database detected, so no new root password was generated."
  elif [ -n "$ROOT_PASSWORD" ]; then
    info ""
    info "Initial root password (shown once): $ROOT_PASSWORD"
  elif [ -n "$FIRST_RUN_SKIPPED_REASON" ]; then
    info ""
    info "Initial root password was not captured: $FIRST_RUN_SKIPPED_REASON"
    info "Run this command once and save the password printed by the backend:"
    info "  $(first_run_command)"
  fi

  if [ -n "$FIRST_RUN_LOG" ]; then
    info "First-run log: $FIRST_RUN_LOG"
  fi

  if [ "${#WARNINGS[@]}" -gt 0 ]; then
    info ""
    info "Warnings:"
    local warning
    for warning in "${WARNINGS[@]}"; do
      info "  - $warning"
    done
  fi

  if [ "${#PENDING_COMMANDS[@]}" -gt 0 ]; then
    info ""
    info "Commands that need elevated privileges or later manual completion:"
    local command
    for command in "${PENDING_COMMANDS[@]}"; do
      info "  $command"
    done
  fi

  info ""
  info "Frontend deployment was not changed by this installer."
}

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    *)
      fail "Unknown argument: $arg"
      ;;
  esac
done

[ -f "$SOURCE_CONFIG" ] || fail "Cannot find $SOURCE_CONFIG"
[ -f "$SOURCE_ENV_EXAMPLE" ] || fail "Cannot find $SOURCE_ENV_EXAMPLE"
[ -f "$SOURCE_SERVICE" ] || fail "Cannot find $SOURCE_SERVICE"

require_node_and_npm

DEFAULT_CONFIG_IMG_DIR="$(json_key CONFIG_IMG_DIR)"
DEFAULT_BACKUP_DIR="$(json_key BACKUP_DIR)"
DEFAULT_UPLOAD_DIR="$(json_key UPLOAD_DIR)"
DEFAULT_PPTX_CONFIG_DIR="$(json_key PPTX_CONFIG_DIR)"
DEFAULT_OUTPUT_DIR="$(json_key OUTPUT_DIR)"
DEFAULT_DB_PATH="$(json_key DB_PATH)"
DEFAULT_DB_NAME="$(json_key DB_NAME)"
DEFAULT_LOG_DIR="$(json_key LOG_DIR)"
DEFAULT_LOG_NAME="$(json_key LOG_NAME)"
DEFAULT_SERVICE_NAME="$(json_key SERVICE_NAME)"

if [ "$DRY_RUN" -eq 1 ]; then
  BACKEND_DIR="$DEFAULT_BACKEND_DIR"
  ENV_DIR="$DEFAULT_ENV_DIR"
  CONFIG_IMG_DIR="$DEFAULT_CONFIG_IMG_DIR"
  BACKUP_DIR="$DEFAULT_BACKUP_DIR"
  UPLOAD_DIR="$DEFAULT_UPLOAD_DIR"
  PPTX_CONFIG_DIR="$DEFAULT_PPTX_CONFIG_DIR"
  OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
  DB_PATH="$DEFAULT_DB_PATH"
  DB_NAME="$DEFAULT_DB_NAME"
  LOG_DIR="$DEFAULT_LOG_DIR"
  LOG_NAME="$DEFAULT_LOG_NAME"
  SERVICE_NAME="$DEFAULT_SERVICE_NAME"
  RUN_MODE="systemd"
  SECRET_KEY="<generated at install time>"
else
  info "Convention Auction backend installer"
  info "Press Enter to accept each default."
  BACKEND_DIR="$(prompt_value "Backend install directory" "$DEFAULT_BACKEND_DIR")"
  ENV_DIR="$(prompt_value "Secure env directory" "$DEFAULT_ENV_DIR")"
  DB_PATH="$(prompt_value "Database directory" "$DEFAULT_DB_PATH")"
  DB_NAME="$(prompt_value "Database filename" "$DEFAULT_DB_NAME")"
  CONFIG_IMG_DIR="$(prompt_value "Config/resources image directory" "$DEFAULT_CONFIG_IMG_DIR")"
  BACKUP_DIR="$(prompt_value "Database backup directory" "$DEFAULT_BACKUP_DIR")"
  UPLOAD_DIR="$(prompt_value "Uploaded item image directory" "$DEFAULT_UPLOAD_DIR")"
  PPTX_CONFIG_DIR="$(prompt_value "PPTX/card/slip config directory" "$DEFAULT_PPTX_CONFIG_DIR")"
  OUTPUT_DIR="$(prompt_value "Generated output directory" "$DEFAULT_OUTPUT_DIR")"
  LOG_DIR="$(prompt_value "Log directory" "$DEFAULT_LOG_DIR")"
  LOG_NAME="$(prompt_value "Log filename" "$DEFAULT_LOG_NAME")"
  SERVICE_NAME="$(prompt_value "Service/process name" "$DEFAULT_SERVICE_NAME")"
  RUN_MODE="$(prompt_choice "Operation mode (systemd/pm2)" "systemd")"
  printf '\n'
  SECRET_KEY="$(prompt_secret)"
  printf '\n'
fi

ENV_FILE="$ENV_DIR/auction.env"
DATA_WRITE_PATHS="$(join_unique_paths "$DB_PATH" "$CONFIG_IMG_DIR" "$BACKUP_DIR" "$UPLOAD_DIR" "$PPTX_CONFIG_DIR" "$OUTPUT_DIR" "$LOG_DIR")"

detect_existing_install
handle_existing_database

info ""
info "Planned backend deployment:"
info "  Backend directory: $BACKEND_DIR"
info "  Env file:          $ENV_FILE"
info "  Database:          $DB_PATH/$DB_NAME"
info "  Data directories:  $CONFIG_IMG_DIR, $BACKUP_DIR, $UPLOAD_DIR, $PPTX_CONFIG_DIR, $OUTPUT_DIR"
info "  Logs:              $LOG_DIR/$LOG_NAME"
info "  Operation mode:    $RUN_MODE"

if [ "$DRY_RUN" -eq 1 ]; then
  copy_backend
  write_env_file "$ENV_FILE"
  update_json_files
  install_dependencies
  attempt_first_run
  if [ "$RUN_MODE" = "systemd" ]; then
    write_systemd_service
  else
    write_pm2_ecosystem
  fi
  show_config_summary
  print_summary
  exit 0
fi

if [ "$RUN_MODE" = "systemd" ]; then
  maybe_create_service_user
fi

ensure_dir "$BACKEND_DIR" "750" || true
ensure_dir "$ENV_DIR" "750" || true
ensure_dir "$DB_PATH" "750" || true
ensure_dir "$CONFIG_IMG_DIR" "750" || true
ensure_dir "$BACKUP_DIR" "750" || true
ensure_dir "$UPLOAD_DIR" "750" || true
ensure_dir "$PPTX_CONFIG_DIR" "750" || true
ensure_dir "$OUTPUT_DIR" "750" || true
ensure_dir "$LOG_DIR" "750" || true

copy_backend || true
write_env_file "$ENV_FILE" || true
update_json_files || true
install_dependencies || true

attempt_first_run || true

if [ "$RUN_MODE" = "systemd" ]; then
  set_owner_if_root "$SERVICE_USER:$SERVICE_GROUP" "$BACKEND_DIR" "$DB_PATH" "$CONFIG_IMG_DIR" "$BACKUP_DIR" "$UPLOAD_DIR" "$PPTX_CONFIG_DIR" "$OUTPUT_DIR" "$LOG_DIR"
  if is_root && [ -f "$ENV_FILE" ]; then
    chown "root:$SERVICE_GROUP" "$ENV_FILE" 2>/dev/null || true
    chmod 640 "$ENV_FILE" 2>/dev/null || true
  elif [ -f "$ENV_FILE" ]; then
    add_pending "sudo chown root:$SERVICE_GROUP $(shell_quote "$ENV_FILE")"
    add_pending "sudo chmod 640 $(shell_quote "$ENV_FILE")"
  fi
fi

if [ "$RUN_MODE" = "systemd" ]; then
  write_systemd_service || true
else
  write_pm2_ecosystem || true
fi

show_config_summary
print_summary
