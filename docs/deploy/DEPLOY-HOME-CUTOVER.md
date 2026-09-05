# 운영 홈서버 전환·복구

운영 앱과 PostgreSQL을 AWS에서 `/svc/acttub/prod`의 `acttub-prod`로 옮긴다. 영상 S3와 운영 도메인은
유지한다. 사용자는 2026-09-06에 기존 dev 2주 관찰을 앞당겨 진행하도록 승인했다. 백업·실제 복원과
데이터 대조는 생략하지 않는다. AWS 자원 삭제는 이번 작업 범위가 아니다.

이 문서는 실행 절차다. **운영 전환 완료 기록이 아니다.** 점검 시각, 최종 SHA, 검증 결과,
실제 전환·복구 시각은 `.scratch/SOMA-489.md`에 기록하고, 완료한 내용만 결과에 반영한다.
2026-09-06 최초 준비 확인에서는 AWS 인증이 만료됐고 운영 시크릿 일부가 비어 있었다. 이후 AWS 재인증으로
운영 RDS PostgreSQL 18.4와 `acttub-api-java` 실행·원본 commit `91ff058`을 확인했다. 시크릿 전달과
대상 기동·실제 기능 검증은 별도 완료 조건이다. 이 값은 시점 기록이며 실행 직전에 다시 확인한다.

## 1. 이전에 고정할 것

| 항목 | 판정과 남길 증거 |
|---|---|
| 출시 범위 | 현재 `main` 기준 앱에 인프라 변경만 포함. `dev`의 미출시 기능을 함께 올리지 않음 |
| 코드 | 원본 운영 `/health.commit`, GitHub `main` SHA, 준비한 API·prod 웹 이미지 SHA와 digest |
| 원본 위치 | AWS 계정·리전, 운영 FE/BE 인스턴스와 systemd 유닛, RDS endpoint/DB명/버전 |
| 대상 | 프로젝트 `acttub-prod`, 전용 DB 볼륨, PostgreSQL 버전·이미지 ID, 디스크 여유·자원 상한 |
| 인증·외부 서비스 | 기존 JWT·OAuth·모델·Sentry 설정, 영상 버킷과 환경별 IAM 권한 |
| 백업 | 매일 S3 백업, 30일 보존 규칙, S3 다운로드본의 실제 복원 성공 |
| 유입·DNS | Cloudflare DNS 레코드 전체 값과 프록시 상태, 기존 CloudFront 경로, `www` 리다이렉트 |
| 복구 | 원본 AWS 앱과 DB 유지, 전환 후 홈→RDS 역복원 호환성·소요시간 확인 |

운영 전환용 PR은 `main`에서 시작하고 [브랜치 전략](../BRANCHING-STRATEGY.md)에 따라 CI를 거친다.
승인한 인프라 변경을 `main`에 Merge commit으로 합친 뒤 `dev`로 역병합한다. Actions의 운영 ref는
`main`만 허용한다. 준비·점검 중에는 겹치는 운영 배포와 새 `main` 머지를 막아 원본 앱과 최종 덤프의
스키마 기준을 고정한다. CI 성공, Actions 배포 성공, 운영 도메인 전환 성공을 각각 기록한다.

### AWS 접속과 DB 호환성

`aws sso login --profile acttub` 후 `aws sts get-caller-identity --profile acttub`로 계정을 확인한다.
RDS 접속은 실제 운영 BE를 통한 SSM 원격 호스트 포트 포워딩을 사용한다. endpoint·인스턴스 ID는
실조회 값으로 채우고, DB 비밀번호는 권한 `600` 파일로 다룬다. 명령 인자·화면·Actions 로그에
접속 문자열이나 시크릿을 출력하지 않는다.

원본과 대상에서 버전·encoding·locale provider·collation을 비교한다. RDS의 역할·소유권·ACL,
확장, 함수, 트리거, RLS 정책도 확인한다. `restore-db.sh`는 `template0`의 기본 로케일로 새 DB를 만들며
`--no-owner --no-privileges`를 사용한다. 필요한 권한이나 역할 의존성이 사라지는지 실복원으로 판정한다.
locale 차이는 정렬과 인덱스 의미에 영향을 줄 수 있어, dev 때 허용한 차이를 운영에 자동 적용하지 않는다.

```sql
SHOW server_version;
SELECT datname, pg_encoding_to_char(encoding), datcollate, datctype,
       datlocprovider, datcollversion
FROM pg_database WHERE datname = current_database();
SELECT e.extname, e.extversion, n.nspname
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY 1;
```

홈서버 PostgreSQL 18에서 만든 덤프를 더 오래된 RDS 메이저 버전에 그대로 복원할 수 있다고 가정하지 않는다.
전환 후 쓰기를 보존하는 역복원 방법을 격리된 대상에서 시험하고, 호환되지 않으면 실제로 복원 가능한
AWS 복구 대상을 마련하기 전까지 운영 쓰기를 열지 않는다. 원본을 덮어쓰며 연습하지 않는다.
검증한 AWS 복구 대상·접속 역할·복원 명령·DB 연결 전환 방법·소요시간을 `.scratch/SOMA-489.md`에
고정한다. 같은 PostgreSQL 버전이라는 이유만으로 RDS 권한까지 호환된 것으로 판정하지 않는다.

2026-09-06 리허설에서는 RDS 18.4의 17MB·public 28테이블을 `pg_dump` 18.4로 덤프한 뒤, 외부 네트워크가
없는 로컬 PostgreSQL 18.6 컨테이너에 복원했다. 행 내용·시퀀스·스키마를 포함한 manifest 636줄은 모두
일치했다. 확장은 `plpgsql`만 있었고 public 함수·트리거·RLS는 없었다. 원본 locale은
`en_US.UTF-8`(glibc 2.26), 대상은 `en_US.utf8`이다. 논리 복원으로 인덱스를 대상에서 새로 만들었으며
원본 물리 인덱스를 이동하지 않았다. 이 결과는 데이터 복원 리허설의 증거이고, locale의 모든 정렬 의미,
실제 홈서버 운영 전환을 의미하지 않는다. 이어 실제 S3 업로드본을 내려받아 checksum과 636줄을
대조했고, 대상 18.6에서 다시 만든 덤프를 RDS의 격리 DB `acttub_home_rollback_check`에
`acttub_admin` 역할로 복원해 같은 manifest가 일치하는 역복원도 검증했다. 원본 `acttub`은 유지했다.

## 2. AWS 운영을 유지한 채 홈서버 준비

1. `/svc/acttub/prod/.env`를 완성한다. `ANALYSIS_WORKER_ENABLED=false`로 분석·기억 작업과 정리 작업을
   끄고 운영에서 개발용 인증을 비활성화한다. 기존 운영 JWT 서명 키와 OAuth client ID를 유지한다.
2. 터널 `acttub-prod`에 준비용 `prod-home.acttub.com`을 연결한다. **`/health` 경로만** `http://web:3000`으로
   보내고 나머지는 404로 막는다. 공개 경로 설정과 실제 응답을 함께 확인한다. 빈 운영 스택의 로그인이나
   쓰기 경로가 인터넷에 열리지 않아야 한다. 기존 `acttub.com`은 이때 AWS를 계속 가리킨다.
3. GitHub `prod` 환경 `HOME_PUBLIC_URL=https://prod-home.acttub.com`을 설정한다. 운영 웹의 빌드 URL은
   최종 주소인 `https://acttub.com`을 사용한다. 준비용 도메인을 OAuth·영상 업로드 허용 목록에 추가할
   필요 없이 먼저 health만 검증한다.
4. 인프라 PR을 검증·머지하고 `main` SHA의 운영 이미지를 배포한다. Compose 상태, 이미지 ID와
   준비용 `/health.commit`을 대조한다. API가 뜨더라도 워커가 꺼져 있음을 실제 설정으로 확인한다.
5. 자동 백업 즉시 실행 → S3에서 다운로드 → 격리 스택의 복원·기동 검증을 완료한다. 운영 최종 덤프를
   다루기 전 복원 도구의 실패 경로도 검증한다. 소요시간을 보고 점검 시간을 잡는다.

준비 중 홈서버 DB는 운영 원본이 아니다. AWS RDS만 원본으로 유지한다. 워커가 켜진 상태로
운영 데이터 복사본을 실행하면 실제 외부 API 호출과 S3 삭제가 생길 수 있다.

## 3. 점검 시작: 새 쓰기 차단 → 기존 작업 완료 → 원본 정지

1. 점검 중임을 서비스 화면에 표시하고 신규 요청을 닫는다. 먼저 기존 AWS 경로에서 유입을 차단해
   DNS 캐시나 CloudFront 경로를 통해 새 쓰기가 들어오지 않도록 한다. 새 presigned 업로드 발급과
   업로드 완료 호출도 닫는다. 이미 발급한 S3 업로드 URL은 별도이므로 진행 중 업로드를 확인한다.
   2026-09-06 경로는 `acttub-fe-alb` HTTPS 443의 단일 default forward다. listener 전체와
   `DefaultActions`를 보관한 뒤 `fixed-response` 503 HTML 점검 화면으로 바꾼다. `/v2` 요청까지
   503인지 확인한다. 원복은 보관한 `DefaultActions`를 `modify-listener --default-actions file://…`로
   복원한다. BE ALB는 internal이며 RDS에 연결한 앱은 BE 인스턴스 하나임을 확인했다.
2. 기존 요청과 워커 작업이 정상적으로 끝날 시간을 둔다. `external_operations`의 모든 kind에 대해
   `pending`·`running` 상태와 lease(작업 점유 기한)를 조회한다. 진행 중 업로드와 연습 상태도 함께 확인한다.
   `pending`을 넘겨야 한다면 재개 조건을 확인하고 개수·kind·상태만 기록한다. 남은 `running` 작업을
   근거 없이 완료나 재시도 상태로 직접 변경하지 않는다.
3. 진행 중 작업이 끝나지 않으면 외부 호출 결과와 기록 상태를 판정한 뒤 점검을 연장하거나 원래 서비스를
   재개한다. SIGTERM이나 컨테이너 stop이 외부 작업 완료를 보장하지 않는다. 소스 코드는 종료 대기를
   요청하지만 대기 시간·HTTP의 정상 종료가 모두 설정된 것은 아니다.
4. 운영 BE의 **모든** API 프로세스를 멈춘다. 현재 유닛명은 `acttub-api-java`이며 실제 배포 호스트에서
   다시 확인한다. AWS FE도 점검 화면 외에는 요청을 보내지 않도록 유지한다. API 서비스가 inactive이고
   재기동되지 않는지 확인한 다음 RDS의 앱 연결이 사라졌는지 본다.
5. 홈서버 백업 서비스를 멈춰 복원 중 DB 이름 변경과 재접속이 경합하지 않게 한다. 홈서버 유입 차단과
   `ANALYSIS_WORKER_ENABLED=false`도 계속 유지한다.

사용자 행·UUID·SQL 본문을 출력하지 않고 아래 집계를 기록한다.

```sql
SELECT kind, status, attempt_count, count(*), max(lease_expires_at)
FROM external_operations GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
SELECT usename, application_name, client_addr, state, count(*)
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
GROUP BY 1, 2, 3, 4;
```

## 4. 최종 덤프·복원·대조

1. 원본 쓰기가 멈춘 상태에서 최종 `pg_dump -Fc`와 `restore-db.sh --manifest-sql`의 SQL 결과를
   만든다. manifest는 모든 public 테이블의 행 수·UTC 기준 내용 지문, 시퀀스 상태, 스키마 지문을 포함한다.
   Flyway 이력도 내용 대조에 포함한다. 덤프의 SHA-256을 남기고 Tailscale로 전송한 뒤 다시 비교한다.
   최종 원본 덤프는 S3에도 보관하고 객체 키·생성 시각·checksum을 기록한다.

   ```bash
   # pg_service.conf / .pgpass 등 권한을 제한한 접속 설정을 사용한다.
   deploy/home/restore-db.sh --manifest-sql \
     | psql 'service=acttub-prod-source' -X -q -v ON_ERROR_STOP=1 -At -F $'\t' > source-manifest.tsv
   ```

2. [`restore-db.sh`](../../deploy/home/restore-db.sh)로 홈서버 운영 DB에 복원한다. 이 스크립트는
   새 DB에 복원 → manifest 비교 → DB 이름 교체 → API 기동·Flyway 확인을 한다.
   운영에서는 `--keep-old`로 기존 대상 DB를 남긴다. 기본값은 성공 뒤 기존 DB를 삭제하므로 이 옵션을
   생략하지 않는다. 복원 전에 기존 대상 DB도 백업한다. `db-manifest.sql`·`schema-fingerprint.sql`을
   스크립트와 함께 전송하고 검증한 저장소 버전인지 확인한다.
   이번 전환에서 `--allow-migrate`를 쓰지 않는다. 새 마이그레이션이 실행되면 SHA·덤프 기준이 맞는지 판정한다.

   ```bash
   cd /svc/acttub/prod
   ./restore-db.sh acttub-prod-<시각>.dump --expect-manifest source-manifest.tsv --keep-old
   ```

3. API가 복원본으로 기동한 뒤에도 유입과 워커는 닫힌 상태여야 한다. source/target의 행 수와 내용 지문,
   스키마 정의, Flyway script/checksum/success, 시퀀스 `last_value`·`is_called`를 대조한다.
   테이블 이름과 행 수가 같다는 결과는 UPDATE 내용까지 같다는 증거가 아니다.
4. manifest의 스키마 부분은 [`schema-fingerprint.sql`](../../apps/api/src/test/resources/schema-fingerprint.sql)을
   사용한다. 이 SQL이 제외하는 확장·함수·트리거·RLS·locale·권한은 별도로 비교한다. Flyway 이력과
   시퀀스 값은 manifest의 내용·시퀀스 부분으로 대조한다. 버전 차이로 생기는 표현 차이는 데이터 차이와 구분한다.
5. manifest는 데이터가 정지된 상태에서 비교해야 하며 실행 시점 사이 쓰기·시퀀스 변경이 있으면 다시 만든다.
   사용자 원문은 결과 보고서에 넣지 않는다. DB 크기를 먼저 확인하고 비교 도구의 메모리 범위를 넘지 않게 한다.
   버전 간 직렬화 차이가 있으면 동일 표현을 사용하는 비교 방법으로 재확인한다.
6. 전체 대조와 API 기동·Flyway `up to date`, 내부 웹 경유 health, DB를 읽는
   `/v2/consents/documents`가 통과해야 다음으로 간다. 백업을 재개하고 `backup.py once`로 복원 완료본을
   S3에 한 번 더 백업한다. **실제 운영 데이터가 담긴 이 객체를 S3에서 다시 내려 받아** 격리된 DB에
   복원하고 최종 manifest와 대조한다. 초기 빈 대상 DB의 백업·복원 성공으로 이 검증을 대신하지 않는다.
   이 결과까지 통과한 뒤에만 운영 워커와 사용자 쓰기를 연다.

불일치가 있으면 DNS를 바꾸지 않는다. 원본 AWS 데이터는 그대로 남아 있으므로 §6의 쓰기 전 복구를 따른다.

## 5. 도메인 전환과 실제 기능 검증

1. 기존 AWS 앱의 정지·유입 차단을 유지한다. Cloudflare에서 `acttub.com`의 기존 레코드와 터널 경로를
   저장한 값과 대조한 뒤 운영 터널의 `http://web:3000`으로 전환한다. 기존 `www`의 apex 301 규칙을 유지하고
   양쪽 주소를 확인한다. 새 경로는 처음에는 점검 상태를 유지한다.
2. DNS 조회와 공개 `https://acttub.com/health`의 SHA를 확인하고 터널 로그의 라우팅도 확인한다.
   같은 SHA의 AWS 응답과 혼동하지 않도록 DNS·터널 연결·원본 정지를 함께 증거로 남긴다.
3. 대조가 완료된 뒤 `ANALYSIS_WORKER_ENABLED=true`로 API를 재생성하고 실제 적용 여부를 확인한다.
   이때부터 백그라운드 쓰기가 생길 수 있으므로 **쓰기가 발생한 뒤의 복구 규칙**이 적용된다.
4. 점검을 해제하고 기존 세션, 새 로그인, 영상 업로드·재생, 분석 완료, 코치 1턴을 확인한다.
   OAuth origin과 S3 CORS는 최종 도메인이 같다는 전제로 유지하되 실제 호출로 검증한다.
   웹뿐 아니라 운영 모바일 앱의 로그인·업로드·분석도 확인한다. 분석 작업의 상태 전이와 외부 API 오류,
   Sentry의 운영 환경·릴리스, 컨테이너 재시작·메모리·디스크를 함께 확인한다.
5. GitHub `prod` 환경 `HOME_PUBLIC_URL`을 `https://acttub.com`으로 변경하고 저장된 값을 다시 조회한다.
   준비용 health 경로는 필요가 끝나면 닫는다. 운영 DB의 자동 백업과 S3 객체 생성 시각을 확인한다.
6. 전환 완료 시각·첫 홈서버 쓰기 시각·SHA·DNS 이전 값·최종 원본 백업·기능 검증 결과를 남긴다.
   AWS EC2·RDS·CloudFront·ALB·NAT·IAM·배포 버킷은 삭제하지 않는다. 인스턴스 중지나 비용 정리는
   검증 결과와 복구 절차를 확인한 뒤 별도로 다룬다.

## 6. AWS로 복구

### 홈서버 쓰기 시작 전

홈서버 유입·워커를 계속 막고, 소스 RDS가 최종 덤프 이후 변경되지 않았음을 확인한다. 이전 DNS·CloudFront
경로를 복원하고 AWS API·웹을 같은 운영 SHA로 기동해 health와 DB 읽기를 확인한 뒤 점검을 해제한다.
기능 검사로 만든 데이터나 워커 쓰기가 한 건이라도 있다면 아래 순서를 따른다.

### 홈서버 쓰기 시작 후

**DNS만 AWS로 되돌리면 새 데이터가 사라진 것처럼 보이고 두 DB에 쓰기가 갈라진다.** 다음 순서를 따른다.

1. 모든 유입을 닫고 홈서버의 진행 중 작업을 §3처럼 마무리한다. 홈서버 API·워커·백업을 멈추고,
   AWS 앱도 정지 상태로 유지한다. 홈서버 DB가 이 시점의 유일한 원본이다.
2. 최종 홈서버 덤프·행 수·내용 지문·스키마·시퀀스를 만든다. 기존 RDS도 복구 작업 전 보존한다.
   사전에 검증한 역복원 방식으로 홈서버 최종 데이터를 AWS DB에 복원한다.
3. 행 수·내용·Flyway·시퀀스·권한과 운영 이미지의 DB 호환성을 확인한다. 실패하면 양쪽 쓰기를 닫은 채
   원인을 해결한다. 오래된 RDS에 사용자를 먼저 연결하지 않는다.
4. AWS 앱을 검증한 DB로 기동하고 DNS·CloudFront 경로를 이전 값으로 복원한다. health와 로그인·업로드·분석을
   확인한 뒤 점검을 해제한다. 수동 배포는 `main` ref의 `destination=aws-rollback`을 사용한다.
   자동 배포는 홈서버가 기본이므로, 복구 상태 동안 `main` 배포를 동결하거나 CI를 거친 변경으로 배포 경로를
   복구한다. 수동 입력 한 번으로 다음 자동 배포 목적지까지 바뀌는 것은 아니다.
5. 홈서버 볼륨·최종 덤프와 기존 RDS 보존본을 남긴다. 이 절차는 더 긴 점검 시간을 요구하며,
   홈서버 디스크 자체가 사라진 장애는 마지막 성공 S3 백업 이후의 쓰기를 되살릴 수 없을 수 있다.

복구했다고 이력이 자동으로 돌아가지는 않는다. `main` 변경을 revert했다면 브랜치 전략의 `dev` 역병합까지
처리하고, 다음 자동 배포가 잘못된 호스트를 다시 켜지 않는지 확인한다.
