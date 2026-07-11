# 보호형 AI 파이프라인 E2E 실행서

이 문서는 승인된 Summary → Agent → Report 통합을 개발 환경에서 검증하기 위한 보호 하네스의 실행 경계를 정의한다. 이 하네스는 production 배포·migration·조회·변경을 수행하지 않는다.

## 라이브 게이트

아래 조건이 모두 독립 검증되기 전에는 Supabase, Gemini, 브라우저 또는 외부 서비스 작업을 시작하지 않는다.

1. 네 feature branch가 clean이고 upstream과 일치하며 hash manifest와 같다.
2. migration 004·009·010, case ledger, sanitizer, 하네스 트리, Task105·Task6 증거 digest가 고정되어 있다.
3. 오프라인 하네스 테스트와 canary/forbidden scan이 통과한다.
4. private run state가 저장소 밖에 0700으로 생성되고 모든 파일은 0600·단일 link·exclusive lock을 만족한다.
5. development target HMAC이 private input, Supabase metadata, MCP inventory에서 일치하고 production action count가 0이다.
6. architect와 독립 verifier가 하네스의 exact hash를 승인한다.

게이트가 실패하거나 결과가 불명확하면 상태를 차단 또는 `UNKNOWN`으로 남기고 read-only reconciliation만 수행한다. 같은 mutation permit을 재사용하거나 자동 rollback하지 않는다.

## 비밀 및 입력 경계

- 실제 media, 플랫폼 설정, Summary/Agent/Report 설정은 고정 별칭의 이미 열린 FD로만 전달한다.
- secret, token, signed URL, media와 그 경로를 파일·argv·환경변수·로그·Git에 기록하지 않는다.
- private state에도 settings, provider key, token, signed URL, media를 저장하지 않는다.
- 재시작 검증에 사용하는 32-byte 내부 run MAC key만 owner-only `0600` private state에 생성·fsync하며 값과 경로는 외부 receipt나 로그에 노출하지 않는다.
- crash cleanup에 필요한 resource locator만 보호된 cleanup vault에 두며 evidence에는 HMAC만 남긴다.
- child 환경은 빈 map에서 allowlist로 만들고 proxy, `PYTHONPATH`, `NODE_OPTIONS`, 인증·AI·Supabase 변수를 상속하지 않는다.
- 설정 FD가 연결되는 고정 stdin 외에는 child 입력을 허용하지 않고, stdout/stderr와 access log는 폐기한다.

## 오프라인 검증

```bash
pnpm test:ai-pipeline-e2e-harness
pnpm preflight:ai-pipeline-e2e-harness
```

이 명령은 네트워크, DB, provider, 인증, Storage, browser 또는 migration 적용을 수행하지 않는다.

## 실행 순서

1. 저장소 밖 private run state를 만들고 exclusive lock을 유지한다.
2. canary와 forbidden scan을 실행한다.
3. 네 저장소와 모든 artifact pin을 재검증한다.
4. Supabase MCP의 development-negative attestation과 migration preflight `001..008`을 확인한다.
5. target·payload·state에 결합된 일회성 permit을 호출 전에 소비하고 migration 009를 적용·attest한다.
6. 같은 규칙으로 migration 010을 적용·attest한 뒤 ledger `001..010`을 확인한다.
7. provider credential이 구조적으로 없는 scripted 서비스를 실행해 guard, boundary, retry, RLS, deletion case를 검증하고 모든 scripted resource를 삭제한다.
8. scripted process를 완전히 종료한 뒤 explicit `Settings + create_app` real 서비스를 별도 process/port로 실행한다.
9. 실제 media와 Gemini로 성공 세션 하나를 만들고 lineage, replay, UI를 검증한다.
10. UI adapter는 boolean, count, HMAC만 반환하며 screenshot, HAR, trace, console, DOM/accessibility snapshot을 저장하지 않는다.
11. cleanup WAL과 vault로 transient session, 임시 Auth 사용자, Storage/DB/AI run orphan을 정리한다. 실제 성공 세션의 `retained` 완료는 child가 아니라 검증된 real receipt, UI attestation, controller state 지속화가 모두 끝난 뒤 parent coordinator만 확정한다.
12. exact 25-case evidence chain의 순서·count·tail과 manifest digest를 receipt에 봉인한다.

## Migration 복구

- 009/010 각각 `prepared → in-flight → attested` 상태를 가진다.
- timeout, 응답 유실 또는 process 종료는 성공/실패로 추정하지 않고 `UNKNOWN`으로 기록한다.
- `UNKNOWN`에서는 read-only ledger/postcondition 검사만 허용한다.
- effect가 확인되면 다음 단계로 진행하고, 부재가 확인되면 새 permit으로 해당 migration만 재개한다.
- 009 적용 후 010이 불명확하면 009를 되돌리지 않고 010만 reconciliation한다.

## 완료 receipt

완료 조건은 real retained 1, scripted retained 0, transient/auth/orphan/production action/visual artifact 0, 실제 provider와 media 관찰 true이다. 원문 응답, 식별자, 경로 또는 사용자 콘텐츠는 receipt와 최종 보고에 포함하지 않는다.
