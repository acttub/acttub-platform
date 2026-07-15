# DB 도입 후 API 변경 명세 — 값 전달에서 ID 참조로

> **상태: 제안.** 현재 배포된 API 스펙은 [API.md](../API.md), DB 스키마는 [db-schema.md](db-schema.md), 논의는 [#1](https://github.com/acttub/acting-api-deploy/issues/1) 참고. 구현이 진행되면 이 문서를 갱신하고, 확정된 내용은 API.md로 옮긴다.

지금은 클라이언트가 `SceneSummary`와 대화 전체를 매 단계 통째로 다시 업로드하는 구조다. DB가 생기면 서버가 기억하므로, 클라이언트는 ID만 넘기면 된다.

## 요청 형태 변화

| 엔드포인트 | 현재 요청 | DB 도입 후 |
|---|---|---|
| `POST /summarize` | 변화 없음 | 응답에 `summary_id` 필드 추가, 결과를 DB에 저장 |
| `POST /coach/start` | `summary` 통째 + `subtext` | `{"summary_id": "..."}` — 서버가 DB에서 로드 (subtext도 `scenes`에 있음) |
| `POST /coach/reply` | `{"session_id", "text"}` | 변화 없음 |
| `POST /report` | `user_id` + `session` 통째 (summary·turns 포함) | `{"session_id": "..."}` — 대화·요약 모두 DB에서 로드 |

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
| 하위 호환 | ID 참조 전환은 하위 호환이 깨지는 변경. 기존 클라이언트가 있다면 과도기 동안 `summary_id`와 `summary` 통째 방식을 둘 다 허용하고, 이후 통째 방식을 제거 |
| 저장 시점 규칙 | `summaries`/`anomalies`는 `/summarize` 시점에 한 번 INSERT하고 끝. 코치·리포트 단계의 (필드가 탈락한) 객체로 UPDATE/UPSERT하면 참값이 기본값으로 덮임. 분석 결과는 불변 데이터로 취급 ([db-schema.md의 저장 시점 규칙](db-schema.md#저장-시점-규칙) 참고) |
| 근본 원인 | 사본 스키마 불일치 자체는 남음. `SceneSummary`/`Anomaly` 정의를 공용 모듈 하나로 통일하는 리팩토링이 근본 해결 (별도 이슈로 분리 권장) |
