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
- 사용자가 부정한 관찰은 후속 질문과 최종 리포트의 사실 근거에서 제외한다.
- AI Agent가 인터뷰 종료를 반환하면 AI Report 생성을 자동으로 시작한다.
- 리포트 생성 실패 시에만 재시도 동작을 제공한다.
- `내 문장 남기기`는 세션 완료나 리포트 생성을 막지 않는 선택 메모다.
- 이전 리포트를 현재 리포트 생성 입력으로 사용하지 않으며 세션 간 비교를 제공하지 않는다.
- 각 리포트는 해당 세션의 기록 화면에서 개별 조회할 수 있다.

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

## 5. AI 서비스 계약

### Summary

- 입력: signed video URL, 장르, 상황, 인물 설정, 선택 서브텍스트, session/run correlation ID
- 출력: versioned normalized `SceneSummary`
- 플랫폼의 선택 서브텍스트 계약을 보존한다. 값이 없을 때의 의미를 adapter와 AI schema에서 명시한다.

### Agent

- 입력: normalized Summary, 확인된 관찰 상태, 전체 현재 세션 대화, 질문 수, 사용자 답변
- 출력: 사용자에게 보여 줄 발화 하나, 근거 구간, 종료 여부와 종료 이유
- Agent가 자체 DB나 복구 불가능한 메모리 세션에 의존하지 않도록 매 요청에 필요한 정본 context를 전달한다.

### Report

- 입력: 현재 세션의 normalized Summary, 확인된 관찰, 완료된 인터뷰 전체 대화와 종료 이유
- 출력: 현재 세션만을 위한 versioned structured Report
- 이전 세션이나 이전 리포트를 입력에 포함하지 않는다.

세 단계의 schema drift와 필드 유실을 막는 contract test를 각 소비자 경계에 둔다.

## 6. 실행 상태와 재시도

Supabase에 적어도 다음 실행 상태를 저장한다.

```text
pending -> running -> completed
                   -> failed
```

- Summary와 Report처럼 외부 호출이 필요한 단계는 run ID, stage, 상태, retry count, 안전한 error code, 모델명, schema/prompt version, 시작/종료 시각을 가진다.
- 동일한 사용자 요청이나 새로고침으로 Gemini 호출과 DB row가 중복 생성되지 않게 idempotency를 보장한다.
- 새로고침 후 마지막 완료 단계에서 복구하고 실패한 단계만 재시도한다.
- 실패를 mock 성공이나 임시 결과로 바꾸지 않는다.

## 7. 저장 및 비저장 데이터

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

## 8. E2E 검증 결정

- 실제 사용 권한이 있는 MP4 영상을 로컬 fixture로 사용하되 절대경로와 파일 자체는 Git에 기록하지 않는다.
- 로컬 영상 경로는 ignore된 환경변수나 테스트 실행 인자로만 전달한다.
- 예시 장면 맥락은 다음과 같다.
  - 장르: `연극`
  - 상황: `시각장애인이 사랑하는 마음을 숨기는 상황`
  - 인물 설정: `시각장애가 있는 인물이 오래 사랑해 온 상대와 단둘이 있다. 지금의 관계를 잃을까 두려워 자신의 마음을 숨기려 한다.`
  - 서브텍스트: `좋아한다고 말하고 싶지만 지금의 관계도 잃고 싶지 않다.`
- 현재 개발용 Supabase와 기존 로그인 사용자를 주 E2E 계정으로 사용한다.
- RLS 검증을 위해 임시 두 번째 Auth 사용자를 만들고 검증 후 삭제한다.
- 자동 E2E에서는 장면 맥락에 맞는 테스트 답변을 입력해 인터뷰 종료와 Report 생성까지 진행한다.
- 실제 Gemini 호출을 최소 한 번 수행하며 mock 또는 하드코딩 결과만으로 완료 처리하지 않는다.

완료 증거에는 Summary가 Agent 근거로 사용된 사실, 종료된 세션이 Report 입력으로 전달된 사실, 여섯 리포트 항목의 UI 표시, 새로고침 후 유지, 실패 재시도 및 교차 사용자 접근 차단이 포함되어야 한다.

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
- Spring Boot 정식 백엔드 구현

사용자가 로컬/개발 환경 결과를 직접 확인한 뒤 별도 결정으로 production 배포를 진행한다.
