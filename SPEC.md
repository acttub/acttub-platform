# SOMA-296 — S3 접근을 access key에서 EC2 인스턴스 role로 전환

- 브랜치: `feat/SOMA-296-s3-instance-role` (worktree `../acttub-s3-role-worktree`)
- BASE_REF: `83be897`
- 범위: `apps/api`만. **프론트·API 계약은 바뀌지 않는다.**

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
- 코드가 쓰는 S3 액션: `put_object`(presign), `get_object`(presign + 워커 다운로드),
  `head_object`, `delete_object`.
- **`DeleteObject`·`ListBucket`은 현재 어느 정책에도 없다** → 5장 참고(스코프 밖).

## 3. 설계 결정

### D1. 자격증명 소스는 우선순위 하나로 (환경별 분기 없음)

`storage.py`: `access_key_id`/`secret_access_key`가 **주어지면** boto3에 명시 전달하고,
**없으면 인자를 아예 넘기지 않아** boto3 기본 자격증명 체인(→ 인스턴스 role)에 맡긴다.
환경을 보고 분기하는 `if`를 두지 않는다. 리전 엔드포인트 고정(`endpoint_url`)은 그대로 둔다.

이 우선순위가 곧 **롤백 경로**다 — api.env에 키를 되돌려 넣고 재시작하면 코드 재배포 없이
원상 복구된다.

### D2. `s3_storage`는 bucket+region만 있으면 항상 생성한다

`config.py`: `s3_configured`를 `bucket and region`으로 완화한다. 이름은 그대로 둔다
(호출부·테스트가 이미 쓰고 있고 diff를 좁게 유지한다).

기동 시점에 자격증명 유무로 `s3_storage=None`을 판정하지 **않는다.** 부팅 직후 IMDS가
아직 안 뜬 순간에 판정하면 `s3_storage`가 None으로 굳는데, 프로세스는 살아 있으니
`Restart=always`가 발동하지 않아 **사람이 알아채기 전까지 S3 기능만 영구히 503**이 된다.
지금은 없는 실패 모드를 만들지 않는다.

### D3. 자격증명 부재는 기동 로그 경고 + 요청 시 503

- 기동 시 `session.get_credentials()`를 1회 호출해 **로그만** 남긴다. `method` 값
  (`iam-role` / `env` / `shared-credentials-file` / 없음)을 포함한다 — 3단계 전환이 실제로
  일어났는지 확인하는 유일한 증거다. 네트워크 호출(`head_bucket` 등)은 하지 않는다.
- `NoCredentialsError` 계열만 **503 `storage_not_configured`** 전역 예외 핸들러로 매핑한다.
  라우터 3곳(`uploads.py:65`, `practice_sessions.py:230`, `reports.py:197`)은 손대지 않는다.
- **`ClientError`는 매핑하지 않는다.** AccessDenied가 503에 묻히면 이번 전환에서 제일 보고
  싶은 신호가 죽는다 — 권한 오류는 500으로 시끄럽게 터지는 편이 안전하다.
- IMDS가 회복되면 boto3가 다음 요청에서 자격증명을 재해석하므로 **자동 복구**된다.

### D4. env 검증 규칙

| 조합 | 동작 |
|---|---|
| `S3_BUCKET` / `AWS_REGION` 중 하나만 | 기동 실패 (region 없이는 presign 엔드포인트를 못 만든다) |
| key / secret 한쪽만 | 기동 실패 (반쪽 키는 설정 실수) |
| key·secret 둘 다 | 그 키를 쓴다 (로컬 개발·롤백) |
| key·secret 둘 다 없음 | 기본 체인 → role (목표 상태) |
| bucket·region 없이 key만 | 무시하고 S3 비활성 (AWS_REGION은 S3 외 용도로도 놓인다) |

즉 **bucket+region은 함께 필수, key+secret은 함께 선택.** 에러 메시지도 둘로 나눈다.

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

`acttub-dev-ec2-role`에 인라인으로 붙인다. **전환 전후 동작이 100% 같다**는 것이 이 선택의
이유다. `DeleteObject`·`ListBucket`을 넣어 코드-정책 어긋남을 고치는 안도 검토했으나,
이 티켓의 목적은 격리이지 버그 수정이 아니므로 5장으로 분리한다.

이 선택의 부수 효과로 dev·운영 액션 세트가 같아져 **운영은 IAM 추가 작업이 없다**
(`acttub-video-s3-access`가 이미 prod/*에 Get/Put을 준다).

### D6. presign TTL은 손대지 않는다 (알려진 제약)

role의 임시 자격증명으로 서명한 URL은 **그 자격증명이 만료되면 `ExpiresIn`과 무관하게 같이
죽는다.** boto3 IMDS 공급자가 만료 15분 전에 갱신하므로, 서명 시점 잔여 수명이 15분뿐인
순간이 정상적으로 존재한다.

| 발급처 | TTL | 최악 |
|---|---|---|
| `admin.py:23` 관리자 재생 | 3600초 | 최대 45분 조기 만료 |
| `uploads.py:13` 업로드 | 30분 | 최대 15분 조기 만료 |
| `practice_sessions.py:14` 재생 | 15분 | 사실상 영향 없음 |

업로드 URL은 발급 직후 쓰이고 관리자 화면은 새로고침하면 새 URL이 나온다. TTL을 낮추면
`playback_expires_in_sec` 응답값이 바뀌어 **"계약은 안 바뀐다"는 전제가 깨지므로** 두지 않는다.

## 4. 실행 순서 (뒤집으면 업로드 503)

### dev

1. **role 권한 부여** — `aws iam put-role-policy --role-name acttub-dev-ec2-role`
   (`--profile acttub`). 이 시점엔 아무 동작도 바뀌지 않는다.
2. **PR 머지 → dev 자동 배포.** api.env에 키가 남아 있으므로 D1의 우선순위에 따라 **키로
   계속 동작**한다. 코드 변경만 먼저 안착시킨다.
3. **dev `/etc/acttub/api.env`에서 `AWS_ACCESS_KEY_ID`·`AWS_SECRET_ACCESS_KEY` 제거 후
   `systemctl restart acttub-api`** — 여기서 role로 전환된다. (SSM 접속)
4. **검증** (6장). 브라우저 확인은 사용자가 한다.

### 운영 (dev 검증 통과 + 사용자 확인 후에만)

IAM 추가 작업 없음(D5). 같은 순서로 2→3→4. **운영 배포는 수동이므로 반드시 먼저 묻는다.**

### 롤백

api.env에 키를 되돌리고 재시작. 코드 재배포 불필요(D1).

## 5. 하지 말 것 (스코프 밖)

- **`acting-api` IAM 사용자 키의 Inactive 전환·삭제** — 며칠 관찰 후 별도로 처리한다.
  secret은 복구 불가.
- **`DeleteObject` 권한 누락 버그** — `analysis_worker.sweep`(`analysis_worker.py:156-164`)이
  만료 업로드 객체를 지우려다 실패하고 예외를 warning으로 삼킨다. 현재 dev·운영 모두 조용히
  실패 중. 별도 티켓.
- **`ListBucket` 누락으로 없는 객체 head가 403→500** — `uploads.py:132`의 409
  `upload_not_found` 경로가 사실상 도달 불가. **role 전환이 만드는 회귀가 아니라 현행 동작**이다.
  별도 티켓.
- **로컬 개발자 자격증명 대책** — 로컬 `.env`가 같은 공유 키를 쓴다면 나중에 Inactive되는
  순간 로컬 업로드가 깨진다. 개인 키나 SSO 전환은 별도.
- admin presign TTL 조정(D6).
- 스코프 밖 리팩터링 일체.

## 6. 완료 기준 체크리스트

### 코드

- [ ] `storage.py` — 키가 주어지면 명시 전달, 없으면 boto3에 인자를 넘기지 않는다. 환경 분기 `if` 없음
- [ ] `config.py` — `s3_configured`가 bucket+region만 요구. D4 검증 규칙 두 갈래
- [ ] `app.py` — 변경된 생성자 시그니처에 맞춰 호출부 수정
- [ ] 기동 시 자격증명 소스 로그 (`method` 포함, 네트워크 호출 없음)
- [ ] `NoCredentialsError` → 503 `storage_not_configured` 전역 핸들러. `ClientError`는 미매핑

### 테스트 (`uv run --package acting-api pytest`)

- [ ] bucket+region만 → `s3_configured is True`
- [ ] key 한쪽만 → RuntimeError
- [ ] bucket만 / region만 → RuntimeError
- [ ] 키를 주면 boto3에 명시 전달, 안 주면 **인자를 넘기지 않는다** (`boto3.client` monkeypatch)
- [ ] `NoCredentialsError` → 503 응답
- [ ] 기존 테스트 전부 통과 (`test_gateway_config.py`, `test_platform_v2.py`, `test_storage.py`)

### 문서

- [ ] `apps/api/API.md:334` — S3 4종 all-or-none 서술 갱신
- [ ] `apps/api/CLAUDE.md:22` — 동일
- [ ] `apps/api/acting-api/README.md:11` — 로컬 실행 예시
- [ ] `docs/DEPLOY-VPC.md:137-138` — api.env 예시에서 키 제거 / `438-442` "아직 남은 것" 항목 해소
- [ ] `docs/DEPLOY-DEV.md:199` — 환경변수 표
- [ ] `deploy/bootstrap-dev.sh:91-98` — 새 서버 api.env 뼈대에서 키 자리 제거
- [ ] `TODO.md` — 키 Inactive 관찰 후 삭제 + 5장의 별도 티켓 2건 기록

### dev 검증 (3단계 재시작 후)

- [ ] `journalctl -u acttub-api`에 `method=iam-role`
- [ ] 업로드 → complete → 재생 (브라우저, 사용자 확인)
- [ ] 분석 워커 완주 (GetObject 다운로드 경로)
- [ ] **격리 증명** — dev 서버에서 `acttub-practice-videos-prod`에 접근 시 **AccessDenied**.
      이걸 안 하면 "여전히 동작한다"만 확인하고 끝나 경계가 생겼다는 증명이 안 된다

### 운영 (사용자 확인 후)

- [ ] 수동 배포 → api.env 키 제거 → 재시작 → 같은 검증 4종

## 7. 미결 사항

- 운영 `acttub-video-s3-access`의 `AbortMultipartUpload`·`ListMultipartUploadParts`는 코드가
  멀티파트를 쓰지 않아 불필요하다. 제거는 하지 않는다(무해, diff 축소 우선).
- dev 버킷 객체 2개 / 운영 103개. 이 중 만료 intent 잔여물이 얼마인지는 5장의 별도 티켓에서
  다룬다.
