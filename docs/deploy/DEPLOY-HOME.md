# 홈서버 배포

dev와 운영은 홈서버의 별도 Docker Compose 프로젝트로 배포한다. 운영 전환은
[운영 전환·복구 런북](./DEPLOY-HOME-CUTOVER.md)을 따른다. 이 문서의 절차가 준비됐다는 사실과
실제 운영 전환 완료는 별개다. 전환 완료 전 AWS 운영 절차는 [DEPLOY-VPC.md](./DEPLOY-VPC.md)가 맡고,
전환 뒤에도 복구용으로 유지한다. 7절의 dev 기록은 2026-09-03 실측이며 현재 운영 데이터의 증거가 아니다.

## 1. 구조와 범위

```text
Cloudflare → 환경별 Tunnel → cloudflared → web:3000 → api:8080 → db:5432
GitHub Actions → GHCR 이미지 → Tailscale 임시 노드 → SSH → deploy.sh
PostgreSQL → 매일 pg_dump → S3 백업 / 영상 → 기존 S3 영상 버킷
```

| 항목 | dev | 운영 |
|---|---|---|
| 브랜치 / 프로젝트 | `dev` / `acttub-dev` | `main` / `acttub-prod` |
| 서버 디렉터리 | `/svc/acttub/dev` | `/svc/acttub/prod` |
| DB 볼륨 | `acttub-dev_pgdata` | `acttub-prod_pgdata` |
| 터널 / 공개 주소 | `acttub-dev` / `https://dev.acttub.com` | `acttub-prod` / `https://acttub.com` |
| API 메모리 / 웹 메모리 / DB 메모리 | `1536m` / `512m` / `512m` | `3g` / `1g` / `1536m` |

[`compose.yml`](../../deploy/home/compose.yml) 하나를 쓰되 DB·볼륨·시크릿·터널은 공유하지 않는다.
호스트 포트는 공개하지 않는다. 영상 S3 버킷과 OAuth의 운영 도메인은 유지한다.
API 이미지는 `api:<sha>`, 웹 이미지는 빌드 시점의 공개 설정을 담은 `web:<env>-<sha>`, 백업은 `backup:<sha>`다.
DB는 PostgreSQL 18 계열이며 실제 서버 버전과 이미지 ID는 작업할 때 다시 확인한다.

## 2. 서버 준비와 시크릿

서버에 Docker·Compose·Tailscale SSH와 `deploy` 계정, 환경별 디렉터리를 준비한다.
`deploy`의 Docker 권한은 호스트 관리자 수준이므로 Tailscale의 배포 허용 대상을 해당 계정과
`tag:ci`로 제한한다. Actions는 임시 노드로 접속하며 서버 SSH 개인키를 저장소에 넣지 않는다.

[`deploy/home/.env.example`](../../deploy/home/.env.example)을 환경별 `.env`로 복사하고 권한을
`600`으로 둔다. 키의 정확한 목록과 기본값은 이 파일과 Compose가 정본이다.

| 설정 | 확인할 값 |
|---|---|
| 프로젝트 / 프로필 | `COMPOSE_PROJECT_NAME=acttub-<env>`, `COMPOSE_PROFILES=edge,backup` |
| DB | `POSTGRES_PASSWORD`; 사용자·DB 기본값은 `acttub`. `DATABASE_URL`은 Compose가 조립 |
| 기존 운영 인증 | `JWT_SECRET`, `ADMIN_OPS_TOKEN`, Apple·Google OAuth client ID를 기존 운영과 대조 |
| 외부 서비스 | `GEMINI_API_KEY`, `OPENAI_API_KEY`, 모델 설정, `SENTRY_DSN`, `SENTRY_ENVIRONMENT` |
| 영상 저장소 | 해당 환경의 `S3_BUCKET`, `AWS_REGION`, 그 버킷만 허용하는 AWS 자격증명 |
| 터널 | 환경별 `TUNNEL_TOKEN`; Cloudflare 서비스 주소는 `http://web:3000` |
| 백업 | 백업 버킷과 환경별 prefix, AWS 권한, §5의 주기·실제 업로드 확인 |
| 운영 자원 | `API_MEM_LIMIT=3g`, `WEB_MEM_LIMIT=1g`, `DB_MEM_LIMIT=1536m` |
| 전환 준비 중 | `ANALYSIS_WORKER_ENABLED=false`; 운영에서 `DEVELOPMENT_AUTH_PROVIDER` 비활성 |

JWT 서명 키를 유지해야 기존 로그인 세션을 이어받는다. `.env`의 존재나 Compose 기동만으로
시크릿 이전 완료라고 판정하지 않는다. 값을 로그에 출력하지 않고 필수 키 충족 및 실제 기능으로 확인한다.
배포는 `.env`를 덮지 않으며, SHA와 이미지 주소를 담은 `release.env`만 갱신한다.

## 3. Actions와 일상 배포

브랜치와 PR은 [브랜치 전략](../BRANCHING-STRATEGY.md)을 따른다. `main`·`dev`에 직접 push하지 않는다.
운영 수동 배포는 반드시 `main` ref에서 실행한다. 운영 전환 준비·데이터 이전 중에는 런북의
배포 동결과 워커 중지 조건이 이 절의 일상 배포보다 우선한다.

GitHub 환경마다 `TS_OAUTH_CLIENT_ID`·`TS_OAUTH_SECRET` 접속 설정, 공개 웹 빌드 설정,
`HOME_PUBLIC_URL`을 확인한다. GHCR 패키지는 서버가 읽을 수 있어야 한다.
웹 공개 설정을 바꾸고 같은 SHA를 배포하면 `rebuild_images=true`로 이미지를 다시 만든다.
변수만 변경해도 기존 웹 이미지 내부 설정은 바뀌지 않는다.

```bash
gh workflow run deploy.yml --ref main -f environment=prod -f destination=home -f target=both
```

Actions가 이미지 세 개를 빌드·게시한 뒤 서버의 배포·복원 파일을 전송하고 `deploy.sh`를 실행한다.
처음 만든 GHCR 백업 패키지도 서버가 읽을 수 있는지 확인한다. 복원 도구는 `restore-db.sh`와
`db-manifest.sql`·`schema-fingerprint.sql`을 함께 전송한다.
이 스크립트는 앱 이미지 pull → Compose 기동·healthy 대기 → 웹 경유 `/health.commit` 대조를 한다.
공개 URL 대조까지 성공해야 터널을 통한 배포를 확인한 것이다. `.env`나 전체 Compose 설정을
로그에 찍지 말고, 필요한 상태·이미지 ID·릴리스 SHA만 기록한다.

홈서버는 전체 스택(`target=both`)을 배포한다. 수동 `destination=aws-rollback`은 운영 AWS 복구용이며
`fe`·`be-java`·`both`·`be-java-baseline` 기존 대상을 쓴다. DB 이전과 DNS 복구를 대신하지 않는다.

```bash
cd /svc/acttub/prod
docker compose --env-file .env --env-file release.env ps
docker compose --env-file .env --env-file release.env logs --since 10m --tail 100 api
curl -fsS https://acttub.com/health
```

## 4. 코드 배포 복구

DB 스키마와 호환되는 직전 운영 SHA 및 이미지로 `deploy.sh`를 다시 실행한다. 현재 이미지와
`release.env`의 SHA를 먼저 기록한다. 실패했다고 자동으로 직전 이미지가 복구되지는 않는다.
같은 SHA 재배포는 멱등이지만 DB 마이그레이션이나 사용자 쓰기를 되돌리지는 않는다.
Git revert는 [브랜치 전략의 운영 롤백](../BRANCHING-STRATEGY.md#운영-롤백)에 따라 `dev` 역병합까지 한다.

호스트를 AWS로 되돌리는 일은 코드 복구와 다르다. 홈서버에서 쓰기가 발생한 뒤에는
최종 홈서버 DB를 AWS로 옮겨 검증하기 전까지 AWS 앱을 다시 열지 않는다. 구체적인 순서는 운영 런북에 있다.

## 5. 자동 백업과 복원 검증

dev·운영 모두 매일 04:00 KST에 `pg_dump -Fc`를 S3의 환경별 경로에 올리고 30일 보관한다.
백업에는 사용자 데이터와 인증 정보가 포함되므로 S3의 공개 접근을 차단하고 환경별 권한을 둔다.
S3 lifecycle의 30일 만료 규칙은 AWS 설정이며 컨테이너가 뜬 것만으로 생기지 않는다.

백업 이미지는 `backup:<sha>`이며 `release.env`의 `BACKUP_IMAGE`로 고정한다.
`.env`에 `BACKUP_S3_BUCKET=acttub-db-backups`, `BACKUP_S3_PREFIX=dev/` 또는 `prod/`를 설정한다.
`BACKUP_SCHEDULE`을 생략하면 `04:00`이다. 백업은 `schedule` 모드로 실행하며 첫 실행, 실패 후,
성공한 지 26시간이 지났거나 중단 중 예약을 놓쳤을 때 바로 한 번 백업한다.

```bash
cd /svc/acttub/prod
docker compose --env-file .env --env-file release.env exec -T backup python3 /opt/backup/backup.py once
docker compose --env-file .env --env-file release.env exec -T backup python3 /opt/backup/backup.py health
docker compose --env-file .env --env-file release.env logs --since 26h --tail 100 backup
```

업로드에는 S3의 AES256 서버 암호화와 SHA-256 metadata를 사용하고, HEAD로 크기와 metadata를 대조한다.
`backup_state` 볼륨의 `/var/lib/acttub-backup/status.json`에는 마지막 성공 시각·객체 주소·해시와 실패 상태가
남는다. 최근 성공이 26시간 이내이고 백업 목적지가 현재 설정과 같으며 미해결 실패가 없을 때만 health가 성공한다.
실패 시 Docker 재시작과 unhealthy 상태를 확인한다. S3에서 받은 파일은 metadata의 SHA-256과 다시 대조한다.

운영 전환 전에 즉시 백업 한 번을 실행하고 업로드된 객체를 **S3에서 다시 받아** 격리된 DB에 복원한다.
덤프 파일이 있거나 업로드 명령이 성공한 것만으로 복원 검증을 통과한 것으로 기록하지 않는다.
복원한 DB의 스키마·Flyway 이력·행 수·내용과 애플리케이션 기동을 확인한다. 검증 스택은 운영 트래픽과
분리하고 분석 워커를 끈다. 운영 복사본으로 워커를 돌리면 실제 외부 호출과 영상 삭제가 일어날 수 있다.

백업 성공 시각·S3 객체 키·SHA-256·복원 결과를 남긴다. 복원이 끝난 전송용 로컬 덤프는 지우되
유일한 복구본이나 정해진 보존 기간의 S3 백업을 지우지 않는다. 일일 백업만으로는 장애 직전까지의
복구를 보장하지 못한다. 마지막 성공 백업 이후 데이터는 손실될 수 있으며, 백업이 실패한 기간만큼
복구 가능한 시점이 더 오래된다.

## 6. 검증 범위

변경한 배포 스크립트·Compose·백업을 가장 좁은 검사부터 확인하고,
[CI 워크플로](../../.github/workflows/ci.yml)의 해당 잡 범위를 실행한다. Docker 기동·복원 검사와
실제 서버 검증은 구분해서 기록한다. 서버에서는 이미지 SHA, 터널 경유 `/health`, DB를 읽는 경로,
백업 업로드·복원, 로그인·업로드·분석을 확인한다. `/health` 200만으로 이 전부가 검증되지는 않는다.

## 7. 데이터 이전 — 원본 DB를 홈서버 compose 스택으로

아래는 dev EC2에서 옮긴 절차와 실측이다. 운영 RDS는 쓰기 차단·작업 배출·호환성 판정을 포함하는
[운영 런북](./DEPLOY-HOME-CUTOVER.md)을 따른다. 2026-09-06 사용자가 기존 2주 관찰을 앞당기도록 승인했으며,
백업·복원 검증과 운영 전환 검증은 그대로 수행한다. 옮기는 데이터 저장소는 Postgres다. 영상은
S3 버킷을 유지하고, 시크릿 이전 여부는 별도로 확인한다. Flyway 이력표
`flyway_schema_history`가 덤프에 함께 들어가므로 새 서버에서 baseline을 다시 기록하지 않는다.

```
원본(dev EC2 Postgres 16 / RDS)             홈서버 /svc/acttub/<env>
  pg_dump -Fc ──▶ 맥 ──scp(Tailscale)──▶ <덤프>  ──▶ ./restore-db.sh <덤프> --expect source-counts.tsv
  restore-db.sh --counts-sql | psql ──▶ source-counts.tsv ─┘         └▶ db 컨테이너 안 pg_restore → api 재기동 → Flyway "up to date"
```

도구는 저장소의 [`deploy/home/restore-db.sh`](../../deploy/home/restore-db.sh) 하나다. `deploy.sh`처럼 서버의
프로젝트 디렉토리(`/svc/acttub/<env>`)에서 실행하며, `release.env`가 있어야 Compose가 파일을 읽는다.
복원할 서버의 스크립트가 이번에 검증한 저장소 버전인지 확인한다. 복원 중에는 유입과 워커를 차단하고
백업 서비스도 중지한다. 스크립트가 API를 재기동하기 전에 이 조건을 갖춰야 한다.

### 7-1. 원본에서 덤프 뜨기

**dev EC2** — DB가 인스턴스 안 loopback에만 열려 있어 SSM 포트 포워딩으로 붙는다(DEPLOY-DEV §2-2). 접속 문자열은
`/etc/acttub/api.env`의 `DATABASE_URL`이다. 값을 화면에 찍지 말고 파일(600)로 받는다.

```bash
aws sso login --profile acttub                      # 사람. 만료돼 있으면 여기서 브라우저가 뜬다
# 1) DATABASE_URL 을 600 파일로 (SSM Run Command, 화면 출력 없음)
CMD_ID=$(aws ssm send-command --profile acttub --region ap-northeast-2 --instance-ids i-0f713285b7de18940 \
  --document-name AWS-RunShellScript --parameters '{"commands":["sudo grep -E ^DATABASE_URL= /etc/acttub/api.env"]}' \
  --query Command.CommandId --output text)
sleep 5; (umask 077; aws ssm get-command-invocation --profile acttub --region ap-northeast-2 \
  --command-id "$CMD_ID" --instance-id i-0f713285b7de18940 --query StandardOutputContent --output text > dev-db-url.env)
# 2) 포트 포워딩 (다른 터미널에서 열어 둔다) → localhost:15432
aws ssm start-session --profile acttub --region ap-northeast-2 --target i-0f713285b7de18940 \
  --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["5432"],"localPortNumber":["15432"]}'
# 3) 덤프 + 원본 행 수 (맥의 pg_dump 18 은 서버 16 을 덤프할 수 있다. 반대 방향은 안 된다)
set -a; . ./dev-db-url.env; set +a; URL="${DATABASE_URL/localhost:5432/localhost:15432}"
pg_dump -Fc --no-password -d "$URL" -f "acttub-dev-$(date +%Y%m%d-%H%M%S).dump"
deploy/home/restore-db.sh --counts-sql | psql "$URL" -At -F $'\t' > source-counts.tsv
```

**운영 RDS** — 이 dev 명령을 그대로 복사하지 않는다. 원본 호스트·DB 버전·역할·로케일과
접속 경로를 확인한 뒤 운영 런북의 순서로 최종 덤프를 만든다.

`api.env`의 `DATABASE_URL` 호스트는 `localhost`다(2026-09-03 확인). `127.0.0.1`로 돼 있으면 위 치환 문자열을
그에 맞춘다.

`source-counts.tsv`는 "테이블<TAB>행 수"(`count(*)`, 통계 추정치가 아니다)이고, 복원 스크립트가 같은 SQL로 복원
결과를 뽑아 `diff`한다. 그래서 "행 수 대조 일치"가 사람 눈이 아니라 exit code다.

### 7-2. 서버로 전송

```bash
scp acttub-dev-*.dump source-counts.tsv deploy/home/restore-db.sh deploy@insung-server:/svc/acttub/dev/
```

Tailscale SSH의 사람 접속에는 확인이 요구될 수 있다. 덤프에는 사용자 데이터(refresh token 등)가 있으니
권한을 제한하고, 보존할 검증된 S3 백업을 확보한 뒤 전송용 서버·맥 사본을 지운다.

### 7-3. 복원 — `restore-db.sh`

```bash
ssh deploy@insung-server
cd /svc/acttub/dev
./restore-db.sh acttub-dev-<날짜>.dump --expect source-counts.tsv
```

스크립트가 하는 일(머리 주석이 정본):

1. `api`를 멈춘다(DB 연결·쓰기 차단). `web`·`cloudflared`는 그대로라 그동안 `/v2`는 502다.
2. 새 DB `acttub_restore`를 만들어(template0, **컨테이너 클러스터의 기본 로케일**) 거기에
   `pg_restore --no-owner --no-privileges --exit-on-error --single-transaction`(stdin)한다.
3. `flyway_schema_history`가 있는지, `--expect` 파일과 행 수가 같은지 본다. 운영에서는
   `--expect-manifest`로 행 내용·시퀀스·스키마까지 DB 이름 교체 전에 대조한다. 다르면 여기서 실패한다.
4. 바꿔치기(`acttub`→`acttub_old`, `acttub_restore`→`acttub`) → `api`를 올려 healthy 대기 → Flyway 로그가
   **"up to date"** 여야 한다. 마이그레이션을 새로 적용했으면(덤프가 앱보다 낡음) 실패로 되돌린다 — 옛 백업에서
   복구할 때만 `--allow-migrate`로 허용한다.
5. 기본값은 성공하면 `acttub_old`를 지운다. 운영 전환에는 `--keep-old`로 보존하며, 남은 DB는 다음 복원을
   차단하므로 어느 데이터인지 판정한 뒤 직접 정리한다. 어느 단계든 실패하면 원래 DB를 제자리에 두고 `api`를 다시 올린 뒤 exit≠0
   (마지막 `acttub_old` 삭제만 실패하면 복원은 끝난 상태라 손으로 지우라고 알린다).

왜 이렇게 하나 — 실제로 해 보고 정한 것:

- **기존 빈 스키마 위에 `--clean`으로 덮지 않는다.** 첫 배포가 띄운 스택의 볼륨에는 Flyway가 V1→V4로 만든 빈 스키마가
  있었다. `--clean --if-exists`로 덮으면 대상에만 있는 객체가 남을 수 있고 실패하면 반쯤 지워진 DB가 남는다.
  볼륨을 비우고 다시 띄우는 길은 스택 전체를 내려야 한다. 새 DB에 복원한 뒤 이름을 바꾸는 방식은 둘 다 피하고,
  빈 볼륨(백업 복원 연습)이든 데이터가 있는 볼륨이든 같은 명령이다.
- **`--create`로 원본 DB 정의를 그대로 만들지 않는다.** dev EC2의 DB는 `C.UTF-8`(libc)이고 컨테이너
  `postgres:18-alpine`은 `en_US.utf8`이다. 컨테이너 클러스터의 기본값으로 만들면 Flyway가 빈 볼륨에 만드는
  DB와 조건이 같다.
- **`--no-owner --no-privileges`.** 소유자는 접속 역할(`POSTGRES_USER`, 기본 `acttub`)로 통일한다. dev 덤프는
  전부 `acttub` 소유였다. 운영에서는 RDS 역할·ACL·확장·RLS·함수의 역할 의존성을 따로 확인해야 한다.
  이 옵션만으로 모든 RDS 덤프가 호환된다고 판정하지 않는다.
- **Flyway는 "이미 적용됨"으로 지나간다(baseline 불필요).** dev EC2의 이력은 `1 = << Flyway Baseline >> (BASELINE)`,
  `2·3·4 = SQL`이다. 복원 뒤 api 기동 로그: `Successfully validated 5 migrations` → `Current version of schema
  "public": 4` → `Schema "public" is up to date. No migration necessary.` 새 서버의 빈 볼륨이 `1 = baseline (SQL)`로
  시작했던 것과 이력 종류가 다르지만 Flyway는 개의치 않는다.
- **덤프에 `alembic_version`(1행)이 딸려 온다.** FastAPI 시절 잔재다. 앱은 보지 않으므로 그대로 두었다(지우는 것은
  별도 마이그레이션 감이다).

### 7-4. 복원 뒤 확인

- `./restore-db.sh`의 마지막 줄 `✔ 복원 완료 — acttub ← <덤프> (테이블 N개, Flyway up to date)`.
- 같은 sha로 `deploy.sh`를 다시 돌리면 컨테이너 재생성 없이 초록(멱등) — 이때는 api가 다시 뜨지 않아 Flyway도 돌지
  않는다. "재배포에서 Flyway가 이미 적용됨으로 지나가는지"는 api를 재생성해서 본다(새 sha 배포와 같은 일):
  `docker compose --env-file .env --env-file release.env up -d --force-recreate --wait api` 뒤
  `compose logs api | grep -E 'Current version|up to date'`.
- 공개 주소에서 DB를 읽는 인증 없는 경로 하나가 200인지 본다: `GET /v2/consents/documents`. 이 경로는 종류별
  현행 문서만 주므로(양쪽 다 3건) "터널→web→api→복원된 DB"가 이어졌다는 확인이지 행 수의 증거는 아니다 — 행 수는
  7-3의 `--expect`가 판정한다.

### 7-5. `dev.acttub.com` 전환 (사람 — Cloudflare 대시보드)

전환 = Cloudflare에서 `dev.acttub.com`을 EC2 대신 터널 `acttub-dev`로 잇는 것. 그 순간이 dev 컷오버다.

1. 원본의 신규 유입·기존 작업을 멈춘 뒤 최종 덤프를 만든다. 행 수가 같아도 UPDATE나
   삭제·삽입의 상쇄는 발견할 수 없으므로 행 수 대조만으로 데이터가 같다고 판정하지 않는다.
2. dash.cloudflare.com → **DNS → 레코드**: 지금 `dev` 레코드의 종류·값을 적어 둔다(되돌리기용) → 삭제.
   기존 레코드가 있으면 다음 단계가 "이미 있다"로 막힌다.
3. **네트워킹 → 터널 → `acttub-dev` → 경로 탭 → 경로 추가 → 게시된 애플리케이션**: 하위 도메인 `dev`, 도메인
   `acttub.com`, 서비스 `HTTP` `web:3000`(compose 서비스 이름 — localhost 아님) → 저장. CNAME이 자동 생성된다.
   Zero Trust(one.dash)의 "호스트 이름 경로"는 사설망용이라 공개되지 않는다(임시 호스트명을 만들 때 한 번 밟은 함정).
4. 확인: `curl -sS https://dev.acttub.com/health` 의 `commit`이 홈서버 sha, cloudflared 로그에
   `Updated to new configuration … dev.acttub.com → http://web:3000`.
5. GitHub `dev` 환경 변수 `HOME_PUBLIC_URL`을 바꾼다 — 배포 워크플로가 공개 URL로 `/health.commit`을 대조한다:
   `gh variable set HOME_PUBLIC_URL --env dev --body https://dev.acttub.com`. 옛 변수(`BE_INSTANCE_ID` 등)는
   운영 컷오버 PR에서 정리한다.
6. dev EC2의 앱이 꺼져 있는지 확인한다(SSM `sudo systemctl stop acttub-api-java acttub-web`) — DNS 캐시로 아직 EC2로 가는 클라이언트가
   옛 DB에 쓰지 못하게. 앱 development 빌드로 로그인·영상 업로드·분석·코치 1턴을 해 본다(사람).
7. 통과하면 인스턴스를 **중지**한다(종료 아님 — 되돌릴 길): `aws ec2 stop-instances --instance-ids i-0f713285b7de18940`.
   S3 CORS는 허용 오리진이 `https://dev.acttub.com`으로 같으므로 손대지 않는다. 확인:
   `aws s3api get-bucket-cors --profile acttub --bucket acttub-practice-videos-dev` 의 `AllowedOrigins`에
   `https://dev.acttub.com`이 있으면 된다(2026-09-03: `dev.acttub.com`·`localhost:3000`·`real.acttub.com`).
   임시 호스트명 `dev-home`은 그 목록에 없어 웹에서 업로드가 CORS로 막힌다 — 임시 호스트명으로 업로드까지
   검증하려면 오리진을 잠시 추가한다.

**되돌리기**: 신규 유입과 워커를 멈춘다. 홈서버 쓰기가 발생했다면 최종 DB를 EC2로 복원하고 검증한다.
그 뒤 터널 경로에서 `dev.acttub.com` 삭제 → DNS에 2에서 적어 둔 레코드 복원 → EC2 앱 `systemctl start`
(중지했다면 `start-instances` 먼저). 덤프만 보관하고 예전 DB로 다시 쓰기를 받으면 데이터가 갈라진다.

### 7-6. 실측 (dev, 2026-09-03)

| 항목 | 값 |
|---|---|
| 원본 | dev EC2 `i-0f713285b7de18940`, PostgreSQL 16.15, DB 11MB, `C.UTF-8` |
| 덤프 | `pg_dump` 18.4(맥), `-Fc` 203KB, TOC 181항목, 테이블 28(`alembic_version` 포함), 4초 |
| 대상 | 홈서버 `acttub-dev` 볼륨 `acttub-dev_pgdata`, PostgreSQL 18.6(`postgres:18-alpine`), `en_US.utf8` |
| 복원 | `restore-db.sh … --expect source-counts.tsv` 36초(api 재기동 포함), 행 수 28테이블 전부 일치 |
| Flyway | `validated 5` → `Current version 4` → `up to date` |
| 재배포 | 같은 sha `deploy.sh` 초록, 컨테이너 ID 불변. api 재생성(`--force-recreate`)에서 Flyway `validated 5 → Current version 4 → up to date`, 새로 적용 0 |
| 행 수(주요) | users 6 · practice_sessions 35 · coach_turns 316 · external_operations 204 · refresh_tokens 81 |
