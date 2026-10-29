#!/usr/bin/env bash
# setup-dev-env.sh — manage the myCCtown dev stack on Clever Cloud.
#
# Usage:
#   ./scripts/setup-dev-env.sh <command>
#
# Commands:
#   create    Provision the dev stack (idempotent). Creates the apps,
#             the PostgreSQL addon, and the OAuth consumer; sets all
#             env vars. Apps are NOT deployed — print the deploy
#             commands at the end.
#   start     Start (or restart) both dev apps via `clever restart`.
#             Requires that the apps have been deployed at least once.
#   stop      Stop both dev apps via `clever stop`.
#   restart   Stop then start both dev apps.
#   deploy    [backend|frontend] — deploy from the current branch.
#             With no argument, deploys backend then frontend.
#             Pick a side to skip the other's build (~20-45s saved).
#             Performs the `cd <subdir>` required by the APP_FOLDER
#             monorepo rule.
#   status    Show the current state of every dev resource (app
#             running/stopped, last commit, DB addon presence, OAuth
#             consumer presence).
#   destroy   Delete the apps + PostgreSQL addon + OAuth consumer.
#             Asks for an interactive confirmation. Pass --yes / -y to
#             skip the prompt. Local files (scripts/.env.dev,
#             .clever.json entries) are left untouched — clean them up
#             manually if needed.
#   help      Show this message.
#
# Stack managed by this script:
#   - mycctown-backend-dev  (Rust, build:S run:nano, sticky-sessions)
#   - mycctown-dev          (Node, build:S run:XS, alias mycctown-frontend-dev)
#   - mycctown-db-dev       (PostgreSQL addon, plan dev, linked to backend)
#   - myCCtown-dev          (OAuth consumer, scope access-organisations)
#
# Reuses (shared with prod, untouched by `destroy`):
#   - Cellar music bucket   (public-read MP3s)
#   - GlitchTip projects    (filter dev events with SENTRY_ENVIRONMENT=development)
#
# Prerequisites:
#   - clever-tools >= 4.x logged in as an admin of the target org
#   - jq, openssl
#   - scripts/.env.dev populated from scripts/.env.dev.example (create only)

set -euo pipefail

# ─── ANSI colors ────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'
  BLUE=$'\033[0;34m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi
log_step() { echo "${BOLD}${BLUE}==> $*${NC}"; }
log_ok()   { echo "  ${GREEN}✓${NC} $*"; }
log_skip() { echo "  ${YELLOW}↷${NC} $*"; }
log_warn() { echo "${YELLOW}[WARN]${NC} $*" >&2; }
log_err()  { echo "${RED}[FAIL]${NC} $*" >&2; }

# ─── Configuration ──────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.dev"
CLEVER_JSON="$REPO_ROOT/.clever.json"

BACKEND_ALIAS="mycctown-backend-dev"
BACKEND_NAME="mycctown-backend-dev"
BACKEND_DOMAIN="mycctown-backend-dev.cleverapps.io"

# Frontend: app name drives the cleverapps.io subdomain, alias is local-only.
FRONTEND_ALIAS="mycctown-frontend-dev"
FRONTEND_NAME="mycctown-dev"
FRONTEND_DOMAIN="mycctown-dev.cleverapps.io"

DB_ADDON_NAME="mycctown-db-dev"
DB_ADDON_PLAN="dev"     # CC's free PostgreSQL plan
REGION="par"

OAUTH_CONSUMER_NAME="myCCtown-dev"
OAUTH_CONSUMER_RIGHTS="access-organisations"

# Public base URL of the Cellar bucket holding the ambient MP3s — set
# MUSIC_BASE_URL in scripts/.env.dev (optional; no music when empty).

cd "$REPO_ROOT"

# ─── Common helpers ─────────────────────────────────────────────
ensure_prereqs() {
  command -v clever  >/dev/null 2>&1 || { log_err "clever-tools not installed → npm i -g clever-tools"; exit 1; }
  command -v jq      >/dev/null 2>&1 || { log_err "jq required → brew install jq"; exit 1; }
  command -v openssl >/dev/null 2>&1 || { log_err "openssl required"; exit 1; }
  clever profile     >/dev/null 2>&1 || { log_err "clever not logged in → clever login"; exit 1; }
}

detect_org_id() {
  if [[ ! -f "$CLEVER_JSON" ]]; then
    log_err "$CLEVER_JSON not found — nothing to derive org_id from."
    exit 1
  fi
  ORG_ID="$(jq -r '.apps[0].org_id // empty' "$CLEVER_JSON")"
  [[ -n "$ORG_ID" ]] || { log_err "Could not extract org_id from $CLEVER_JSON"; exit 1; }
}

app_alias_exists() {
  local alias="$1"
  jq -e --arg a "$alias" '.apps[] | select(.alias == $a)' "$CLEVER_JSON" >/dev/null 2>&1
}

addon_exists_by_name() {
  local name="$1"
  clever addon list --format json --org "$ORG_ID" 2>/dev/null \
    | jq -e --arg n "$name" '.[] | select(.name == $n)' >/dev/null 2>&1
}

addon_id_by_name() {
  local name="$1"
  clever addon list --format json --org "$ORG_ID" 2>/dev/null \
    | jq -r --arg n "$name" '.[] | select(.name == $n) | .id // .realId' \
    | head -1
}

# `oauth-consumers list` returns { "<org_id>": [ {key, name, ...}, ... ] }
oauth_consumer_exists() {
  local name="$1"
  clever oauth-consumers list --format json 2>/dev/null \
    | jq -e --arg org "$ORG_ID" --arg n "$name" \
        '.[$org] // [] | .[] | select(.name == $n)' >/dev/null 2>&1
}

oauth_consumer_key_by_name() {
  local name="$1"
  clever oauth-consumers list --format json 2>/dev/null \
    | jq -r --arg org "$ORG_ID" --arg n "$name" \
        '.[$org] // [] | .[] | select(.name == $n) | .key' \
    | head -1
}

set_env_var() {
  local alias="$1" key="$2" value="$3"
  clever env set --alias "$alias" "$key" "$value" >/dev/null
  log_ok "$alias.$key"
}

domain_add_safe() {
  local alias="$1" domain="$2"
  if clever domain --alias "$alias" 2>/dev/null | grep -qF "$domain"; then
    log_skip "domain $domain already on $alias"
  else
    clever domain add "$domain" --alias "$alias" >/dev/null
    log_ok "domain $domain → $alias"
  fi
}

load_secrets() {
  if [[ ! -f "$ENV_FILE" ]]; then
    log_err "$ENV_FILE missing."
    echo "  → cp scripts/.env.dev.example scripts/.env.dev, fill it in, then re-run."
    exit 1
  fi
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a

  local required=(
    SENTRY_DSN_BACKEND_DEV
    VITE_SENTRY_DSN_DEV
    SENTRY_AUTH_TOKEN_DEV
  )
  local missing=()
  for v in "${required[@]}"; do
    [[ -n "${!v:-}" ]] || missing+=("$v")
  done
  if (( ${#missing[@]} > 0 )); then
    log_err "Missing variables in $ENV_FILE: ${missing[*]}"
    exit 1
  fi

  if [[ -z "${ENCRYPTION_KEY_DEV:-}" ]]; then
    ENCRYPTION_KEY_DEV="$(openssl rand -base64 32)"
    log_warn "ENCRYPTION_KEY_DEV auto-generated. Saving it back to $ENV_FILE."
    printf '\nENCRYPTION_KEY_DEV=%s\n' "$ENCRYPTION_KEY_DEV" >> "$ENV_FILE"
  fi
}

# ─── cmd: create ────────────────────────────────────────────────
cmd_create() {
  ensure_prereqs
  load_secrets
  detect_org_id
  log_step "Target org: $ORG_ID"

  # 1. Backend app
  log_step "Backend app ($BACKEND_ALIAS)"
  if app_alias_exists "$BACKEND_ALIAS"; then
    log_skip "$BACKEND_ALIAS already in .clever.json"
  else
    clever create \
      --type rust --region "$REGION" \
      --alias "$BACKEND_ALIAS" --org "$ORG_ID" \
      "$BACKEND_NAME" >/dev/null
    log_ok "created $BACKEND_ALIAS"
    clever scale --alias "$BACKEND_ALIAS" --build-flavor S --flavor nano >/dev/null
    log_ok "scaled build:S run:nano"
    clever config set sticky-sessions true --alias "$BACKEND_ALIAS" >/dev/null
    log_ok "sticky-sessions on"
  fi
  domain_add_safe "$BACKEND_ALIAS" "$BACKEND_DOMAIN"
  clever domain favourite set "$BACKEND_DOMAIN" --alias "$BACKEND_ALIAS" >/dev/null 2>&1 || true

  # 2. PostgreSQL addon
  log_step "PostgreSQL addon ($DB_ADDON_NAME)"
  if addon_exists_by_name "$DB_ADDON_NAME"; then
    log_skip "$DB_ADDON_NAME already exists"
    clever service link-addon "$DB_ADDON_NAME" --alias "$BACKEND_ALIAS" >/dev/null 2>&1 || true
  else
    clever addon create postgresql-addon "$DB_ADDON_NAME" \
      --plan "$DB_ADDON_PLAN" --region "$REGION" \
      --link "$BACKEND_ALIAS" --org "$ORG_ID" >/dev/null
    log_ok "created $DB_ADDON_NAME (plan=$DB_ADDON_PLAN) and linked to $BACKEND_ALIAS"
  fi

  # 3. OAuth consumer
  # NB: clever-tools 4.8 prompts interactively for `Consumer description`
  # and `Application logo URL` even though they're listed as optional.
  # Passing both flags + closing stdin keeps the CLI fully non-interactive.
  log_step "OAuth consumer ($OAUTH_CONSUMER_NAME)"
  if oauth_consumer_exists "$OAUTH_CONSUMER_NAME"; then
    log_skip "$OAUTH_CONSUMER_NAME already exists"
  else
    clever oauth-consumers create "$OAUTH_CONSUMER_NAME" \
      --url         "https://$FRONTEND_DOMAIN" \
      --base-url    "https://$FRONTEND_DOMAIN" \
      --rights      "$OAUTH_CONSUMER_RIGHTS" \
      --description "myCCtown dev environment" \
      --picture     "https://$FRONTEND_DOMAIN/favicon.svg" \
      --org         "$ORG_ID" \
      --format      json </dev/null >/dev/null
    log_ok "created $OAUTH_CONSUMER_NAME (rights=$OAUTH_CONSUMER_RIGHTS)"
  fi
  local consumer_json
  consumer_json="$(clever oauth-consumers get "$OAUTH_CONSUMER_NAME" --with-secret --format json 2>/dev/null)"
  local oauth_key oauth_secret
  oauth_key="$(   echo "$consumer_json" | jq -r '.key    // empty')"
  oauth_secret="$(echo "$consumer_json" | jq -r '.secret // empty')"
  if [[ -z "$oauth_key" || -z "$oauth_secret" ]]; then
    log_err "could not retrieve key/secret for $OAUTH_CONSUMER_NAME"
    exit 1
  fi
  log_ok "key+secret retrieved"

  # 4. Backend env vars
  log_step "Backend env vars"
  set_env_var "$BACKEND_ALIAS" APP_FOLDER ./backend
  set_env_var "$BACKEND_ALIAS" ENCRYPTION_KEY "$ENCRYPTION_KEY_DEV"
  set_env_var "$BACKEND_ALIAS" CC_OAUTH_CONSUMER_KEY "$oauth_key"
  set_env_var "$BACKEND_ALIAS" CC_OAUTH_CONSUMER_SECRET "$oauth_secret"
  set_env_var "$BACKEND_ALIAS" APP_URL "https://$FRONTEND_DOMAIN"
  set_env_var "$BACKEND_ALIAS" FRONTEND_URL "https://$FRONTEND_DOMAIN"
  set_env_var "$BACKEND_ALIAS" WEBHOOKS_PUBLIC_URL "https://$BACKEND_DOMAIN"
  set_env_var "$BACKEND_ALIAS" USE_WEBHOOKS true
  set_env_var "$BACKEND_ALIAS" RUST_LOG "info,sqlx=warn,tower_http=info"
  set_env_var "$BACKEND_ALIAS" SENTRY_DSN "$SENTRY_DSN_BACKEND_DEV"
  set_env_var "$BACKEND_ALIAS" SENTRY_ENVIRONMENT development
  set_env_var "$BACKEND_ALIAS" SENTRY_TRACES_SAMPLE_RATE 0.1

  # 5. Frontend app
  log_step "Frontend app ($FRONTEND_ALIAS, name=$FRONTEND_NAME)"
  if app_alias_exists "$FRONTEND_ALIAS"; then
    log_skip "$FRONTEND_ALIAS already in .clever.json"
  else
    clever create \
      --type node --region "$REGION" \
      --alias "$FRONTEND_ALIAS" --org "$ORG_ID" \
      "$FRONTEND_NAME" >/dev/null
    log_ok "created $FRONTEND_ALIAS"
    clever scale --alias "$FRONTEND_ALIAS" --build-flavor S --flavor XS >/dev/null
    log_ok "scaled build:S run:XS"
  fi
  domain_add_safe "$FRONTEND_ALIAS" "$FRONTEND_DOMAIN"
  clever domain favourite set "$FRONTEND_DOMAIN" --alias "$FRONTEND_ALIAS" >/dev/null 2>&1 || true

  # 6. Frontend env vars
  log_step "Frontend env vars"
  set_env_var "$FRONTEND_ALIAS" APP_FOLDER ./frontend
  set_env_var "$FRONTEND_ALIAS" BACKEND_URL "https://$BACKEND_DOMAIN"
  set_env_var "$FRONTEND_ALIAS" VITE_BACKEND_URL ""
  set_env_var "$FRONTEND_ALIAS" CC_NODE_DEV_DEPENDENCIES install
  set_env_var "$FRONTEND_ALIAS" CC_POST_BUILD_HOOK "npm --prefix ./frontend run build"
  set_env_var "$FRONTEND_ALIAS" CC_RUN_COMMAND "npm --prefix ./frontend run start"
  if [[ -n "${MUSIC_BASE_URL:-}" ]]; then
    set_env_var "$FRONTEND_ALIAS" VITE_MUSIC_BASE_URL "$MUSIC_BASE_URL"
  else
    log_warn "MUSIC_BASE_URL not set in $ENV_FILE — ambient music disabled"
  fi
  set_env_var "$FRONTEND_ALIAS" VITE_SENTRY_DSN "$VITE_SENTRY_DSN_DEV"
  set_env_var "$FRONTEND_ALIAS" VITE_SENTRY_ENVIRONMENT development
  set_env_var "$FRONTEND_ALIAS" SENTRY_AUTH_TOKEN "$SENTRY_AUTH_TOKEN_DEV"

  # Recap
  cat <<EOF

${BOLD}${GREEN}✓ Dev environment provisioned${NC}

  Backend  : https://$BACKEND_DOMAIN     (alias $BACKEND_ALIAS)
  Frontend : https://$FRONTEND_DOMAIN    (alias $FRONTEND_ALIAS)
  DB       : $DB_ADDON_NAME (plan $DB_ADDON_PLAN, linked to backend)
  OAuth    : $OAUTH_CONSUMER_NAME (base URL https://$FRONTEND_DOMAIN)
  Music    : reuses prod Cellar bucket
  GlitchTip: reuses prod projects, env=development

${BOLD}Apps were created but NOT deployed. To deploy:${NC}
  ./scripts/setup-dev-env.sh deploy            # backend then frontend
  ./scripts/setup-dev-env.sh deploy backend    # one side only
  ./scripts/setup-dev-env.sh deploy frontend

${BOLD}Other lifecycle commands:${NC}
  ./scripts/setup-dev-env.sh status
  ./scripts/setup-dev-env.sh stop
  ./scripts/setup-dev-env.sh start
  ./scripts/setup-dev-env.sh restart
  ./scripts/setup-dev-env.sh destroy
EOF
}

# ─── cmd: stop ──────────────────────────────────────────────────
cmd_stop() {
  ensure_prereqs
  log_step "Stopping dev apps"
  for alias in "$BACKEND_ALIAS" "$FRONTEND_ALIAS"; do
    if clever stop --alias "$alias" >/dev/null 2>&1; then
      log_ok "$alias stopped"
    else
      log_skip "$alias already stopped (or not deployed yet)"
    fi
  done
}

# ─── cmd: start ─────────────────────────────────────────────────
# `clever restart` starts a stopped app or restarts a running one.
cmd_start() {
  ensure_prereqs
  log_step "Starting dev apps"
  for alias in "$BACKEND_ALIAS" "$FRONTEND_ALIAS"; do
    if clever restart --alias "$alias" --quiet >/dev/null 2>&1; then
      log_ok "$alias started"
    else
      log_warn "$alias start failed — has it been deployed at least once? (cd <app> && clever deploy --alias $alias)"
    fi
  done
}

# ─── cmd: restart ───────────────────────────────────────────────
cmd_restart() {
  cmd_stop
  cmd_start
}

# ─── cmd: deploy ────────────────────────────────────────────────
deploy_backend() {
  if ! app_alias_exists "$BACKEND_ALIAS"; then
    log_err "$BACKEND_ALIAS not in .clever.json — run './scripts/setup-dev-env.sh create' first"
    exit 1
  fi
  log_step "Deploying backend → $BACKEND_ALIAS"
  ( cd "$REPO_ROOT/backend" && clever deploy --alias "$BACKEND_ALIAS" )
}

deploy_frontend() {
  if ! app_alias_exists "$FRONTEND_ALIAS"; then
    log_err "$FRONTEND_ALIAS not in .clever.json — run './scripts/setup-dev-env.sh create' first"
    exit 1
  fi
  log_step "Deploying frontend → $FRONTEND_ALIAS"
  ( cd "$REPO_ROOT/frontend" && clever deploy --alias "$FRONTEND_ALIAS" )
}

cmd_deploy() {
  ensure_prereqs
  local target="${1:-}"
  case "$target" in
    backend)        deploy_backend ;;
    frontend)       deploy_frontend ;;
    ""|both)        deploy_backend; deploy_frontend ;;
    *)
      log_err "unknown deploy target: '$target' (expected: backend, frontend, or no argument)"
      exit 1
      ;;
  esac
}

# ─── cmd: status ────────────────────────────────────────────────
print_app_status() {
  local label="$1" alias="$2" domain="$3"
  echo
  echo "  ${BOLD}$label${NC}  $alias"
  if ! app_alias_exists "$alias"; then
    echo "    state  : ${YELLOW}not created${NC}  (run: ./scripts/setup-dev-env.sh create)"
    return
  fi
  local json
  json="$(clever status --alias "$alias" --format json 2>/dev/null || true)"
  if [[ -z "$json" ]] || ! echo "$json" | jq -e . >/dev/null 2>&1; then
    echo "    state  : ${YELLOW}created, never deployed${NC}  (cd <subdir> && clever deploy --alias $alias)"
    echo "    domain : https://$domain"
    return
  fi
  local state commit flavor build_flavor color
  state="$(       echo "$json" | jq -r '.status      // "unknown"')"
  commit="$(      echo "$json" | jq -r '.commit      // "—"' | cut -c1-7)"
  flavor="$(      echo "$json" | jq -r '.instances[0].flavor // "—"')"
  build_flavor="$(echo "$json" | jq -r '.buildFlavor // "—"')"
  case "$state" in
    running)              color="$GREEN"  ;;
    stopped|should-be-up) color="$YELLOW" ;;
    deploying|restarting) color="$BLUE"   ;;
    *)                    color="$RED"    ;;
  esac
  echo "    state  : ${color}${state}${NC}  (commit ${commit} · flavor ${flavor} · build ${build_flavor})"
  echo "    domain : https://$domain"
}

cmd_status() {
  ensure_prereqs
  detect_org_id
  log_step "Dev stack status (org $ORG_ID)"

  print_app_status "Backend " "$BACKEND_ALIAS"  "$BACKEND_DOMAIN"
  print_app_status "Frontend" "$FRONTEND_ALIAS" "$FRONTEND_DOMAIN"

  echo
  echo "  ${BOLD}Postgres${NC}  $DB_ADDON_NAME"
  if addon_exists_by_name "$DB_ADDON_NAME"; then
    local addon_id
    addon_id="$(addon_id_by_name "$DB_ADDON_NAME")"
    echo "    state  : ${GREEN}provisioned${NC}  (id ${addon_id})"
  else
    echo "    state  : ${YELLOW}missing${NC}  (run: ./scripts/setup-dev-env.sh create)"
  fi

  echo
  echo "  ${BOLD}OAuth   ${NC}  $OAUTH_CONSUMER_NAME"
  if oauth_consumer_exists "$OAUTH_CONSUMER_NAME"; then
    local key
    key="$(oauth_consumer_key_by_name "$OAUTH_CONSUMER_NAME")"
    echo "    state  : ${GREEN}provisioned${NC}  (key ${key:0:8}…)"
    echo "    base   : https://$FRONTEND_DOMAIN"
  else
    echo "    state  : ${YELLOW}missing${NC}  (run: ./scripts/setup-dev-env.sh create)"
  fi
  echo
}

# ─── cmd: destroy ───────────────────────────────────────────────
cmd_destroy() {
  ensure_prereqs
  detect_org_id

  local skip_confirm=0
  for arg in "$@"; do
    case "$arg" in
      -y|--yes) skip_confirm=1 ;;
    esac
  done

  echo "${BOLD}${RED}This will permanently delete the following dev resources:${NC}"
  echo "    app    $FRONTEND_ALIAS  (name $FRONTEND_NAME)"
  echo "    app    $BACKEND_ALIAS"
  echo "    addon  $DB_ADDON_NAME"
  echo "    OAuth  $OAUTH_CONSUMER_NAME"
  echo
  echo "  Untouched: scripts/.env.dev, .clever.json entries (clean up manually if you want),"
  echo "             prod stack, Cellar music bucket, GlitchTip projects."
  echo

  if (( skip_confirm == 0 )); then
    read -r -p "Type 'destroy' to confirm: " confirm
    if [[ "$confirm" != "destroy" ]]; then
      log_warn "aborted (got '$confirm')"
      exit 1
    fi
  fi

  # Resolve IDs/keys before deleting (apps removal removes them from .clever.json).
  local addon_id consumer_key
  addon_id="$(addon_id_by_name "$DB_ADDON_NAME" || true)"
  consumer_key="$(oauth_consumer_key_by_name "$OAUTH_CONSUMER_NAME" || true)"

  log_step "Deleting apps"
  for alias in "$FRONTEND_ALIAS" "$BACKEND_ALIAS"; do
    if app_alias_exists "$alias"; then
      if clever delete --alias "$alias" --yes >/dev/null 2>&1; then
        log_ok "deleted app $alias"
      else
        log_warn "failed to delete app $alias (check $ clever delete --alias $alias)"
      fi
    else
      log_skip "$alias not in .clever.json"
    fi
  done

  log_step "Deleting addon"
  if [[ -n "$addon_id" ]]; then
    if clever addon delete "$addon_id" --yes --org "$ORG_ID" >/dev/null 2>&1; then
      log_ok "deleted addon $DB_ADDON_NAME ($addon_id)"
    else
      log_warn "failed to delete addon $DB_ADDON_NAME"
    fi
  else
    log_skip "$DB_ADDON_NAME not found"
  fi

  log_step "Deleting OAuth consumer"
  if [[ -n "$consumer_key" ]]; then
    if clever oauth-consumers delete "$consumer_key" --yes >/dev/null 2>&1; then
      log_ok "deleted OAuth consumer $OAUTH_CONSUMER_NAME"
    else
      log_warn "failed to delete OAuth consumer $OAUTH_CONSUMER_NAME (key=$consumer_key)"
    fi
  else
    log_skip "$OAUTH_CONSUMER_NAME not found"
  fi

  echo
  echo "${BOLD}${GREEN}✓ Dev environment destroyed${NC}"
  echo "  Re-create with: ./scripts/setup-dev-env.sh create"
}

# ─── usage / dispatch ───────────────────────────────────────────
usage() {
  sed -n '2,44p' "$SCRIPT_PATH" | sed -E 's/^# ?//'
}

COMMAND="${1:-help}"
shift || true
case "$COMMAND" in
  create)         cmd_create  "$@" ;;
  start)          cmd_start   "$@" ;;
  stop)           cmd_stop    "$@" ;;
  restart)        cmd_restart "$@" ;;
  deploy)         cmd_deploy  "$@" ;;
  status)         cmd_status  "$@" ;;
  destroy)        cmd_destroy "$@" ;;
  -h|--help|help) usage; exit 0 ;;
  *)
    log_err "unknown command: $COMMAND"
    echo
    usage
    exit 1
    ;;
esac
