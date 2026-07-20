# 설계 결정 기록 — 플랫폼 v2

> v2(플랫폼 통합) 구현은 완료됐다. **API 명세는 [API.md](../API.md)**, **스키마의 진실은
> 코드**(`acting-api/src/acting_api/db/models.py` + `alembic/versions/0001_initial_schema.py`),
> 시각화는 [spec/api-spec.html](../spec/api-spec.html), ERD 소스는 [spec/erd.mmd](../spec/erd.mmd).
> 이 문서는 코드만으로는 알 수 없는 **"왜"** — 확정된 스택과 설계 결정의 근거 — 만 남긴다.

## 확정 스택 (2026-07 설계 리뷰)

- **v1 API 클린 브레이크** — 외부 클라이언트가 없어 병행 운영·legacy 매핑 없이 v1
  엔드포인트와 X-API-Key 인증을 제거. 데이터 이관도 없음 (Alembic 0001을 v2로 리셋, 빈 DB 시작)
- **배포는 EC2**, 스토리지는 **AWS S3** (presigned PUT 업로드, 서명 URL 재생)
- **비동기 분석 워커는 웹 프로세스 내 백그라운드 스레드** — external_operations의 pending을
  폴링. 재배포로 죽어도 lease 만료 후 새 프로세스가 이어받음. 트래픽 증가 시 같은 코드를
  별도 워커 프로세스로 분리 가능 (lease 덕에 동시 가동 안전)
- **JWT HS256** — 검증 주체가 이 서버뿐이라 RS256의 키 관리 복잡도가 무의미. access 30분 /
  refresh 14일 회전(재사용 감지 시 전체 회수). 외부 검증 주체가 생기면 RS256 전환
- **소셜 로그인 1차 구글만** — provider별 검증 모듈을 꽂는 레지스트리 구조, 애플·카카오는 후속
- **rate limit 사용자별 60회/분** (인메모리 고정 윈도우) + login·refresh는 IP별 60회/분.
  60인 이유: 분석 폴링(10초=6회/분) + 코칭이 겹쳐도 정상 사용자는 도달 불가. 프로세스가
  여럿이 되면 Redis로

## DB 스키마 개요 — 13개 테이블

상세 컬럼·제약·인덱스는 `alembic/versions/0001_initial_schema.py`가 진실이다.
모든 식별자는 UUID(anomalies·coach_turns의 bigserial 제외), 모든 시간은 timestamptz(UTC).

| 그룹 | 테이블 | 요지 |
|---|---|---|
| Account (5) | `users` `user_identities` `refresh_tokens` `consent_documents` `user_consents` | 소셜 로그인 자동 가입, email NULL 허용, 약관은 버전 관리 원본 + INSERT-only 동의 이력 |
| Practice (2) | `upload_intents` `practice_sessions` | presigned 업로드(파일 메타 단일 원천, finalize 시 ETag 고정), 세션은 hidden_at 소프트 삭제 |
| AI Coaching (5) | `summaries` `anomalies` `coach_sessions` `coach_turns` `reports` | v1 유지, summaries만 session_id 참조 + model·was_compressed 이동 |
| Operations (1) | `external_operations` | Gemini 외부 호출의 멱등성·재시도·lease 관리 |

user 귀속 FK 사슬: `reports → coach_sessions → summaries → practice_sessions → users`.
**파생 가능한 값은 저장하지 않는다** — 코칭 여부는 coach_sessions 존재로, 리포트 완료는
reports 존재로 조인 도출.

**약관 게시는 관리 CLI** (`python -m acting_api.consents publish ...`) — 약관 내용은
데이터이므로 마이그레이션에 하드코딩하지 않는다. AI 초안(`draft-1`)으로 개발·테스트하되
**출시 전 법적 검토 필수** — 영상(얼굴·음성) 수집 + AI 분석은 민감한 처리다
(`ai_analysis` 동의 타입이 있는 이유).

## external_operations 동작 규칙 (서버 내부 계약)

- **멱등성**: 같은 (user_id, request_id) 재요청은 새 작업을 만들지 않고 기존 행으로 응답 —
  succeeded면 response_payload 재반환(정규화 JSON으로 바이트 동일), running이면 처리 중 응답,
  failed면 재실행. request_fingerprint(kind + 요청 본문 SHA-256) 불일치는 422. 행 생성은
  INSERT … ON CONFLICT DO NOTHING이라 동시 중복 요청도 안전
- **lease**: 워커가 조건부 UPDATE 한 문장으로 선점(`lease_token IS NULL OR lease_expires_at
  < now()`), 결과 기록 시 `lease_token = <내 토큰>`으로 소유 확인. 기본 1800초 — 100MB
  다운로드 + 압축(600초) + Gemini ACTIVE 대기(300초)의 최악 조합을 한 번의 선점 안에 수용
- **워커는 PENDING과 lease 만료된 RUNNING만 선점한다.** FAILED의 재실행은 명시 경로
  (멱등 재요청·`/analyze`)만 — 실패한 작업을 자동으로 다시 돌려 유료 호출을 태우지 않는다
- **시도 횟수 상한**: lease 획득 UPDATE에서 attempt_count 동시 증가(완료 시점 집계는 워커
  사망 시 누락). 상한 3회 초과는 스윕이 `max_attempts_exceeded`로 failed 마감 — 스윕은
  1회성(이미 마감한 행은 재매칭하지 않음). 사용자 수동 재시도는 새 request_id의 새 작업
- **오류 분류**: Gemini 계열 예외만 세션을 failed로 만든다(gemini_timeout ·
  gemini_parse_error · unsupported_media). S3·DB 등 인프라 예외는 작업을 PENDING으로 되돌려
  attempt 예산 안에서 재시도 (일시 장애를 사용자에게 영구 실패로 보이지 않게)
- **결과 저장**: 정규 테이블 INSERT + 세션 status 갱신 + operation 마감을 **한 트랜잭션**으로.
  response_payload는 재응답용 캐시라 30일 후 삭제 가능
- lease가 본격 작동하는 것은 비동기 `analyze`뿐. 동기(coach/report)에선 멱등성이 주 용도

## 주요 설계 결정 기록

| 결정 | 근거 |
|---|---|
| v1 클린 브레이크 | 외부 클라이언트 없음 — 없는 사용자를 위한 병행 운영은 낭비. 지난 DB 도입 때와 같은 판단 |
| `api_keys` 제거 확정 (2026-07-18) | v1 제거로 사용처 0. 어드민·내부 도구 인증이 필요해지면 그때 새로 설계 (v1 구현은 git 히스토리에) |
| practice_videos 미도입 | upload_intents와 파일 메타 전면 중복. 트랜스코딩·재촬영 지원 시 도입 |
| ai_scene_id·external_id 제거 | 단일 DB라 논리 참조 대신 직접 FK, 소셜 로그인으로 서버가 직접 식별 |
| model·was_compressed는 summaries | 장면이 아닌 분석 실행의 속성 — 재분석마다 다를 수 있음 |
| practice_status_t 4개 값 | 코칭·리포트 여부까지 status에 넣으면 같은 사실이 두 곳에 저장돼 어긋남 (파생 값 저장 금지) |
| 분석만 비동기 | 수 분 소요 + 기다릴 이유 없음. 코칭은 대화 중 대기가 자연스러워 동기 |
| 영상 요약은 단일 구조화 Gemini 호출 | 영상 관찰·요약·이상징후 추출을 `SceneSummary` 응답 스키마 한 번에 묶는다. 정상 경로는 1회 호출하고 JSON 파싱 실패 때만 1회 재시도 |
| 이상징후는 5초 고정 스캔 + 결정적 severity | 00:00부터 5초 그리드와 고정 축 순서로 스캔하고 생성 파라미터를 고정한다. severity는 사실 점수로 서버가 재계산·정렬 |
| 코칭은 세션당 타깃 하나 | 최고 우선순위 anomaly 하나만 세션 종료까지 다루며 다른 문제로 이동하지 않음 |
| 코치 발화와 재생 시점 분리 | 배우에게 보이는 `utterance`는 타임스탬프·기술 수치·내부 라벨을 뺀 자연어로 만들고, UI용 시점은 `focus_timestamp`로만 전달 |
| S3 + presigned 업로드 | 최대 100MB 영상을 API 서버가 받지 않음 — 메모리·타임아웃 부담 제거 |
| finalize 시 ETag 고정 | presigned PUT이 만료 전까지 유효하므로, complete 시점의 ETag를 기록하고 워커가 다운로드 후 검증 — 분석 후 같은 크기 파일로 내용을 바꿔치기하는 경로 차단 |
| 만료 인텐트 스윕이 S3 객체도 삭제 | 미완료 업로드가 최대 100MB 고아 객체로 영구 잔존하는 것 방지 (best-effort 삭제 후 expired 마감) |
| 검증된 이메일만 자동 연결·저장 | 이메일 일치만으로 소유가 보장되지 않음 — 미검증 이메일은 계정 탈취 경로라 자동 연결 거부(409)하고 신규 가입 시 저장도 하지 않음(NULL). 이메일 없으면 별개 계정, 사후 "계정 연결"은 후속 확장 |
| 워커는 프로세스 내 스레드 | 현 규모에 별도 워커는 과함. lease 설계가 재배포·향후 분리를 안전하게 함 |
| 분석 완료 통지는 폴링 | 202 + GET 10초 간격으로 완결. FCM 푸시는 후속 확장(그때 device_tokens 추가) — 푸시는 "돌아와" 신호일 뿐 진실은 GET |
| rate limit 60회/분 고정 | 키별 DB 한도(v1) 대신 상수 — 비용 방어는 일일 분석 상한(출시 전)의 몫 |
| keepalive 존치 (opt-in) | EC2 상시 가동이면 불필요하나 제거 결정 전까지 KEEP_ALIVE_URL 설정 시에만 동작 |

## 출시 전 체크리스트 (실사용자 유입 전 필수)

- [ ] **애플 로그인** — iOS 앱이 소셜 로그인을 제공하면 Sign in with Apple 의무 (심사 요건)
- [ ] **카카오 로그인** — OIDC 활성화 필요 (id_token 발급용)
- [ ] **약관 법적 검토** — AI 초안을 검토본으로 교체 (새 version 게시)
- [ ] **일일 분석 상한** — 사용자당 예: 10회/일 (external_operations COUNT 한 줄). 외부 사용자 유입 시점에 활성화
- [ ] **response_payload 30일 정리** — 재응답 캐시 삭제 스윕
- [ ] **실제 PostgreSQL 통합 검증** — 네트워크 제약 없는 PostgreSQL에서 `RUN_DB_TESTS=1` 테스트 실행
- [ ] **acting-report 유료·E2E 검증** — 사용자 비용 승인 후 실제 Gemini 호출과 summary → agent → report 전체 파이프라인 실행
- [x] **render.yaml 정리** — EC2 이전 확정과 함께 제거 완료
