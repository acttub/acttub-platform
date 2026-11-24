#!/usr/bin/env bash
# 이 체크아웃의 API jar 를 버리는 Postgres 에 띄워, 바깥에서 보이는 것을 폴더 하나에 떠 둔다.
# 사용법과 비교 방법은 같은 폴더의 README.md 를 본다.
#
#   apps/api/scripts/boot-compare/snapshot.sh <출력 폴더>
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
API=$(cd "$HERE/../.." && pwd)
OUT=${1:?출력 폴더를 준다}
APP_PORT=${APP_PORT:-18080}
MGMT_PORT=${MGMT_PORT:-18081}
mkdir -p "$OUT/responses"
OUT=$(cd "$OUT" && pwd)

PG_NAME="boot-compare-pg-$$"
APP_PID=
cleanup() {
  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" 2>/dev/null || true
    for _ in $(seq 1 30); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 1; done
    kill -9 "$APP_PID" 2>/dev/null || true
  fi
  docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
  rm -f "$OUT/acting-api.jar"
}
trap cleanup EXIT

# jar 는 그것을 만든 JDK(Gradle toolchain)로 띄운다. PATH·JAVA_HOME 의 java 는 다른 버전일 수 있다(맥북 기본 21, API 25).
# SNAPSHOT_JAVA 에 java 실행 파일을 주면 그것을 쓴다.
BUILD_OUT=$(cd "$API" && ./gradlew bootJar printToolchainJava --no-daemon -q -I "$HERE/toolchain-java.gradle")
grep -v '^toolchain-java=' <<<"$BUILD_OUT" >&2 || true
JAVA=${SNAPSHOT_JAVA:-$(sed -n 's/^toolchain-java=//p' <<<"$BUILD_OUT" | tail -1)}
[[ -x "$JAVA" ]] || { echo "jar 를 띄울 java 를 찾지 못했다: '$JAVA'" >&2; exit 1; }
echo "jar 를 띄우는 java: $JAVA ($("$JAVA" -version 2>&1 | head -1))" >&2
cp "$API/build/libs/acting-api.jar" "$OUT/acting-api.jar"

docker run -d --name "$PG_NAME" -e POSTGRES_USER=acttub -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=acttub \
  -e TZ=UTC -p 127.0.0.1::5432 postgres:18-alpine >/dev/null
PG_PORT=$(docker port "$PG_NAME" 5432/tcp | head -1 | sed 's/.*://')
for _ in $(seq 1 60); do
  docker exec "$PG_NAME" pg_isready -U acttub -d acttub >/dev/null 2>&1 && break
  sleep 1
done
sleep 2

# 운영 compose 와 같은 JSON 로그(logstash)로 띄우고, 바깥 호출·배경 작업은 끈다. 개발용 로그인으로 계정을 만든다.
(
  cd "$OUT"
  exec env -i PATH="$PATH" HOME="$HOME" TZ=UTC \
    DATABASE_URL="postgresql://acttub:pw@127.0.0.1:$PG_PORT/acttub" \
    JWT_SECRET=snapshot-jwt-secret \
    ACCOUNT_IDENTITY_HASH_KEY=snapshot-identity-hash-key \
    ACCOUNT_TOKEN_ENCRYPTION_KEY=snapshot-token-encryption-key \
    SITE_URL=https://snapshot.acttub.invalid \
    ADMIN_OPS_TOKEN=snapshot-admin-token \
    MONITORING_TOKEN=snapshot-monitoring-token \
    GEMINI_API_KEY=snapshot-not-a-real-key GEMINI_MODEL=gemini-2.5-flash \
    DEVELOPMENT_AUTH_PROVIDER=true \
    LOGGING_STRUCTURED_FORMAT_CONSOLE=logstash \
    MANAGEMENT_SERVER_PORT="$MGMT_PORT" SERVER_PORT="$APP_PORT" \
    VIDEO_POSTER_ENABLED=false AUDITION_ENABLED=false \
    CHALLENGE_MOSAIC_ENABLED=false CHALLENGE_MODERATION_ENABLED=false CHALLENGE_FACE_BACKFILL=false \
    "$JAVA" -Dacttub.dotenv.enabled=false -jar acting-api.jar > startup.log 2>&1
) &
APP_PID=$!

ready=
for _ in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:$APP_PORT/health" >/dev/null 2>&1 && { ready=1; break; }
  kill -0 "$APP_PID" 2>/dev/null || { echo "앱이 기동하다 죽었다: $OUT/startup.log" >&2; exit 1; }
  sleep 1
done
[[ -n "$ready" ]] || { echo "120초 안에 /health 가 답하지 않았다: $OUT/startup.log" >&2; exit 1; }
sleep 3
wc -l < "$OUT/startup.log" | tr -d ' ' > "$OUT/startup-lines.txt"

TOKEN=
# 응답 하나를 상태줄, 보는 헤더, 본문 순서로 responses/<name>.txt 에 남긴다.
req() { # name method path [body]
  local name=$1 method=$2 path=$3 body=${4:-}
  local args=(-sS -o "$OUT/responses/$name.body" -D "$OUT/responses/$name.head" -X "$method"
    -H 'X-Acttub-Trace-Id: 0123456789abcdef0123456789abcdef' -H 'X-Acttub-Client: web/snapshot')
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' --data "$body")
  # 연결이 끊겨 응답이 없으면 그 사실을 남긴다. 양쪽 다 비어 같아 보이는 일을 막는다(compare.py 가 이 줄을 실패로 센다).
  curl "${args[@]}" "http://127.0.0.1:$APP_PORT$path" || echo "요청 실패" > "$OUT/responses/$name.head"
  {
    head -1 "$OUT/responses/$name.head" | tr -d '\r'
    grep -iE '^(content-type|x-acttub-trace-id|www-authenticate|allow|location|cache-control|vary|x-content-type-options|x-frame-options):' \
      "$OUT/responses/$name.head" | tr -d '\r' | awk -F': ' '{printf "%s: %s\n", tolower($1), $2}' | sort
    echo
    cat "$OUT/responses/$name.body"
    echo
  } > "$OUT/responses/$name.txt"
  rm -f "$OUT/responses/$name.head" "$OUT/responses/$name.body"
}

req health GET /health
req health-without-client GET /health
req not-found GET /v2/does-not-exist
req unauth GET /v2/practices
req unauth-post POST /v2/practices '{}'
req method-not-allowed DELETE /health
req bad-json POST /v2/auth/login '{"provider":'
req validation POST /v2/auth/login '{"provider":"development","id_token":1}'
req unknown-provider POST /v2/auth/login '{"provider":"nope","id_token":"x"}'
# JSON 라이브러리 기본값이 갈리는 입력(SOMA-1103): 같은 키 두 번, 값 뒤에 붙은 글자, 깊은 중첩.
req duplicate-key POST /v2/auth/login '{"provider":"nope","provider":"development","id_token":"x"}'
req trailing-token POST /v2/auth/login '{"provider":"nope","id_token":"x"} trailing'
req bad-json-property-name POST /v2/auth/login '{provider:"nope"}'
req bad-json-unclosed POST /v2/auth/login '{"provider":"nope","id_token":"x"'
req bad-json-escape POST /v2/auth/login '{"provider":"nope","id_token":"\😀"}'
req deep-nesting POST /v2/auth/login "{\"provider\":\"nope\",\"id_token\":$(printf '[%.0s' $(seq 1 600))$(printf ']%.0s' $(seq 1 600))}"
req root GET /
req actuator-on-app GET /actuator/health
req swagger-redirect GET /swagger-ui.html
req api-docs GET /v3/api-docs
req swagger-ui GET /swagger-ui/index.html
req swagger-config GET /v3/api-docs/swagger-config
req login POST /v2/auth/login '{"provider":"development","id_token":"snapshot-user:snap@acttub.invalid"}'
SIGNUP=$(python3 -I -c "
import json,sys
d=json.loads(open(sys.argv[1]).read().split('\n\n',1)[1])
print(json.dumps({'signup_token':d['signup_token'],'age_confirmed':True,
  'decisions':[{'document_id':x['id'],'action':'granted'} for x in d['documents']]}))" "$OUT/responses/login.txt")
req signup POST /v2/auth/signup "$SIGNUP"
TOKEN=$(python3 -I -c "import json,sys; print(json.loads(open(sys.argv[1]).read().split('\n\n',1)[1])['access_token'])" "$OUT/responses/signup.txt")
req profile PUT /v2/me/profile '{"name":"스냅샷","gender":"unspecified","birth_date":"2001-03-14","directions":["stage"],"experience":"under_1y","goal":"hobby","bio":null}'
for path in /v2/me /v2/consents/pending /v2/consents/documents /v2/consents/entry /v2/me/notification-settings \
    /v2/me/notifications /v2/me/notifications/unread-count /v2/practices /v2/practices/days /v2/videos /v2/portfolio \
    /v2/reading/scripts /v2/reading/examples /v2/app/config /v2/app/notices /v2/auth/providers /v2/community/categories \
    /v2/challenges /v2/me/memory /v2/support/inquiries/mine; do
  req "auth${path//\//_}" GET "$path"
done
req auth-method-not-allowed PUT /v2/me/notification-settings '{"nope":true}'
req auth-bad-uuid GET /v2/practices/not-a-uuid
req auth-missing-practice GET /v2/practices/00000000-0000-4000-8000-000000000000
req auth-unknown-field PATCH /v2/me/notification-settings '{"nope":true}'
req auth-wrong-type PATCH /v2/me/notification-settings '{"challenge":"yes"}'
req auth-duplicate-key PATCH /v2/me/notification-settings '{"challenge":true,"challenge":false}'
req auth-trailing-token PATCH /v2/me/notification-settings '{"challenge":true} trailing'
TOKEN=

MON=(-sS -H "Authorization: Bearer snapshot-monitoring-token")
curl "${MON[@]}" -o "$OUT/responses/mgmt-health.txt" -w '\n%{http_code}\n' "http://127.0.0.1:$MGMT_PORT/actuator/health" || true
curl "${MON[@]}" -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$MGMT_PORT/actuator" > "$OUT/responses/mgmt-discovery.txt" || true
curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$MGMT_PORT/actuator/prometheus" > "$OUT/responses/mgmt-without-token.txt" || true
sleep 1
curl "${MON[@]}" "http://127.0.0.1:$MGMT_PORT/actuator/prometheus" > "$OUT/prometheus.raw" || true

kill "$APP_PID" 2>/dev/null || true
for _ in $(seq 1 30); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 1; done
APP_PID=

# 위 요청들이 남긴 DB. 스키마와 저장 값(행 순서는 정렬). Flyway 이력은 실행 시간이 매번 달라 뺀다.
docker exec "$PG_NAME" pg_dump -U acttub -d acttub --schema-only --no-owner --no-privileges \
  | grep -v '^--' | grep -v '^$' > "$OUT/db-schema.sql"
docker exec "$PG_NAME" pg_dump -U acttub -d acttub --data-only --no-owner --inserts --rows-per-insert=1 \
  --exclude-table=flyway_schema_history | grep '^INSERT' | sort > "$OUT/db-data.sql"

python3 -I "$HERE/digest.py" "$OUT"
echo "떠 둔 폴더: $OUT"
