# DB 도입 후 API 변경 명세 — 값 전달에서 ID 참조로

> **상태: 확정 (구현 진행).** 현재 배포된 API 스펙은 [API.md](../API.md), DB 스키마는 [db-schema.md](db-schema.md), 논의는 [#1](https://github.com/acttub/acting-api-deploy/issues/1) 참고. 구현이 완료되면 확정된 내용을 API.md로 옮긴다.

지금은 클라이언트가 `SceneSummary`와 대화 전체를 매 단계 통째로 다시 업로드하는 구조다. DB가 생기면 서버가 기억하므로, 클라이언트는 ID만 넘기면 된다. **클린 브레이크로 전환한다** — 외부 클라이언트가 없어 통째 전달 방식과의 과도기 dual-accept 없이 즉시 교체한다.

## 요청 형태 변화

| 엔드포인트 | 현재 요청 | DB 도입 후 |
|---|---|---|
| `POST /summarize` | multipart form: `situation`, `character`, `subtext`, `video` | form에 `user_id` 필드 **추가(필수)** — `users` get-or-create 후 `scenes.user_id`에 기록, 파이프라인 전체의 user 귀속이 여기서 결정됨. 응답에 `summary_id` 추가(기존 `SceneSummary` 필드는 전부 유지), 결과를 DB에 저장 |
| `POST /coach/start` | `summary` 통째 + `subtext` | `{"summary_id": "..."}` — 서버가 DB에서 로드 (subtext도 `scenes`에 있음). user는 `summary → scene`에서 도출 |
| `POST /coach/reply` | `{"session_id", "text"}` | 변화 없음 |
| `POST /report` | `user_id` + `session` 통째 (summary·turns 포함) | `{"session_id": "..."}` — 대화·요약·user 모두 DB에서 로드/도출. 응답 형태(`user_id`, `report`, `report_count`)는 유지 |

노출되는 ID는 모두 표준 UUID 문자열. `GET /report/history/{user_id}`는 형태를 유지하되 내부는 `user → scenes → summaries → coach_sessions → reports` 조인으로 조회한다.

## 해결되는 문제

| 문제 | 어떻게 해결되나 |
|---|---|
| 스키마 사본 필드 유실 | summary가 클라이언트를 왕복하지 않으므로, 사본 스키마(`acting_agent`/`acting-report`)의 pydantic 재파싱으로 `overlaps_key_moment` 등 세 필드가 탈락할 경로 자체가 사라짐. DB에는 `/summarize` 시점의 온전한 값이 남음 |
| 데이터 위조 | 현재는 클라이언트가 summary를 조작해(`severity` 변조 등) 코치에 전달 가능. ID 참조면 서버가 저장한 원본만 사용 |
| 페이로드 크기 | 특히 `/report`는 대화 전체 재업로드가 `session_id` 하나로 축소 |
| 재배포 시 세션 소멸 (404) | 세션·요약이 DB에 있으므로 재시작해도 이어서 진행 가능 |

## 주의사항

| 항목 | 내용 |
|---|---|
| 하위 호환 | **클린 브레이크 확정** — 외부 클라이언트가 없어 과도기 dual-accept를 두지 않고 통째 방식을 즉시 제거. 덕분에 `coach_sessions.summary_id`를 NOT NULL로 강화하고 user_id 파생 사슬이 항상 성립 |
| 인증 | `API_KEYS` 환경 변수 방식 제거, `api_keys` 테이블 조회(SHA-256 해시 lookup)로 전환. 키 발급·폐기·목록은 CLI 스크립트. 키별 `rate_limit_per_min`이 전역 `RATE_LIMIT_PER_MIN`을 대체 (카운터는 인메모리 유지) |
| DB 연결 | `DATABASE_URL` 필수 — 미설정 시 부팅 실패(fail-fast). 개발은 로컬 PostgreSQL, 추후 AWS 이전 |
| 저장 시점 규칙 | `summaries`/`anomalies`는 `/summarize` 시점에 한 번 INSERT하고 끝. 코치·리포트 단계의 (필드가 탈락한) 객체로 UPDATE/UPSERT하면 참값이 기본값으로 덮임. 분석 결과는 불변 데이터로 취급 ([db-schema.md의 저장 시점 규칙](db-schema.md#저장-시점-규칙) 참고) |
| 근본 원인 | 사본 스키마 불일치 자체는 남음. 이번 브랜치에서는 사본 3벌을 유지하고, acting-api의 Postgres store가 DB의 `raw` JSONB를 각 서비스 사본 모델로 파싱해 주입한다(필드 탈락은 DB에 원본이 있어 무해). `SceneSummary`/`Anomaly` 정의를 공용 모듈 하나로 통일하는 리팩토링이 근본 해결 (별도 이슈로 분리) |
