# 홈서버 배포

dev와 운영의 웹·API·PostgreSQL은 홈서버의 별도 Docker Compose 프로젝트로 배포한다.
현재 배포 경로는 GHCR → Tailscale SSH → 홈서버다. AWS에는 영상·DB 백업 S3와 이를 사용하는
환경별 IAM 권한을 유지한다. 기존 AWS 인프라를 재시작하는 복구 경로는 폐기하며, 코드 복구는
§4, DB와 호스트 복구는 §7을 따른다. 이전 절차와 AWS 구성은 [보관 기록](../archive/soma489/README.md)에 있다.

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
| 워커·인증 | 운영 워커는 활성화하며, 격리 복원 검증 중에는 `ANALYSIS_WORKER_ENABLED=false`. 운영에서 `DEVELOPMENT_AUTH_PROVIDER` 비활성 |

JWT 서명 키를 유지해야 기존 로그인 세션을 이어받는다. `.env`의 존재나 Compose 기동만으로
시크릿 이전 완료라고 판정하지 않는다. 값을 로그에 출력하지 않고 필수 키 충족 및 실제 기능으로 확인한다.
배포는 `.env`를 덮지 않으며, SHA와 이미지 주소를 담은 `release.env`만 갱신한다.

## 3. Actions와 일상 배포

브랜치와 PR은 [브랜치 전략](../BRANCHING-STRATEGY.md)을 따른다. `main`·`dev`에 직접 push하지 않는다.
운영 수동 배포는 반드시 `main` ref에서 실행한다. DB 복구 중에는 배포와 새 `main` 머지를
멈춰 복원할 데이터와 앱 버전의 기준을 고정한다.

GitHub 환경마다 `TS_OAUTH_CLIENT_ID`·`TS_OAUTH_SECRET` 접속 설정, 공개 웹 빌드 설정,
`HOME_PUBLIC_URL`을 확인한다. GHCR 패키지는 서버가 읽을 수 있어야 한다.
웹 공개 설정을 바꾸고 같은 SHA를 배포하면 `rebuild_images=true`로 이미지를 다시 만든다.
변수만 변경해도 기존 웹 이미지 내부 설정은 바뀌지 않는다.

```bash
gh workflow run deploy.yml --ref main -f environment=prod
```

Actions가 이미지 세 개를 빌드·게시한 뒤 서버의 배포·복원 파일을 전송하고 `deploy.sh`를 실행한다.
처음 만든 GHCR 백업 패키지도 서버가 읽을 수 있는지 확인한다. 복원 도구는 `restore-db.sh`와
`db-manifest.sql`·`schema-fingerprint.sql`을 함께 전송한다.
이 스크립트는 앱 이미지 pull → Compose 기동·healthy 대기 → 웹 경유 `/health.commit` 대조를 한다.
공개 URL 대조까지 성공해야 터널을 통한 배포를 확인한 것이다. `.env`나 전체 Compose 설정을
로그에 찍지 말고, 필요한 상태·이미지 ID·릴리스 SHA만 기록한다.

배포는 환경의 전체 스택을 갱신한다. 수동 배포 입력은 `environment`와 `rebuild_images`이며,
DB 복원이나 DNS 변경은 배포에 포함되지 않는다.

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

코드 복구는 데이터 복구와 다르다. DB를 백업 시점으로 되돌려야 하거나 호스트가 손실됐다면
§7에 따라 복원할 백업·앱 버전과 데이터 손실 범위를 먼저 정한다.

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

백업 설정을 바꿨거나 복원 가능성을 검증할 때 즉시 백업을 실행하고 업로드된 객체를
**S3에서 다시 받아** 격리된 DB에 복원한다.
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

## 7. DB와 호스트 복구

복원 도구는 [`restore-db.sh`](../../deploy/home/restore-db.sh)이며, 서버의 환경 디렉터리에서
`compose.yml`·`.env`·`release.env`와 함께 실행한다. `db-manifest.sql`·`schema-fingerprint.sql`도
같은 디렉터리에 필요하다. 세부 옵션과 실패 처리는 스크립트의 `--help`가 정한다.

1. 장애 시각, 마지막 정상 배포 SHA, 마지막 성공 백업 객체와 SHA-256을 기록한다. 현재 DB를
   읽을 수 있다면 변경 전에 별도 덤프를 보존한다. 서로 다른 시점의 DB는 행 수만으로 같다고 판정하지 않는다.
2. 공개 유입을 차단하고 진행 중인 요청·작업이 끝났는지 확인한다. `.env`의 분석 워커를
   `ANALYSIS_WORKER_ENABLED=false`로 두고 `api`를 재생성해 적용한다. 복원 중에는 `backup`도
   중지한다. `restore-db.sh`는 API를 다시 올리므로 유입 차단과 워커 비활성 조건을 먼저 갖춘다.
3. S3에서 선택한 백업을 받아 metadata의 SHA-256과 대조하고 격리된 스택에서 먼저 복원한다.
   호스트를 새로 준비해야 하면 §2의 서버·시크릿을 복구하고 같은 앱 버전의 이미지로 스택을 준비한다.
   검증용 스택에는 운영 터널을 연결하지 않고 분석 워커를 끈다. S3 DB 백업에는 `.env`와
   호스트 설정이 들어 있지 않으므로 이를 별도 보호 사본에서 복구해야 한다.
4. 검증한 덤프로 환경 DB를 복원한다. 같은 정지 시점의 manifest(행 내용·시퀀스·스키마 지문)가
   있다면 `--expect-manifest`를 함께 전달한다. 운영 복원은 기존 DB를 남기도록 `--keep-old`를 쓴다.

   ```bash
   cd /svc/acttub/prod
   ./restore-db.sh <검증한-백업.dump> --keep-old
   ```

   스크립트는 새 DB에 복원하고 DB 이름을 교체한 뒤 API·Flyway를 확인한다. 백업보다 앱 스키마가
   새로울 때는 기본적으로 거부한다. 필요한 마이그레이션의 호환성을 격리 복원으로 검증한 경우에만
   `--allow-migrate`를 추가한다. 실패하면 원래 DB로 복구를 시도하며, 원본 복구 실패 시 API를 정지해 둔다.
5. 스키마·Flyway 이력·데이터와 DB를 읽는 API를 확인한다. 백업을 다시 켜서 실제 S3 업로드가
   성공했는지 확인하고, 분석 워커를 활성화해 적용한 뒤 공개 유입을 연다. 새 호스트라면
   Cloudflare Tunnel 연결과 Tailscale 배포 경로도 검증한다. 로그인·영상 업로드·분석·코치 응답을
   끝까지 확인하고 백업 시각 이후 손실 또는 별도 복구한 데이터를 기록한다.

`--keep-old`가 남긴 `<DB명>_old`는 다음 복원을 차단한다. 복구 검증과 필요한 보존을 끝낸 뒤
어느 시점의 데이터인지 확인하고 별도로 정리한다. 일일 S3 백업과 별개로 남긴 AWS 최종 스냅샷은
과거 보존본이다. 홈서버 전환 이후 쓰기를 포함하지 않으며 최신 서비스 복구본으로 대신할 수 없다.
