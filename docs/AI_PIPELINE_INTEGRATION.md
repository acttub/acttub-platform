# AI 파이프라인 통합 결정

> 상태: 구현 전 승인 완료
> 결정일: 2026-07-11
> 적용 범위: `acttub-platform`, `acttub-ai-summary`, `acttub-ai-agent`, `acttub-ai-report`

## 1. 목표

Acttub의 연습 세션을 다음 세 단계로 연결한다.

```text
영상과 장면 맥락 입력
  -> acttub-ai-summary 영상 분석
  -> acttub-ai-agent 질문 인터뷰
  -> acttub-ai-report 근거 기반 연기 코칭 리포트
```

최종 리포트는 의료적 진단, 절대 평가, 점수, 등급 또는 성공/실패 판정이 아니다. 영상에서 관찰한 사실과 사용자가 인터뷰에서 직접 말한 내용을 구분해 보여 주는 연기 코칭 리포트다.

## 2. 사용자 경험 결정

- AI Summary 원문 JSON과 전체 anomaly 목록은 사용자에게 직접 노출하지 않는다.
- AI Agent의 첫 인터뷰에서 핵심 영상 구간과 관찰을 쉬운 말로 제시하고 사용자가 확인, 수정 또는 부정할 수 있게 한다.
- 플랫폼은 우선순위가 높은 관찰 후보를 최대 3개까지만 순차 확인하며, 처음 확인된 관찰 하나를 해당 인터뷰의 주 근거로 삼는다.
- 사용자가 부정한 관찰은 후속 질문과 최종 리포트의 사실 근거에서 제외한다.
- 사용자가 핵심 관찰을 부정하거나 `모르겠음`으로 표시하면 해당 관찰을 차단하고 다음 우선순위 관찰을 확인한다.
- 사용자가 관찰을 수정하면 원 AI 관찰은 `rejected + blocked`로 처리하고, 같은 영상 구간에 대한 사용자 교정문을 `actor_correction`으로 별도 저장한다.
- 교정문은 Agent와 Report에서 사용자가 설명한 맥락으로만 사용하며 영상에서 확인된 사실처럼 표현하지 않는다.
- 확인 가능한 관찰이 모두 차단되면 근거를 만들어내지 않고 `insufficient_confirmed_evidence`로 종료하며 Report를 생성하지 않는다.
- AI Agent가 인터뷰 종료를 반환하고 `reportReady` 검증을 통과하면 AI Report 생성을 자동으로 시작한다. 검증을 통과하지 못한 비수동 종료는 명시적 근거 부족 이유와 함께 `completed_without_report`로 끝낸다.
- 정상 인터뷰는 `substantiveAnswerCount` 5~10회를 기준으로 하며, Agent는 정상 완료를 5회 전에 반환하지 않는다. 반복해서 대화가 막히거나 사용자가 중단한 경우만 예외로 안전 종료할 수 있다.
- `substantiveAnswerCount`는 Agent의 인터뷰 질문에 대한 비어 있지 않은 사용자 답변만 센다. `모르겠음` 답변은 대화 상한에는 포함하지만 Report 근거로 자동 채택하지 않으며, 관찰 확인 버튼, 빈 문자열, 선택 메모는 세지 않는다.
- 사용자가 인터뷰 중단을 요청하면 Agent가 현재 context의 리포트 충분성을 판단하고, 플랫폼은 확인된 영상 근거와 실제 사용자 답변이 존재하는지 추가 검증한다.
- `reportReady=true`가 되려면 확인된 관찰 ID가 하나 이상이고, Agent가 Report 근거로 선택한 비어 있지 않은 사용자 답변 turn ID가 하나 이상이며, 핵심 세 항목인 한 줄 요약, 다시 볼 지점, 근거를 추정 없이 작성할 수 있어야 한다. 플랫폼은 참조 ID가 현재 세션에 존재하고 차단되지 않았는지 검증한다.
- 중단 시 `reportReady` 검증을 통과하면 `manual_stop_report_ready`로 인터뷰를 완료하고 Report를 자동 생성한다. 통과하지 못하면 세션을 `paused`로 저장해 나중에 이어갈 수 있게 한다.
- `substantiveAnswerCount=10`이면 인터뷰를 종료한다. 이때 `reportReady`이면 Report를 생성하고, 아니면 `insufficient_interview_evidence`로 `completed_without_report` 처리해 무한 질문이나 근거 없는 Report 생성을 막는다.
- 리포트 생성 실패 시에만 재시도 동작을 제공한다.
- 성공한 리포트는 해당 세션의 불변 결과로 유지하며 재생성하지 않는다. 새 분석이 필요하면 새 세션을 시작한다.
- `내 문장 남기기`는 세션 완료나 리포트 생성을 막지 않는 선택 메모다.
- 이전 리포트를 현재 리포트 생성 입력으로 사용하지 않으며 세션 간 비교를 제공하지 않는다.
- 각 리포트는 해당 세션의 기록 화면에서 개별 조회할 수 있다.
- 리포트의 영상 구간을 누르면 private 원본 영상 플레이어가 해당 시작 시점으로 이동하고 종료 시점을 표시한다. 별도 clip 파일은 만들거나 저장하지 않는다.
- 여섯 항목은 고정된 화면 구조를 유지하되 근거가 없는 항목은 추측해서 채우지 않고 `이번 대화에서 확인되지 않았어요`처럼 미확인임을 표시한다. 핵심 세 항목을 작성할 근거가 없으면 리포트를 만들지 않는다.
- 사용자 노출 문장은 존댓말을 사용한다.

최종 리포트 화면은 다음 여섯 항목을 표시한다.

1. 한 줄 요약
2. 가장 크게 다시 볼 지점과 영상 구간
3. 영상과 인터뷰에서 확인한 근거
4. 사용자가 대화에서 발견한 내용
5. 관찰 근거가 있는 격려
6. 다음 연습에서 시도할 한 가지

## 3. 시스템 경계

- 브라우저는 Python AI 서비스에 직접 연결하지 않고 플랫폼의 `/api/v1/*` 계약만 호출한다.
- 플랫폼 Supabase를 사용자, 세션, 영상, Summary, 인터뷰 대화, 실행 상태, 선택 메모 및 Report의 단일 데이터 정본으로 사용한다.
- Python AI 서비스는 플랫폼 Supabase에 직접 접속하지 않는 stateless 연산 서비스로 만든다.
- 플랫폼 서버가 AI 내부 DTO와 플랫폼 공개 DTO 사이의 adapter를 소유한다.
- AI 서비스의 프로세스 메모리나 `reports.json`을 제품 영속성으로 사용하지 않는다. 기존 standalone/Gradio 데모 저장 기능은 통합 경로의 정본이 아니다.
- 장기적으로 Spring Boot가 같은 `/api/v1/*` 경로와 공개 DTO를 인수할 수 있어야 한다.

## 4. 영상 전달

- 영상은 기존 private Supabase Storage bucket에 보관한다.
- 플랫폼 서버만 짧은 유효기간의 signed URL을 생성해 AI Summary에 서버 간 전달한다.
- AI Summary는 허용된 Supabase 호스트와 예상 storage path만 다운로드할 수 있어야 한다.
- AI Summary는 영상을 임시파일로 내려받아 Gemini에 전달한 뒤 성공과 실패 경로 모두에서 임시파일을 삭제한다.
- signed URL, 서비스 키 및 영상 내용은 DB, 일반 로그, 오류 응답 또는 Git에 기록하지 않는다.
- MVP 영상 길이는 `durationMs <= 300_000`을 하드 제한으로 두며 정확히 5분인 영상은 허용한다. 브라우저의 media metadata 검사는 빠른 안내용이고, 업로드 finalize 단계의 서버 측 media metadata 판정을 정본으로 삼는다. duration을 읽을 수 없거나 제한을 넘긴 영상은 Gemini 분석 요청 전에 거절한다.

## 5. AI 서비스 계약

### Summary

- 입력: signed video URL, 장르, 상황, 인물 설정, 선택 서브텍스트, session/run correlation ID
- 출력: versioned normalized `SceneSummary`
- 플랫폼의 선택 서브텍스트 계약을 보존한다. 서브텍스트가 없으면 Summary는 관찰 가능한 사실만 분석하고 의도를 추정하지 않으며, 의도 관련 필드는 미제공 상태임을 명시한다.
- Agent는 인터뷰 초반에 인물의 의도와 숨은 생각을 질문해 부족한 맥락을 보완한다.

### Agent

- 입력: normalized Summary, 확인된 관찰 상태, 전체 현재 세션 대화, `substantiveAnswerCount`, 사용자 답변
- 출력: 사용자에게 보여 줄 발화 하나, 근거 구간, 종료 여부와 종료 이유, 중단 요청 시 `reportReady`와 이를 뒷받침하는 관찰 ID 및 사용자 답변 turn ID
- Agent가 자체 DB나 복구 불가능한 메모리 세션에 의존하지 않도록 매 요청에 필요한 정본 context를 전달한다.

### Report

- 입력: 현재 세션의 normalized Summary, 확인된 관찰, 완료된 인터뷰 전체 대화와 종료 이유
- 출력: 현재 세션만을 위한 versioned structured Report
- 여섯 항목은 각각 `status: confirmed | not_confirmed`, nullable content와 observation/turn evidence reference를 가진다. 핵심 세 항목은 모두 `confirmed`여야 하며, UI는 `not_confirmed` 항목의 nullable content 대신 공통 미확인 문구를 표시한다.
- 이전 세션이나 이전 리포트를 입력에 포함하지 않는다.

세 단계의 schema drift와 필드 유실을 막는 contract test를 각 소비자 경계에 둔다.

## 6. 실행 상태와 재시도

Supabase에 적어도 다음 실행 상태를 저장한다.

```text
pending -> running -> completed
                   -> failed
```

인터뷰 상태는 `active`, `paused`, `completed`, `completed_without_report`를 구분한다.

- Summary와 Report처럼 외부 호출이 필요한 단계는 run ID, stage, 상태, retry count, 안전한 error code, 모델명, schema/prompt version, 시작/종료 시각을 가진다.
- 동일한 사용자 요청이나 새로고침으로 Gemini 호출과 DB row가 중복 생성되지 않게 idempotency를 보장한다.
- 플랫폼은 transient 외부 오류를 단계별 제한 횟수 안에서 자동 재시도할 수 있지만 완료된 이전 단계는 다시 실행하지 않는다.
- 사용자에게 보이는 수동 재시도 버튼은 실패한 Report에만 제공한다. 재시도는 완료된 Summary와 transcript를 그대로 사용하고, 이미 completed Report가 있으면 새로 생성하지 않고 기존 결과를 반환한다.
- 실패를 mock 성공이나 임시 결과로 바꾸지 않는다.
- 새 AI 파이프라인은 배포 후 생성하는 새 세션부터 적용한다. 기존 세션의 내용 수정, Summary/인터뷰/Report 자동 backfill과 재분석은 금지하되 사용자의 숨기기와 영구 삭제는 허용한다.

## 7. 저장 및 비저장 데이터

### 동의 정책

- 서비스 제공과 외부 AI 처리는 목적을 명시한 필수 동의로 받는다.
- Acttub 내부 사람의 영상, 대화 또는 리포트 검토는 별도 선택 동의로 분리하고 기본값을 OFF로 둔다.
- 업로드 영상과 세션 데이터는 Acttub의 모델 개선이나 학습 용도로 사용하지 않는다.
- 약관 버전을 갱신하고 기존 사용자도 변경된 목적에 다시 동의하도록 한다.
- 알파는 성인 사용자만 허용한다. 미성년자는 보호자 동의와 처리 정책을 별도로 확정하기 전까지 제외한다.
- 분석 대상 배우는 한 명으로 지정한다. 다른 사람이 보이거나 들리는 영상은 업로더가 모든 등장자의 촬영 및 외부 AI 분석 동의를 확인한 경우에만 허용한다.

동의 증거는 서버가 세션 생성과 AI 실행 전에 검증할 수 있게 저장한다.

- 프로필: 최신 약관/AI 처리 동의 version과 동의 시각, 선택 내부 검토 동의 여부와 동의 시각
- 세션: 성인 자격 확인 시각, 모든 등장자 동의 확인 시각, 세션 생성 시점의 AI 처리 동의 version snapshot
- 최신 필수 동의나 세션 확인값이 없으면 업로드 finalize, signed URL 발급 및 AI 실행을 거절한다.

Supabase에 저장한다.

- normalized SceneSummary
- 확인 상태가 포함된 관찰
- 전체 인터뷰 대화와 종료 이유
- structured Report
- 선택 사용자 메모
- AI run 상태와 모델/schema/prompt version 등 안전한 실행 메타데이터

저장하지 않는다.

- Gemini의 미검증 raw response
- signed URL
- AI 서비스 임시파일
- API key 또는 서비스 자격 증명
- 이전 리포트 비교용 prompt context

### 보존 및 영구 삭제

- 영상, Summary, 인터뷰, Report와 안전한 AI 실행 메타데이터는 사용자가 해당 세션을 보유하는 동안 보관한다.
- 기록 숨기기와 별도로 영구 삭제를 제공한다.
- 영구 삭제 요청은 세션을 먼저 `deleting`으로 잠가 조회와 변경을 차단한 뒤 private Storage 원본과 해당 세션에 종속된 Summary, 관찰, 대화, Report, 선택 메모 및 AI run을 멱등하게 삭제한다.
- 중간 실패는 `delete_failed`로 기록해 같은 요청 ID로 재시도하고 정기 reconciliation으로 Storage/DB orphan을 찾는다. 삭제 완료는 Storage object 부재와 모든 종속 row 부재가 모두 확인된 때만 선언한다.

## 8. E2E 검증 결정

- 실제 사용 권한이 있는 MP4 영상을 로컬 fixture로 사용하되 절대경로와 파일 자체는 Git에 기록하지 않는다.
- 로컬 영상 경로는 ignore된 환경변수나 테스트 실행 인자로만 전달한다.
- 예시 장면 맥락은 다음과 같다.
  - 장르: `연극`
  - 상황: `시각장애인이 사랑하는 마음을 숨기는 상황`
  - 인물 설정: `시각장애가 있는 인물이 오래 사랑해 온 상대와 단둘이 있다. 지금의 관계를 잃을까 두려워 자신의 마음을 숨기려 한다.`
  - 서브텍스트: `좋아한다고 말하고 싶지만 지금의 관계도 잃고 싶지 않다.`
- 현재 개발용 Supabase와 기존 로그인 사용자를 주 E2E 계정으로 사용한다.
- 주 E2E 계정은 최신 필수 동의, 성인 자격 및 모든 등장자 동의 확인을 완료한 뒤 AI 호출을 시작한다.
- RLS 검증을 위해 임시 두 번째 Auth 사용자를 만들고 검증 후 삭제한다.
- 자동 E2E에서는 장면 맥락에 맞는 테스트 답변을 입력해 인터뷰 종료와 Report 생성까지 진행한다.
- 실제 Gemini 호출을 최소 한 번 수행하며 mock 또는 하드코딩 결과만으로 완료 처리하지 않는다.
- 사용자가 직접 확인할 성공 세션 하나만 남기고 실패하거나 중간에 생성된 세션과 임시 두 번째 Auth 사용자는 검증 후 삭제한다.

완료 증거에는 다음이 포함되어야 한다.

- Summary가 Agent 근거로 사용되고 종료된 session transcript가 Report 입력으로 전달된 사실
- 여섯 Report 항목의 `confirmed/not_confirmed` UI, timestamp seek와 새로고침 후 동일 결과 유지
- 관찰 후보 전부 차단 시 no-report, 수동 중단의 Report/paused 양쪽, 5회와 10회 경계
- 성공 Report 불변성과 실패 Report 재시도
- 300초 허용 및 초과/metadata 판독 실패 거절
- 최신 동의와 성인/등장자 확인 없이는 AI 호출이 차단되는 사실
- legacy session no-backfill과 삭제 허용
- 영구 삭제 후 Storage object, session 종속 row 및 AI run orphan이 없는 사실
- 교차 사용자 접근 차단

## 9. 브랜치와 작업 보존

- 플랫폼 사전 작업 checkpoint: `908aa5e`
- 플랫폼 통합 브랜치: `feature/ai-pipeline-integration-20260711`
- AI 저장소 공통 통합 브랜치: `feature/platform-ai-pipeline-20260711`
- 기존 작업을 reset, stash, clean 또는 무단 덮어쓰기 하지 않는다.

## 10. 이번 범위에서 제외

- production 배포
- production DB migration 적용
- 이전 리포트와의 비교
- 성장 리포트 및 세션 간 변화 분석
- 점수, 등급, 순위 및 절대 판정
- 미성년 사용자 지원과 보호자 동의 흐름
- 여러 배우를 동시에 분석하는 세션
- 성공한 리포트 재생성 및 기존 세션 AI backfill
- 사후 1~7점 설문의 신규 화면 또는 AI 파이프라인 연결 변경. 기존 검증 데이터 계약은 유지한다.
- Spring Boot 정식 백엔드 구현

사용자가 로컬/개발 환경 결과를 직접 확인한 뒤 별도 결정으로 production 배포를 진행한다.
