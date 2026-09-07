# dev 홈서버 이전 기록

> **보관 문서 (2026-09-07)**: AWS 배포와 홈서버 이전 당시의 절차·판단을 보존한다.
> 현재 배포·복구는 [홈서버 배포](../../deploy/DEPLOY-HOME.md)를 따른다. 아래의 EC2·RDS·ALB·
> CloudFront·SSM 명령과 AWS 복귀 절차는 현재 운영에 사용하지 않는다. 자원 삭제 완료 여부는
> 이 과거 절차로 판정하지 않고 정리 작업의 실행 기록과 AWS 실조회로 확인한다.


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

도구는 저장소의 [`deploy/home/restore-db.sh`](../../../deploy/home/restore-db.sh) 하나다. `deploy.sh`처럼 서버의
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
그에 맞춘다. 포트 포워딩 세션은 쓰지 않고 20분쯤 두면 끊긴다(`Exiting session`) — 덤프·재대조 직전에 다시 연다.

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
