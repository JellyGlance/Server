#!/usr/bin/env bash
# Upgrade-path test: start the previous JellyGlance release on a fresh database,
# seed it the way a real install would be, then start the new image on the same
# database and check that nothing users rely on broke.
#
# Needs only Docker and Node. No registry credentials or repository secrets, so it
# also runs on fork PRs.
#
#   OLD_IMAGE   previous release to upgrade from (default ghcr.io/jellyglance/server:latest)
#   NEW_IMAGE   image under test (default jellyglance:upgrade-test)
#   HOST_PORT   host port for the app (default 3300)
set -euo pipefail

OLD_IMAGE="${OLD_IMAGE:-ghcr.io/jellyglance/server:latest}"
NEW_IMAGE="${NEW_IMAGE:-jellyglance:upgrade-test}"
PG_IMAGE="${PG_IMAGE:-mirror.gcr.io/library/postgres:18-alpine}"
HOST_PORT="${HOST_PORT:-3300}"
PREFIX="${PREFIX:-jg-upgrade-test}"
NET="${PREFIX}-net"
DB="${PREFIX}-db"
APP="${PREFIX}-app"
STUB="${PREFIX}-stub"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"

# Throwaway values for a throwaway database; nothing here is a real credential.
PG_PASS="upgrade-test-db"
JWT="upgrade-test-jwt-$(date +%s)"
JF_KEY="upgrade-test-key"
ADMIN_USER="upgrade-admin"
ADMIN_PASS="Upgrade-Test-Pass-1"
SMTP_PASS="smtp-pass-under-crypto-js"
APP_URL="http://127.0.0.1:${HOST_PORT}"
STUB_URL="http://${STUB}:8096"

log() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nFAIL: %s\n' "$*" >&2; docker logs --tail 80 "${APP}" 2>&1 || true; exit 1; }

cleanup() {
  docker rm -f "${APP}" "${DB}" "${STUB}" >/dev/null 2>&1 || true
  docker network rm "${NET}" >/dev/null 2>&1 || true
  rm -rf "${WORK}"
}
trap cleanup EXIT

wait_for_app() {
  for _ in $(seq 1 90); do
    if curl -fsS "${APP_URL}/auth/isConfigured" >"${WORK}/configured.json" 2>/dev/null; then
      if [ "$(node -p "require('${WORK}/configured.json').state" 2>/dev/null)" = "2" ]; then return 0; fi
    fi
    sleep 2
  done
  fail "app at ${APP_URL} did not report state 2"
}

start_app() {
  local image="$1"; shift
  docker rm -f "${APP}" >/dev/null 2>&1 || true
  docker run -d --name "${APP}" --network "${NET}" -p "127.0.0.1:${HOST_PORT}:3000" \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="${PG_PASS}" -e POSTGRES_IP="${DB}" \
    -e POSTGRES_PORT=5432 -e POSTGRES_DB=jellyglance -e JWT_SECRET="${JWT}" -e TZ=UTC \
    "$@" "${image}" >/dev/null
  wait_for_app
}

login() {
  local body
  body="$(curl -fsS -X POST "${APP_URL}/auth/login" -H 'content-type: application/json' \
    -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}")" || return 1
  node -e 'const t=JSON.parse(process.argv[1]).token;if(!t)process.exit(1);process.stdout.write(t)' "${body}"
}

# Every request the media server stub has seen, one "METHOD /path" per line.
stub_requests() {
  docker exec "${STUB}" node -e 'fetch("http://127.0.0.1:8096/__stub/requests").then((r)=>r.text()).then((t)=>process.stdout.write(t))'
}

psql_db() { docker exec -i "${DB}" psql -v ON_ERROR_STOP=1 -U postgres -d jellyglance -tA "$@"; }

log "postgres"
docker network create "${NET}" >/dev/null
chmod 777 "${WORK}"

log "media server stub (${STUB})"
# Any image with Node will do; the image under test is always available locally.
docker run -d --name "${STUB}" --network "${NET}" --entrypoint node \
  -v "${HERE}:/stub:ro" \
  -e STUB_PORT=8096 -e STUB_API_KEY="${JF_KEY}" \
  "${NEW_IMAGE}" /stub/media-server-stub.cjs >/dev/null
docker run -d --name "${DB}" --network "${NET}" -e POSTGRES_PASSWORD="${PG_PASS}" -e POSTGRES_DB=jellyglance "${PG_IMAGE}" >/dev/null
for _ in $(seq 1 30); do docker exec "${DB}" pg_isready -U postgres -d jellyglance >/dev/null 2>&1 && break; sleep 1; done

log "old release: ${OLD_IMAGE}"
start_app "${OLD_IMAGE}" \
  -e JF_HOST="${STUB_URL}/" -e JF_API_KEY="${JF_KEY}" \
  -e JS_AUTH_MODE=local -e JS_USER="${ADMIN_USER}" -e JS_PASSWORD="${ADMIN_PASS}" -e JS_SKIP_FIRST_RUN=true
OLD_VERSION="$(node -p "require('${WORK}/configured.json').version")"
echo "old version: ${OLD_VERSION}"
login >/dev/null || fail "admin login on the old release"

log "seed SMTP password with the old crypto-js encryption"
ENCRYPTED="$(docker exec -w /app/apps/api -e PLAIN="${SMTP_PASS}" "${APP}" \
  node -e '
// Same output as crypto-js AES.encrypt(text, passphrase): OpenSSL "Salted__" format,
// EVP_BytesToKey (MD5) key derivation, AES-256-CBC. Built-in crypto only, because
// newer release images no longer ship crypto-js.
const c=require("crypto");const salt=c.randomBytes(8);const pass=Buffer.from(process.env.JWT_SECRET);
let d=Buffer.alloc(0),prev=Buffer.alloc(0);
while(d.length<48){prev=c.createHash("md5").update(Buffer.concat([prev,pass,salt])).digest();d=Buffer.concat([d,prev]);}
const ci=c.createCipheriv("aes-256-cbc",d.subarray(0,32),d.subarray(32,48));
const ct=Buffer.concat([ci.update(process.env.PLAIN,"utf8"),ci.final()]);
process.stdout.write(Buffer.concat([Buffer.from("Salted__"),salt,ct]).toString("base64"));')"
[ -n "${ENCRYPTED}" ] || fail "could not produce a crypto-js ciphertext"
psql_db -v enc="${ENCRYPTED}" <<'SQL'
UPDATE app_config
SET settings = jsonb_set(
  COALESCE(settings::jsonb, '{}'::jsonb),
  '{Newsletter}',
  jsonb_build_object('smtp', jsonb_build_object('host', 'smtp.example.invalid', 'port', 587, 'username', 'mailer', 'password', :'enc'))
)::json
WHERE "ID" = 1;
SQL

log "upgrade to ${NEW_IMAGE} on the same database (no bootstrap env)"
docker stop "${APP}" >/dev/null
# Only look at requests made by the new release.
STUB_MARK="$(stub_requests | wc -l)"
new_requests() { stub_requests | tail -n "+$((STUB_MARK + 1))"; }
start_app "${NEW_IMAGE}"
NEW_VERSION="$(node -p "require('${WORK}/configured.json').version")"
echo "new version: ${NEW_VERSION}"

log "check: admin login still works"
TOKEN="$(login)" || fail "admin login after upgrade"

log "check: stored config survived"
curl -fsS "${APP_URL}/api/getconfig" -H "authorization: Bearer ${TOKEN}" >"${WORK}/config.json" || fail "GET /api/getconfig"
node -e '
  const c = require(process.argv[1]);
  const host = String(c.JF_HOST || "");
  if (!host.startsWith(process.argv[2])) { console.error("JF_HOST is", host); process.exit(1); }
  if (host.endsWith("/")) { console.error("JF_HOST still ends with a slash:", host); process.exit(1); }
' "${WORK}/config.json" "${STUB_URL}" || fail "config after upgrade"

log "check: media server requests are built correctly"
curl -fsS "${APP_URL}/proxy/getAdminUsers" -H "authorization: Bearer ${TOKEN}" >"${WORK}/admins.json" || fail "GET /proxy/getAdminUsers"
node -e 'const a=require(process.argv[1]); if(!Array.isArray(a)||!a.some(u=>u.Name==="upgrade-admin")){console.error(JSON.stringify(a));process.exit(1)}' "${WORK}/admins.json" \
  || fail "admin users from the media server"
if new_requests | grep -q ' //'; then
  new_requests | grep ' //' | sort | uniq -c
  fail "the new release sent double-slash paths to the media server"
fi
new_requests | grep -qi ' /users' || fail "the new release never asked the media server for users"

log "check: SMTP password from the old release still decrypts"
STORED="$(psql_db -c "SELECT settings->'Newsletter'->'smtp'->>'password' FROM app_config WHERE \"ID\"=1")"
DECRYPTED="$(docker exec -w /app/apps/api -e STORED="${STORED}" "${APP}" \
  node -e 'const {decryptPassword}=require("./classes/smtp-mailer");process.stdout.write(decryptPassword(process.env.STORED));process.exit(0)')"
[ "${DECRYPTED}" = "${SMTP_PASS}" ] || fail "SMTP password did not decrypt after upgrade"

log "upgrade ${OLD_VERSION} -> ${NEW_VERSION}: all checks passed"
