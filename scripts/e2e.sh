#!/usr/bin/env bash
# Selaintestit päästä päähän: oikea Chrome (headless) ja virtuaalinen passkey-autentikaattori.
# Käynnistää erillisen kehityspalvelimen väliaikaisella tietokannalla, joten oma var/-kanta ei muutu.
#
#   scripts/e2e.sh                     # kaikki testit
#   scripts/e2e.sh live-polls.mjs      # yksi testi (tests/e2e/)
#
# Chromen polun voi antaa muuttujalla CHROME=..., portit E2E_PORT (oletus 8091) ja E2E_CDP (9333).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${E2E_PORT:-8091}
CDP=${E2E_CDP:-9333}
CHROME=${CHROME:-}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome google-chrome-stable chromium chromium-browser; do
    if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then CHROME=$c; break; fi
  done
fi
[ -n "$CHROME" ] || { echo "Chromea ei löytynyt. Aseta CHROME=/polku/chromeen" >&2; exit 2; }

TMP=$(mktemp -d)
SERVER=""
BROWSER=""
cleanup() {
  # Ensin php -S:n työprosessit (lapset), sitten pääprosessi.
  [ -n "$SERVER" ] && { pkill -P "$SERVER" 2>/dev/null; kill "$SERVER" 2>/dev/null; } || true
  [ -n "$BROWSER" ] && kill "$BROWSER" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

if curl -s -o /dev/null "http://localhost:$PORT/"; then
  echo "Portti $PORT on jo käytössä (jäikö edellinen ajo päälle?). Vapauta se tai aseta E2E_PORT." >&2
  exit 2
fi
mkdir -p "$TMP/data"
php -r '
  [$dir, $port] = [$argv[1], $argv[2]];
  $c = [
    "base_path" => "", "public_origin" => "http://localhost:$port", "rp_id" => "localhost",
    "db_path" => "$dir/data/hessutalks.sqlite", "session_path" => "$dir/data/sessions",
    "app_secret" => bin2hex(random_bytes(32)), "setup_token_hash" => password_hash("E2E-TESTI-TOKEN", PASSWORD_DEFAULT),
    "admin_name" => "E2E", "cookie_secure" => false,
  ];
  file_put_contents("$dir/config.php", "<?php\nreturn " . var_export($c, true) . ";\n");
' "$TMP" "$PORT"

# Useampi työprosessi: yksisäikeinen php -S jumittuu Chromen ennakoiviin yhteyksiin (tuotannossa Apache).
(cd "$ROOT" && PHP_CLI_SERVER_WORKERS=4 HESSUTALKS_CONFIG="$TMP/config.php" exec php -S "localhost:$PORT" -t public bin/dev-router.php >"$TMP/server.log" 2>&1) &
SERVER=$!
# Automaatiossa ikkunat eivät saa jäädä "taustalle": muuten Chrome hidastaa ajastimia ja sivu luulee olevansa piilossa.
# Jokainen testi saa oman, puhtaan selaimen (ei edellisen testin ikkunoita, evästeitä eikä passkeyta).
start_browser() {
  rm -rf "$TMP/chrome"
  "$CHROME" --headless=new --remote-debugging-port="$CDP" --user-data-dir="$TMP/chrome" --no-first-run --no-default-browser-check \
    --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding about:blank >"$TMP/chrome.log" 2>&1 &
  BROWSER=$!
  for _ in $(seq 1 50); do
    curl -sf "http://127.0.0.1:$CDP/json/version" >/dev/null && curl -sf -o /dev/null "http://localhost:$PORT/healthz" && return
    sleep 0.2
  done
}
stop_browser() {
  [ -n "$BROWSER" ] && kill "$BROWSER" 2>/dev/null && wait "$BROWSER" 2>/dev/null || true
  BROWSER=""
}

if [ $# -gt 0 ]; then TESTS=("$@"); else TESTS=("passkey-prf.mjs" "passkey-prf.mjs noprf" "live-polls.mjs" "import-json.mjs" "open-text.mjs" "reveal.mjs"); fi
status=0
for t in "${TESTS[@]}"; do
  echo "== $t"
  rm -rf "$TMP/data/hessutalks.sqlite"* "$TMP/data/sessions"   # jokainen testi aloittaa tyhjästä
  read -r file extra <<<"$t"
  start_browser
  # shellcheck disable=SC2086
  if ! node "$ROOT/tests/e2e/$file" "$CDP" "http://localhost:$PORT" $extra; then status=1; fi
  stop_browser
done
if grep -iE "fatal|warning|error" "$TMP/server.log" | grep -v "Accepted\|Closing" >/dev/null; then
  echo "Palvelinlokissa virheitä:" >&2
  grep -iE "fatal|warning|error" "$TMP/server.log" | grep -v "Accepted\|Closing" >&2
  status=1
fi
exit $status
