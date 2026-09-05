#!/usr/bin/env bash
# 운영 자격증명 없이 검증: 실제 PG18 dump → AWS CLI 경계의 임시 저장소 → download → 빈 DB restore.
# 임시 컨테이너·네트워크만 만들고 EXIT에서 정리한다. BACKUP_SMOKE_IMAGE로 이미 구운 이미지를 재사용한다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${BACKUP_SMOKE_IMAGE:-acttub-backup-smoke:local}"
PROJECT="acttub-backup-smoke-$$"
TMP="$(mktemp -d)"
cleanup() {
  docker rm -fv "$PROJECT-db" "$PROJECT-schedule" >/dev/null 2>&1 || true
  docker network rm "$PROJECT" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

if [ -z "${BACKUP_SMOKE_IMAGE:-}" ]; then
  docker build -t "$IMAGE" "$ROOT/deploy/home/backup"
fi
docker run --rm --entrypoint python3 -v "$ROOT/deploy/home/backup:/src:ro" "$IMAGE" \
  -m unittest discover -s /src/tests -v

mkdir -p "$TMP/bin" "$TMP/s3" "$TMP/state"
cp "$ROOT/deploy/home/backup/tests/fake_aws.py" "$TMP/bin/aws"
chmod 755 "$TMP/bin/aws"
docker network create "$PROJECT" >/dev/null
docker run -d --name "$PROJECT-db" --network "$PROJECT" \
  -e POSTGRES_USER=acttub -e POSTGRES_PASSWORD=smokePassword -e POSTGRES_DB=source \
  postgres:18-alpine >/dev/null
for attempt in {1..60}; do
  if docker exec "$PROJECT-db" pg_isready -h 127.0.0.1 -U acttub -d source >/dev/null 2>&1; then break; fi
  [ "$attempt" -lt 60 ] || { echo 'PostgreSQL did not become ready' >&2; exit 1; }
  sleep 1
done
docker exec -i "$PROJECT-db" psql -X -v ON_ERROR_STOP=1 -U acttub -d source > /dev/null <<'SQL'
CREATE TABLE backup_probe (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label text NOT NULL UNIQUE, payload jsonb);
INSERT INTO backup_probe(label, payload) VALUES ('한글 복원', '{"verified": true}'), ('second', NULL);
CREATE TABLE backup_child (parent_id bigint REFERENCES backup_probe(id), amount integer CHECK(amount > 0));
INSERT INTO backup_child VALUES (1, 7), (2, 9);
CREATE VIEW backup_totals AS SELECT count(*) AS entries, sum(amount) AS total FROM backup_child;
CREATE DATABASE restored TEMPLATE template0;
SQL

backup_run() {
  # bind mount에 만드는 0700 상태·S3 디렉터리를 Linux CI 러너도 EXIT에서 지울 수 있게 소유자를 맞춘다.
  docker run --rm --user "$(id -u):$(id -g)" --network "$PROJECT" -v "$TMP:/test" \
    -e PATH=/test/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    -e PGHOST="$PROJECT-db" -e PGUSER=acttub -e PGPASSWORD=smokePassword -e PGDATABASE=source \
    -e BACKUP_S3_BUCKET=acttub-db-backups -e BACKUP_S3_PREFIX=prod/ \
    -e BACKUP_STATE_DIR=/test/state -e FAKE_S3_DIR=/test/s3 "$@"
}

backup_run "$IMAGE" once
backup_run "$IMAGE" health
# 다운로드도 같은 AWS CLI 경계로 간다. 복원 입력은 로컬 dump 임시파일이 아니라 업로드된 객체다.
backup_run --entrypoint sh "$IMAGE" -ec '
  uri=$(python3 -c "import json; print(json.load(open(\"/test/state/status.json\"))[\"last_success_uri\"])")
  aws s3 cp "$uri" /test/download.dump
  python3 -c "import hashlib,json; s=json.load(open(\"/test/state/status.json\")); assert hashlib.file_digest(open(\"/test/download.dump\", \"rb\"), \"sha256\").hexdigest() == s[\"last_success_sha256\"]"
  pg_restore -h "$PGHOST" -U "$PGUSER" -d restored --no-owner --no-privileges --exit-on-error --single-transaction /test/download.dump
'
QUERY="SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM backup_probe t; SELECT * FROM backup_totals; SELECT nextval('backup_probe_id_seq');"
docker exec "$PROJECT-db" psql -X -At -v ON_ERROR_STOP=1 -U acttub -d source -c "$QUERY" > "$TMP/source.txt"
docker exec "$PROJECT-db" psql -X -At -v ON_ERROR_STOP=1 -U acttub -d restored -c "$QUERY" > "$TMP/restored.txt"
diff -u "$TMP/source.txt" "$TMP/restored.txt"
if docker exec "$PROJECT-db" psql -X -v ON_ERROR_STOP=1 -U acttub -d restored \
  -c 'INSERT INTO backup_child VALUES (999, 1)' > "$TMP/constraint.log" 2>&1; then
  echo 'Restored foreign key did not reject invalid row' >&2; exit 1
fi
if backup_run -e FAKE_AWS_MODE=fail-upload "$IMAGE" once > "$TMP/failure.log" 2>&1; then
  echo 'Upload failure incorrectly exited zero' >&2; exit 1
fi
if backup_run "$IMAGE" health; then
  echo 'Failed backup incorrectly stayed healthy' >&2; exit 1
fi
grep -q 'upload failed' "$TMP/failure.log"
if grep -q 'MUST_NOT_LEAK' "$TMP/failure.log"; then
  echo 'External command output leaked' >&2; exit 1
fi
backup_run "$IMAGE" once
backup_run "$IMAGE" health

# 실제 scheduler를 다음 분에 실행해 최초 백업 뒤 예약 실행이 또 객체를 만드는지 확인한다.
# 분 경계까지 5초 미만이면 그다음 분을 써 컨테이너 기동 시간 때문에 놓치는 테스트를 피한다.
SCHEDULE="$(docker run --rm --entrypoint python3 "$IMAGE" -c '
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
now = datetime.now(ZoneInfo("Asia/Seoul"))
print((now + timedelta(minutes=2 if now.second >= 55 else 1)).strftime("%H:%M"))
')"
backup_run -d --name "$PROJECT-schedule" -e BACKUP_STATE_DIR=/test/schedule-state \
  -e BACKUP_SCHEDULE="$SCHEDULE" "$IMAGE" schedule >/dev/null
for attempt in {1..85}; do
  if docker exec "$PROJECT-schedule" python3 -c '
import json
from pathlib import Path
p = Path("/test/schedule-state/status.json")
s = json.loads(p.read_text()) if p.exists() else {}
first = Path("/test/first-scheduled-uri")
uri = s.get("last_success_uri", "")
if uri and not first.exists(): first.write_text(uri)
raise SystemExit(0 if uri and first.exists() and uri != first.read_text() and s.get("last_result") == "success" else 1)
'; then break; fi
  [ "$attempt" -lt 85 ] || { docker logs "$PROJECT-schedule"; echo 'Scheduled backup did not run' >&2; exit 1; }
  sleep 1
done
docker exec "$PROJECT-schedule" python3 /opt/backup/backup.py health
echo '✔ backup CLI failures, real PG18 dump/download/restore, data/sequence/view/FK, and scheduled second backup passed'
