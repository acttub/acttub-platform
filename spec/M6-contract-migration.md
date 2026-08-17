# M6 — 계약 자산 이관 (SOMA-403 2단계)

하네스가 검증하던 것 중 남길 가치가 있는 것을 Java 테스트로 옮긴 결과다.
**4단계에서 `tools/contract-harness/` 를 지울 근거가 이 문서다.**

옮긴 것은 비교가 아니라 **기대값**이다. 하네스는 "FastAPI 와 Java 의 응답이 같은가" 를 봤지만
파이썬이 사라지면 비교 대상이 없다.

## 0. 한 줄 결론

**하네스를 지워도 된다.** 세 자산 모두 Java 테스트가 대신 지키고, **표에 없는 오류가 새로
들어오면 실패하는 검사기**(`ErrorContractInventoryTest`)가 하네스의 `--check-manifest` 자리를
대신한다. 다만 **하네스를 지울 때 함께 사라지는 테스트가 있다**(§4).

| 자산 | 하네스 | Java |
|---|---|---|
| 오류 계약 (manifest 92 케이스) | `manifest.py:CASES` + `--check-manifest` | 도메인별 IT 8개 + `ErrorContractInventoryTest` |
| 응답 형상 매트릭스 | `inventory.py` + L1 스키마 검증 | `OpenApiSnapshotIT` (springdoc 산출물 전량 스냅샷) |
| 멱등 전이표 | `scenarios/core.py` | `PracticeSessionEndpointIT` (전이 재생·원자 재개·소진 sweep·재분석) |

## 1. 오류 계약 — 무엇이 비어 있었나

Java 는 오류를 `new ApiException(status, "detail")` 리터럴로 만든다. 소스 전수 조사 결과
**지점 74개 · (클래스, status, detail) 조합 57종**이고, **하네스 manifest 가 검증하던 집합과
정확히 일치**했다(교집합 밖은 둘뿐 — `invalid_operation_state` 는 하네스가 도달 불가로 제외했고,
`storage_not_configured` 는 Java 에서 advice 가 만든다).

착수 시점에 manifest 92 케이스를 Java 테스트에 대조하니 **46 이 미커버**였고, 문자열이 겹친
자리 때문에 **실제로는 그보다 많았다**(§발견 1). 미커버의 절반이 커뮤니티다 —
`CommunityEndpointIT` 359줄은 차단 필터·커서·조회수·좋아요 재집계만 보고 오류 응답을 하나도
보지 않았다.

### 신설·보강한 것

| 파일 | 상태 | 덮는 것 |
|---|---|---|
| `feature/community/CommunityErrorContractIT` | 신설 | 커뮤니티 21 케이스 (404·403·400·409 전량) |
| `feature/auth/AccountStatusContractIT` | 신설 | 정지·탈퇴 계정을 막는 403 을 **네 진입 경로 전부**에서 + 계정 충돌 409 |
| `platform/security/RateLimitContractIT` | 신설 | 429 세 자리 (게이트·라우터 주체별·라우터 IP별) |
| `platform/web/ErrorContractInventoryTest` | 신설 | 드리프트 방어선 (§3) |
| `feature/upload/UploadEndpointIT` | 보강 | 415·413(발급)·409 셋·413(확정) |
| `feature/coach/adapter/web/CoachReportEndpointIT` | 보강 | 코치 404·409, 재생 409, 소진 409, **리스 상실 4경로**, 중복 리포트 409, 502, 반박 없는 부정 확정 422 |
| `platform/web/AuthErrorContractIT` | 보강 | 로그인 입구 3갈래, 갱신·로그아웃 401 |
| `platform/web/ValidationErrorContractIT` | 보강 | 실물 엔드포인트의 `value must not be blank` 422 |
| `feature/report/adapter/web/ReportNoStorageIT` | 보강 | 503 을 **세 경로 전부**(리포트 상세·업로드 발급·연습 상세) |

**결정적으로 만드는 방법이 하네스와 다르다.** 하네스는 LLM 스텁 게이트로 요청을 멈춰 세워
중간 상태를 만들었지만, Java 테스트는 **생성 도중에 끼어드는 훅**(`RecordingGenerator
.duringGeneration`)으로 같은 자리를 밟는다 — 리스를 빼앗거나, 경합 상대의 리포트를 심는다.
관측 대상이 인터리빙이 아니라 "그 상태에서 요청이 어떻게 응답되는가" 라 등가다.

## 2. 이관하지 않은 것

| 항목 | 사유 |
|---|---|
| 트랜잭션 경계 · 요청 지문 · 워커 응답 본문 | **하네스도 못 보던 자리**다(티켓 명시). 스코프를 넓히지 않는다 |
| `ProfileService` 404 `user_not_found` | 인증이 이미 유저를 읽은 뒤라 같은 요청 안에서 유저가 사라져야 도달한다. API 만으로 못 만든다 — 하네스도 같은 사유로 제외 |
| `PracticeSessionService` 409 `invalid_operation_state` | operation 상태 넷이 모두 앞 분기에서 처리되는 방어 코드 — 하네스도 같은 사유로 제외 |
| 백엔드 간 응답 **바이트** 동등성 | 비교 대상이 사라지므로 성립하지 않는다. 형상은 `OpenApiSnapshotIT` 가 스냅샷으로 잡는다 |

## 3. 드리프트 방어선 — `ErrorContractInventoryTest`

하네스의 `--check-manifest` 는 "소스의 모든 오류 지점이 manifest 에 연결되거나 명시적 제외
사유를 달아야 한다" 를 강제했다. **그것이 없으면 새 오류를 테스트 없이 넣어도 아무도 모른다.**

Java 판은 `src/main/java` 를 훑어 `new ApiException` 을 전수로 뽑고
`소유 클래스|status|detail → (횟수, 지키는 테스트 | 제외 사유)` 표와 대조한다.
**`ApiErrorAdvice` 가 예외를 거치지 않고 응답을 직접 만드는 `return body(…)` 셋도 함께 센다** —
빼면 503 `storage_not_configured` 가 검사 밖에 남는다(스토리지 없는 기동에서만 드러나는 자리다).

**횟수를 함께 센다.** 한 연산이 던지던 것을 둘이 던지게 되면 뜻이 갈리기 때문이다 — 이관 중에
500 이던 자리가 404 로 바뀐 사고가 둘 있었고 그때 응답 diff 는 0 이었다(SOMA-397 10·12단계).

### 검사기 자신을 반증했다

통과할 수 있는 검사는 통과하지 못하는 경우도 보여야 판정으로 쓸 수 있다. 넷을 주입해 확인했다.

| 주입 | 결과 |
|---|---|
| 새 오류(`451`)를 표 없이 추가 | `everySiteInTheSourceIsInTheTable` 이 잡는다 |
| 헬퍼를 쓰던 자리가 직접 `new` 하게 (지점 1→2) | 같은 검사가 **횟수 불일치**로 잡는다 |
| 표가 가리키는 테스트 클래스를 없는 이름으로 | `everyNamedTestClassExists` 가 `ClassNotFoundException` |
| 실제로 나타나는 소스 형태(주석·멀티라인·동적 인자·문구 속 괄호·텍스트 블록) | `theScannerReadsTheFormsThatActuallyOccur` |

**마지막 것이 스캐너의 실제 결함을 먼저 잡았다** — 텍스트 블록 안의 문구를 오류 지점으로
세고 있었다. `src/main` 에는 SQL 텍스트 블록이 많아, 언젠가 그 안의 문구가 유령 지점이 됐을
자리다.

### 이 검사가 보지 못하는 것 (표에도 적어 두었다)

- **호출이 빠진 것** — `AuthenticatedUser.requireUsable` 처럼 한 자리에서 만든 예외를 여러
  경로가 부를 때, 한 경로가 부르기를 그만두어도 지점 수는 그대로다. 그래서 경로별 단언이
  따로 필요하다
- **헬퍼로 뭉친 것** — `CommunityService.postNotFound()` 는 `new` 가 하나지만 부르는 연산은 일곱
- **422 검증 오류** — 상수가 어노테이션 기본값이나 호출 인자 안에 흩어져 있어 표로 세지 않는다.
  `ValidationErrorContractIT`(형상 + `value must not be blank`) · `CoachReportEndpointIT`
  (`rebuttal_text …`) · `ProfileEndpointIT`(`nickname …`) · `PracticeSessionEndpointIT`
  (`sub_branch …`) 가 대신 지킨다

## 4. 발견

### 발견 1 — **문자열이 겹치면 덮인 것처럼 보인다**

`report already exists` 를 단언하는 테스트가 하나도 없는데도, 문자열 검색으로는 덮인 것으로
나왔다. 더 긴 `report already exists for practice session` 에 부분 매칭되기 때문이다.
**둘은 다른 연산의 다른 계약이다**(전자는 `/v2/reports`·`coach/confirm` 의 저장 경합, 후자는
`coach/start` 의 선행 확인).

→ 커버리지를 문자열 유무로 세면 안 된다. 인벤토리 검사기가 `status|detail` 전체를 키로 쓰는
이유가 이것이다.

### 발견 2 — **하네스를 지우면 함께 사라지는 테스트가 있다** (4·5단계에 직접 영향)

착수 시점에 이 둘만 단언하던 계약이 있었다.

| 테스트 | 언제 사라지나 | 그때 비는 계약 |
|---|---|---|
| `HarnessContractProfileIT` | **4단계** — 하네스 전용 `contract` 프로파일을 띄운다 | `invalid_provider_token` · `provider_not_configured` |
| `FastApiInteropIT` | **5단계** — 실행 중인 FastAPI 를 요구한다 | `invalid_refresh_token` |

→ 셋 다 `AuthErrorContractIT` 로 옮겨 두었다. **외부 호출 없이** 만든다 — `development`
프로바이더가 빈 토큰을 거절하고, client id 를 비운 `google` 은 디코더를 만들기도 전에 설정
오류를 낸다.

⚠ **4·5단계에서 저 두 파일을 지울 때 다른 계약이 함께 사라지지 않는지 다시 센다.** 이 문서는
2단계 시점의 실측이다.

### 발견 3 — 리스를 잃으면 **실패 기록도 남지 않는다**

`SyncOperationService.fail` 이 `LeaseOwnershipException` 을 조용히 삼킨다(파이썬
`fail_sync_operation` 이 그랬다). 그래서 원장의 `error_code` 로는 이 경로를 알 수 없다.

409 `request is still processing` 은 **세 경로**에서 난다 — 리스 상실 · 재시도 소진 · 처리 중
재생. 응답만 보면 초록으로 끝나는 길이 셋이라, 리스 상실 테스트는 **LLM 호출이 실제로
일어났고**(다른 둘은 생성 전에 거절된다) **원장이 손대지 못한 채 running 으로 남았다**는 것을
함께 단언한다.

### 발견 4 — `/v2/reports` 는 확정되지 않은 handoff 로 LLM 을 부르지 않는다

`ReportEngine.buildReportInput` 이 `confirmed` 가 아니면 `null` 을 내고 차단 노트가 그대로
200 으로 나간다. **생성 경로를 밟는 줄 알았던 테스트가 조용히 다른 길로 간다** — 실제로 처음
작성한 리스 상실·502 테스트가 이것 때문에 200 을 받았다. `handoff_confirmations` 를 함께 심어야
한다.

### 발견 5 — **detail 이 없는 케이스를 세지 않으면 검증 계약이 샌다**

manifest 92 케이스 중 8 건은 detail 이 고정 문자열이 아니다(422 검증 오류 배열과 동적 502).
문자열로 대조할 수 없어 따로 세어야 하는데, **그중 둘이 실제로 비어 있었다** —
`rebuttal_text is required when confirmed is false` 와 `value must not be blank` 는 Java
테스트 어디에도 없었다. 나머지 여섯은 이미 덮여 있었다.

같은 부류로, 인벤토리를 `new ApiException` 으로만 좁히면 `ApiErrorAdvice` 가 직접 만드는
503 이 표 밖에 남는다. **"어디서 만들어지는가" 는 "무엇이 지키는가" 의 답이 아니다.**

→ 둘 다 이번에 메웠고, 인벤토리는 `return body(…)` 까지 세도록 넓혔다. 표로 셀 수 없는 422 는
**검사기 문서에 무엇이 지키는지 이름으로 적어 두었다.**

## 5. 4단계로 넘기는 것

- `tools/contract-harness/` 삭제 · CI 잡 `contract-harness`·`contract-harness-java` 제거
- **ruleset 의 required status check 를 잡 목록과 맞춘다** — 순서를 틀리면 영원히 pending 인
  관문이 생긴다
- `HarnessContractProfileIT` 와 `contract` 프로파일 관련 코드의 처리 판단 (§발견 2)
