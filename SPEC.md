# SOMA-296 — S3 접근을 access key에서 EC2 인스턴스 role로 전환

- 브랜치: `feat/SOMA-296-s3-instance-role` (worktree `../acttub-s3-role-worktree`)
- BASE_REF: `83be897`
- 범위: `apps/api`만. **프론트·API 계약은 바뀌지 않는다.**
- 개정: Codex 설계 비판 반영(2026-08-04) — D1·D2·D3 변경, 4장에 preflight·키 백업 추가.

## 1. 배경과 목적

키 관리 개선이 아니라 **dev·운영 데이터 경계를 만드는 작업**이다.

지금 dev 서버와 운영 back svc가 **같은 IAM 사용자 키**(`acting-api`)를 쓰고, 그 정책
`acting-api-s3`(v2)가 `acttub-practice-videos-dev/*`와 `-prod/*`를 **둘 다 허용**한다.
버킷은 `S3_BUCKET` env로만 갈라져 있어 자격증명에는 경계가 없다 — dev 서버에서 env만
바꾸면 운영 영상에 닿는다.

코드가 role을 못 쓰는 이유는 두 가지다.

- `config.py:50` `s3_configured`가 bucket/key/secret/region **넷 다** 요구한다.
- `storage.py:40` 이 boto3에 키를 명시 전달해 기본 자격증명 체인(→ 인스턴스 role) 탐색이
  아예 일어나지 않는다.

## 2. 현황 (2026-08-04 실측)

| 대상 | 허용 액션 | 리소스 |
|---|---|---|
| IAM 사용자 정책 `acting-api-s3` (v2) | `PutObject`, `GetObject` | dev/* **및** prod/* |
| 운영 role `acttub-be-prod-ec2-role` → `acttub-video-s3-access` (v3) | `GetObject`, `PutObject`, `AbortMultipartUpload`, `ListMultipartUploadParts` | prod/* |
| dev role `acttub-dev-ec2-role` | SSM core + `acttub-dev-deploy`(배포 버킷 읽기) | 영상 버킷 권한 **없음** |

- 인스턴스: dev `i-0f101fb852e26d081`, 운영 be `i-08a90c20095d4ecf1`. 둘 다 SSM 접속.
- **IMDS**(양쪽 동일): `HttpEndpoint=enabled`, `HttpTokens=required`(IMDSv2),
  `HopLimit=2`. boto3는 IMDSv2를 지원하고 호스트 systemd 프로세스라 hop 2로 충분하다.
- **버킷**(양쪽 동일): bucket policy **없음**, 기본 암호화 **SSE-S3(AES256)**.
  KMS key policy가 principal 전환을 막을 여지가 없다.
- 코드가 쓰는 S3 액션: `put_object`(presign), `get_object`(presign + 워커 다운로드),
  `head_object`, `delete_object`.
- **`DeleteObject`·`ListBucket`은 현재 어느 정책에도 없다** → 5장 참고(스코프 밖).

## 3. 설계 결정

### D1. 자격증명은 boto3 기본 체인에만 맡긴다 (코드에 분기 없음)

`storage.py`가 자격증명 인자를 **아예 넘기지 않는다.** `region_name`과 `endpoint_url`
(리전 엔드포인트 고정)만 전달한다.

키를 명시 전달하는 분기를 두지 않는 이유: boto3 기본 체인의 우선순위가 이미
**환경변수 > 공유 파일 > IMDS(인스턴스 role)** 이고, `/etc/acttub/api.env`는 systemd
`EnvironmentFile`로 프로세스 환경에 들어가므로(`acttub-api.service:13`), 키가 있으면
boto3가 알아서 먼저 집는다. 코드가 같은 우선순위를 다시 구현할 이유가 없다.

부수 효과로 `AWS_SESSION_TOKEN`이 자동 지원된다 — 명시 전달 방식은 이 값을 버려서
SSO·임시 자격증명으로는 롤백조차 못 한다.

`config.py`의 `aws_access_key_id`/`aws_secret_access_key` 필드는 **client 생성에는 쓰이지
않고** D4의 반쪽 키 감지 용도로만 남는다.

이 우선순위가 곧 **롤백 경로**다 — api.env에 키를 되돌려 넣고 재시작하면 코드 재배포 없이
원상 복구된다.

### D2. `S3_BUCKET`이 설정됐는데 자격증명을 못 찾으면 기동 실패

`s3_configured`를 `bucket and region`으로 완화한다. 이름은 그대로 둔다(호출부·테스트가
이미 쓰고 있고 diff를 좁게 유지한다).

`s3_configured`가 True인데 `session.get_credentials()`가 None이면 **`RuntimeError`로 기동을
중단한다.**

당초 "뜨고 나서 503" 안을 검토했으나 **botocore 동작이 그것을 불가능하게 한다**:
`botocore/session.py:986`의 `create_client`가 `credentials = self.get_credentials()` 결과를
client에 고정한다. 기동 시 None이면 **그 client는 IMDS가 회복돼도 영원히
`NoCredentialsError`**다. `get_credentials()` 자체는 None을 캐시하지 않지만 client가 붙든다.
따라서 "다음 요청에서 자동 복구"는 성립하지 않는다.

기동 실패로 두면 `Restart=always` + `RestartSec=3`(`acttub-api.service:19-20`)이 IMDS가
준비될 때까지 재시도하므로 **부팅 레이스가 systemd 층에서 자동 해소**되고, 잘못된 상태로
트래픽을 받지 않는다.

로컬 개발은 `S3_BUCKET`을 주지 않으면 지금처럼 S3 비활성으로 뜬다(현행과 동일).

### D3. 기동 로그에 자격증명 소스를 남기고, 런타임 자격증명 실패는 503

- 기동 시 `boto3.Session()` **하나**를 만들어 `get_credentials()`로 판정·로깅하고,
  **같은 Session으로 S3 client를 만든다.** 로그의 `method`가 실제 presign·download에 쓰이는
  principal과 일치해야 의미가 있다.
- 로그에 `method` 값(`iam-role` / `env` / `shared-credentials-file` 등)을 남긴다 — 3단계
  전환이 실제로 일어났는지 확인하는 **유일한 증거**다.
- 이 호출은 role 경로에서 **IMDS 네트워크 조회다**(무비용 로컬 조회가 아니다). 실패는 D2에
  따라 기동 실패로 이어지고 systemd가 재시도한다.
- 런타임 자격증명 실패 — `NoCredentialsError`뿐 아니라 **`CredentialRetrievalError`·
  `MetadataRetrievalError`**(refresh 실패 계열)까지 **503 `storage_not_configured`** 전역
  예외 핸들러로 매핑한다. 라우터 3곳(`uploads.py:65`, `practice_sessions.py:230`,
  `reports.py:197`)은 손대지 않는다.
- **`ClientError`는 매핑하지 않는다.** AccessDenied가 503에 묻히면 이번 전환에서 제일 보고
  싶은 신호가 죽는다 — 권한 오류는 500으로 시끄럽게 터지는 편이 안전하다.

### D4. env 검증 규칙

| 조합 | 동작 |
|---|---|
| `S3_BUCKET` / `AWS_REGION` 중 하나만 | 기동 실패 (region 없이는 presign 엔드포인트를 못 만든다) |
| key / secret 한쪽만 | 기동 실패 (반쪽 키는 설정 실수) |
| bucket+region 있고 자격증명 해석 실패 | 기동 실패 (D2) |
| key·secret 둘 다 | boto3 env provider가 집는다 (로컬 개발·롤백) |
| key·secret 둘 다 없음 | 기본 체인 → IMDS role (목표 상태) |
| bucket·region 없이 key만 | 무시하고 S3 비활성 (AWS_REGION은 S3 외 용도로도 놓인다) |

즉 **bucket+region은 함께 필수, key+secret은 함께 선택.** 에러 메시지도 갈래별로 나눈다.

### D5. dev role 정책은 현행 액션 세트와 동일하게 (Put/Get만)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::acttub-practice-videos-dev/*"
    }
  ]
}
```

`acttub-dev-ec2-role`에 인라인 정책 `acttub-dev-videos-s3`로 붙인다. **전환 전후 IAM 허용
액션이 같다**는 것이 이 선택의 이유다. `DeleteObject`·`ListBucket`을 넣어 코드-정책 어긋남을
고치는 안도 검토했으나, 이 티켓의 목적은 격리이지 버그 수정이 아니므로 5장으로 분리한다.

principal이 IAM user → role로 바뀌는 것 자체의 위험은 2장에서 확인했다(bucket policy 없음,
SSE-S3라 KMS 무관). 남은 미확인 요소는 조직 SCP뿐이며, 이는 4장의 preflight에서 실제 호출로
검증한다.

이 선택의 부수 효과로 dev·운영 액션 세트가 같아져 **운영은 IAM 추가 작업이 없다**
(`acttub-video-s3-access`가 이미 prod/*에 Get/Put을 준다).

### D6. presign TTL은 손대지 않는다 (알려진 제약)

role의 임시 자격증명으로 서명한 URL은 **그 자격증명이 만료되면 `ExpiresIn`과 무관하게 같이
죽는다.**

정상 상태에서는 botocore가 만료 15분 전(advisory)에 갱신을 시도하므로 대부분의 서명은 새
자격증명으로 이뤄지고 URL은 광고된 TTL을 채운다. 문제는 **갱신이 실패할 때**다 — advisory
구간에서 실패하면 오래된 자격증명으로 서명해 URL이 조기 만료되고, mandatory 구간(만료 10분
전)에서 실패하면 예외가 전파된다(D3의 503 매핑 대상).

| 발급처 | TTL | 노출도 |
|---|---|---|
| `admin.py:23` 관리자 재생 | 3600초 | 가장 큼 — 광고 TTL과 실제 수명이 어긋날 수 있다 |
| `uploads.py:13` 업로드 | 30분 | 발급 직후 쓰이므로 실질 영향 작음 |
| `practice_sessions.py:14` 재생 | 15분 | 사실상 영향 없음 |

TTL을 낮추면 `playback_expires_in_sec` 응답값이 바뀌어 **"계약은 안 바뀐다"는 전제가
깨지므로** 이번에는 두고, 7장의 관찰 항목으로 남긴다.

## 4. 실행 순서 (뒤집으면 업로드 503)

### dev

1. **role 권한 부여**
   ```
   aws iam put-role-policy --profile acttub \
     --role-name acttub-dev-ec2-role \
     --policy-name acttub-dev-videos-s3 \
     --policy-document file://<정책 JSON>
   aws iam get-role-policy --profile acttub \
     --role-name acttub-dev-ec2-role --policy-name acttub-dev-videos-s3
   ```
   `get-role-policy`로 적용 결과를 눈으로 확인한다. 이 시점엔 앱 동작이 아무것도 안 바뀐다.

2. **PR 머지 → dev 자동 배포.** api.env에 키가 남아 있으므로 boto3 env provider가 먼저
   잡아 **키로 계속 동작**한다(D1). 코드 변경만 먼저 안착시킨다.

3. **preflight — 키를 지우기 전에 role 경로를 먼저 증명한다.** SSM으로 접속해
   **서비스와 같은 계정(`User=ubuntu`)·같은 환경**에서, env 키를 무력화한 상태로:
   - `acttub-practice-videos-dev`에 Get/Put이 **성공**하는지
   - `acttub-practice-videos-prod`에 접근이 **AccessDenied**인지
   - 붙은 principal이 `acttub-dev-ec2-role`인지 (`sts get-caller-identity`)

   SSM 기본 계정(`ssm-user`)의 CLI 성공은 `ubuntu`로 도는 앱의 체인을 증명하지 않는다.
   조직 SCP 등 저장소에서 알 수 없는 요인도 여기서 함께 걸러진다.

4. **키를 안전한 곳에 백업한 뒤** `/etc/acttub/api.env`에서 `AWS_ACCESS_KEY_ID`·
   `AWS_SECRET_ACCESS_KEY`를 제거하고 `systemctl restart acttub-api`.
   백업 없이 지우면 롤백(키 복원)이 **실행 불가능**하다.

5. **검증** (6장). 브라우저 확인은 사용자가 한다.

   `/health`는 S3를 보지 않으므로(`app.py:194-206`) 여전히 자동 판정만으로는 부족하다.
   다만 배포 스크립트의 판정은 이번에 보강했다 — `Type=simple`은 exec 직후 곧바로 active가
   되어 **기동에 실패해 크래시루프 중인 프로세스도 3초 뒤 `is-active`에는 성공으로 읽힌다.**
   이번 변경이 "기동 실패"를 새 실패 모드로 도입했으므로, `ssm-deploy.sh`가 자동 재시작
   카운터(`NRestarts`)를 함께 확인하도록 고쳤다. 그래도 최종 확인은 사람이 한다.

### 운영 (dev 검증 통과 + 사용자 확인 후에만)

IAM 추가 작업 없음(D5). 같은 순서로 2→3→4→5. **운영 배포는 수동이므로 반드시 먼저 묻는다.**
운영 재시작은 진행 중인 분석 작업을 끊을 수 있으므로(7장) 한산한 시간대를 고른다.

### 롤백

백업해 둔 키를 api.env에 되돌리고 재시작. 코드 재배포는 불필요하다(D1).

**다만 롤백 상태는 정상 완료가 아니라 incident 상태다** — 공유 IAM 사용자 정책이 두 버킷을
모두 허용하므로 이 티켓의 목적인 데이터 경계가 그대로 사라진다. 롤백했다면 원인을 규명하고
재전환할 때까지 열린 항목으로 추적한다.

## 5. 하지 말 것 (스코프 밖)

- **`acting-api` IAM 사용자 키의 Inactive 전환·삭제** — 며칠 관찰 후 별도로 처리한다.
  secret은 복구 불가.
- **`DeleteObject` 권한 누락 버그** — `analysis_worker.sweep`(`analysis_worker.py:156-164`)이
  만료 업로드 객체를 지우려다 실패하고 예외를 warning으로 삼킨다. 현재 dev·운영 모두 조용히
  실패 중. 별도 티켓.
- **`ListBucket` 누락으로 없는 객체 head가 403→500** — `uploads.py:132`의 409
  `upload_not_found` 경로가 사실상 도달 불가. **role 전환이 만드는 회귀가 아니라 현행 동작**이다.
  별도 티켓.
- **`/health`에 S3 상태를 넣는 것** — S3 장애 시 ALB가 멀쩡한 인스턴스를 죽여 장애를 키운다.
  배포 판정은 5장처럼 사람이 확인한다.
- **로컬 개발자 자격증명 대책** — 로컬 `.env`가 같은 공유 키를 쓴다면 나중에 Inactive되는
  순간 로컬 업로드가 깨진다. 개인 키나 SSO 전환은 별도. (D1 덕분에 SSO 임시 자격증명이
  `AWS_SESSION_TOKEN`과 함께 동작하긴 한다.)
- admin presign TTL 조정(D6).
- 스코프 밖 리팩터링 일체.

## 6. 완료 기준 체크리스트

### 코드

- [ ] `storage.py` — boto3에 자격증명 인자를 **넘기지 않는다**. `region_name`·`endpoint_url`만. 환경 분기 `if` 없음
- [ ] `config.py` — `s3_configured`가 bucket+region만 요구. D4 검증 규칙
- [ ] `app.py` — `boto3.Session()` 하나로 판정·로깅·client 생성. `s3_configured`인데 자격증명 없으면 `RuntimeError`
- [ ] 기동 로그에 credential `method` 기록
- [ ] `NoCredentialsError`·`CredentialRetrievalError`·`MetadataRetrievalError` → 503 전역 핸들러. `ClientError`는 미매핑

### 테스트 (`uv run --package acting-api pytest`)

- [ ] bucket+region만 → `s3_configured is True`
- [ ] key 한쪽만 → RuntimeError
- [ ] bucket만 / region만 → RuntimeError
- [ ] bucket+region 있는데 자격증명 해석 실패 → 기동 RuntimeError
- [ ] `boto3.client` 호출 인자에 `aws_access_key_id`/`aws_secret_access_key`가 **없다** (monkeypatch)
- [ ] 판정에 쓴 Session과 client를 만든 Session이 동일하다
- [ ] `NoCredentialsError` / refresh 실패 계열 → 503 응답
- [ ] 기존 385개 전부 통과 (기준선: 330 passed, 55 skipped)

### 문서

- [ ] `apps/api/API.md:334` — S3 4종 all-or-none 서술 갱신
- [ ] `apps/api/CLAUDE.md:22` — 동일
- [ ] `apps/api/acting-api/README.md:11` — 로컬 실행 예시
- [ ] `docs/DEPLOY-VPC.md:137-138` — api.env 예시에서 키 제거 / `438-442` "아직 남은 것" 항목 해소
- [ ] `docs/DEPLOY-DEV.md:199` — 환경변수 표
- [ ] `deploy/bootstrap-dev.sh:91-98` — 새 서버 api.env 뼈대에서 키 자리 제거
- [ ] `TODO.md` — 키 Inactive 관찰 후 삭제 + 5장의 별도 티켓 2건 기록

### dev 검증

- [ ] **preflight**(4장 3단계) — `ubuntu` 계정에서 role principal 확인 + dev 버킷 Get/Put 성공 + **prod 버킷 AccessDenied**
- [ ] 재시작 후 `journalctl -u acttub-api`에 `method=iam-role`
- [ ] 업로드 → complete → 재생 (브라우저, 사용자 확인)
- [ ] 분석 워커 완주 (GetObject 다운로드 경로)

### 운영 (사용자 확인 후)

- [ ] 수동 배포 → preflight → 키 백업 후 제거 → 재시작 → 같은 검증

## 7. 미결·관찰 항목

- **자격증명 refresh를 한 번 넘긴 뒤의 동작** — 기존 테스트는 fake client를 주입해 IMDS·
  refresh를 전부 우회한다. cutover 다음 날 업로드·재생·워커를 한 번 더 확인한다.
- **admin URL의 실제 수명** — `playback_expires_in_sec=3600`이 광고값과 어긋나는지(D6).
  어긋나는 게 확인되면 TTL 하향을 별도 티켓으로 연다(계약 변경이므로).
- **재시작과 진행 중 분석 작업** — 워커 종료가 실행 중인 다운로드·분석을 취소하지 않고
  `join()`하므로(`analysis_worker.py:117-150`), systemd가 강제 종료하면 lease가 남아 최대
  lease 만료까지 재분석이 지연될 수 있다. 운영은 한산한 시간대에 한다.
- 운영 `acttub-video-s3-access`의 `AbortMultipartUpload`·`ListMultipartUploadParts`는 코드가
  멀티파트를 쓰지 않아 불필요하다. 제거는 하지 않는다(무해, diff 축소 우선).
- dev 버킷 객체 2개 / 운영 103개. 이 중 만료 intent 잔여물이 얼마인지는 5장의 별도 티켓에서
  다룬다.
- **admin URL의 `expires_at` 계약** — `uploads.py:84`가 `now + 30분`을 DB에 저장해 응답하고
  admin은 `playback_expires_in_sec=3600`을 광고한다. 임시 자격증명이 그보다 먼저 만료되면
  클라이언트가 유효하다고 믿는 동안 S3가 거절한다(D6의 알려진 제약이 계약 층까지 번진
  형태). 관찰해서 실제로 어긋나면 TTL 하향을 별도 티켓으로 연다.

- **기각한 지적**:
  - "기본 체인이라 `~/.aws/credentials`가 우선해 경계가 안 생긴다" — 두 EC2에 공유 자격증명
    파일이 없고, 있더라도 D3의 `method` 로그와 4장 preflight에서 즉시 드러난다.
  - "fail-closed를 feature flag로 분리해 canary하고, blue/green + 자동 rollback을 갖춰라" —
    dev·운영 모두 단일 인스턴스 구조라 blue/green이 성립하지 않는다. 이 티켓에서 감당할
    범위를 크게 넘고, 실질 방어는 4장 3단계 preflight(키를 지우기 **전에** role 경로를 증명)와
    보강한 배포 판정(`NRestarts`)이 담당한다.
  - "기동 시 expected credential method와 role ARN을 코드에서 강제하라" — 환경별 분기를 코드에
    되살리는 안이라 D1의 전제와 정면으로 어긋난다. principal 검증은 코드가 아니라 롤아웃
    절차(preflight)의 몫으로 남긴다.
