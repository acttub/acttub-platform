# M6 findings — 파이썬 삭제와 `api-java` → `api` 이사 (SOMA-403 5단계)

- 일시: 2026-08-18
- 브랜치: `chore/SOMA-403-java-only-cleanup`
- 검증: `./gradlew build test`(apps/api) · `pnpm lint · build · typecheck · --filter web test`

## 0. 한 줄 결론

**파이썬이 사라졌고 `apps/api-java` 가 `apps/api` 가 됐다.** 티켓이 적은 것은 "디렉토리 삭제 ·
rename · 죽은 스크립트 · CI 잡" 넷이었지만, **실제로 손대야 했던 것은 파이썬 트리가 자바 빌드
· 자바 테스트 · 배포 게이트 · 웹 빌드 · 웹 테스트에 물려 있던 자리 다섯**이었다. 그중 셋은
지웠으면 **빌드가 통과한 채 기능만 죽었을** 자리다.

## 1. 무엇을 지웠고 무엇이 남았나

| | 수 |
|---|---|
| 삭제된 추적 파일 | 163 (그중 `.py` 123) |
| `apps/api-java` → `apps/api` rename | 441 |
| 지운 파이썬 트리 | `apps/api` 161 파일 · 133M(.venv 포함) |
| 자바 테스트 | 클래스 85 · 388 테스트 · 실패 0 · skip 5 |

skip 5 는 실 Gemini 키를 요구하는 M0 스파이크(`ProductionEnvelopeSpikeTest` 4 ·
`GeminiSdkSpikeTest` 1)로, 이번 변경과 무관한 기존 상태다.

판정 기준 `find apps/api -name "*.py" | wc -l` → **0**. 저장소에 남은 `.py` 는
`apps/mobile/scripts/` 둘뿐이고 정상 도구다.

## 2. 발견 — 파이썬 트리가 물고 있던 자리 다섯

**티켓에도 `spec/M6-cleanup.md` 에도 없었다.** 다섯 중 셋(1·2·5)은 지워도 **빌드가 초록으로
끝난다** — 드러나는 것은 기동 뒤거나 배포 뒤다.

### ① 자바 빌드가 파이썬 트리에서 리소스를 복사하고 있었다 🔥

`build.gradle.kts` 의 `processResources` 가 `../api/acting-api/consent_docs`(동의 문서 6 +
manifest)와 `../api/acting-api/admissions/notices.json`(961K)을 jar 에 복사해 넣었다.

**그냥 지우면 jar 에 동의 문서가 빠진 채 빌드가 통과한다.** 기동은
`ConsentDocumentPublisher` 가 경고 한 줄(`manifest is missing`)만 남기고 넘어가고 — 그
클래스는 **어떤 실패도 기동을 막지 않는다** — 동의 게이트가 조용히 열린다.

→ 자산을 `src/main/resources/{consent-docs,admissions}/` 로 옮겨 정본을 자바로 들였다. 복사
블록은 사라지고 발행 절차 README 둘만 `exclude` 한다.

### ② 배포 워크플로의 방침 게이트가 파이썬 경로를 읽고 있었다

`deploy.yml` 의 `fe` 잡 "계측 키가 방침 고지보다 앞서지 않는지" 스텝이
`apps/api/acting-api/consent_docs/manifest.json` 을 `jq` 로 읽는다. 경로가 사라지면
**프론트 배포가 깨진다** — 백엔드를 지웠는데 프론트가 죽는다.

→ 세 곳을 새 경로로. 새 경로로 게이트를 손으로 돌려 통과를 확인했다(발행 `privacy_v4` ·
웹 기대 `v4` 일치, Amplitude 고지 있음).

### ③ 웹 **빌드**가 파이썬 트리의 `notices.json` 을 읽고 있었다

`apps/web/src/features/admissions/university-ids.ts` 가 `/admissions/[id]` 의 정적 param 을
만들려고 빌드 시점에 원본 JSON 을 직접 읽는다.

🔎 **이 자리는 조용히 죽지 않았다.** 그 파일이 이미 *"읽지 못하면 상세 페이지가 통째로 안
생긴다. 조용히 빈 배열을 주면 목록의 모든 링크가 404 가 되므로 빌드를 세운다"* 로 설계돼
있어서, `pnpm build` 가 `Failed to collect page data for /admissions/[id]` 로 즉시 멈췄다.
**같은 부류 다섯 중 유일하게 스스로 드러난 자리**이고, 그것은 설계가 그렇게 돼 있었기 때문이다.

### ④ 웹 **테스트**가 파이썬 트리의 manifest 를 읽고 있었다

`apps/web/tests/analytics-ga.test.mjs` 의 "기대하는 방침 버전이 발행 매니페스트와 같다".
계측 쿠키를 켜는 조건이 방침 버전이라 이 대조가 곧 개인정보 고지 관문이다.

### ⑤ SPEC 참조 검사기가 검사할 것을 전부 잃었다

`spec/check-refs.py` 는 CI 매 PR 마다 돌았고 **심볼 참조 304 건**을 검사했다 — 정규식이
`.py` 만 잡으므로 **304 건 전부가 파이썬**이다. 파이썬을 지우면 전부 오류가 되어 CI 가 죽는다.

→ **검사기를 은퇴시켰다**(사용자 결정). 4단계가 하네스에 쓴 "폐기 접두어 면제 + 면제 건수
출력" 을 그대로 쓸 수도 있었지만, **304 중 304 가 면제면 "오류 0" 이 아무것도 뜻하지 않는다.**
초록으로 끝나는 길이 둘이면 약한 쪽이 쓰인다. `SPEC.md` §12 에 은퇴와 그 이유를 적었다.

## 3. 지우기 전에 다시 셌다

### 3-1. 파이썬 정본과 대조하던 테스트 14 파일

성격이 둘로 갈렸다(사용자 결정 2026-08-18).

**동결 — 파이썬이 사라지기 직전에 값을 뽑아 `src/test/resources/frozen/` 20 개로 커밋했다.**

| 옛 이름 | 새 이름 | 덮는 것 |
|---|---|---|
| `PromptParityTest` | `ObservationPromptSnapshotTest` | 관찰 시스템 프롬프트 + 세 갈래 출력 |
| `CoachPromptParityTest` | `CoachPromptSnapshotTest` | 시스템 프롬프트 셋 · chat · 재생성 · safe · **마무리 판정** |
| `ReportPromptParityTest` | `ReportPromptSnapshotTest` | 시스템 프롬프트 둘 + 입력 JSON 표기 둘 |
| `TranscriptionPromptParityTest` | `TranscriptionPromptSnapshotTest` | 받아쓰기 시스템 프롬프트 |
| `AdminSchemaParityTest` | `AdminSchemaSnapshotTest` | 관리자 응답 모델 셋의 필드·순서 |
| `JwtServiceTest.tokenIssuedByPythonIsAccepted` | (그대로) | 파이썬이 발급한 실제 토큰 문자열 |

값을 뽑기 전에 **15 테스트가 전부 초록인 것을 먼저 확인했다**(skip 0) — 그래야 동결한 값이
정본과 같다고 말할 수 있다. 뽑은 뒤에는 fixture 20 개가 **서로 다르고 비어 있지 않은지**
확인했다(같은 크기 쌍 둘을 `cmp` 로 갈랐다).

🔎 **왜 커밋해도 되나.** 그전까지 기대값을 커밋하지 않은 이유는 "fixture 와 자바 상수가 둘 다
낡아도 초록" 이었다. **정본이 자바로 넘어온 지금 그 함정은 성립하지 않는다** — 잡으려는 것이
"정본과 어긋났는가" 가 아니라 **"의도 없이 바뀌었는가"** 이기 때문이다. 3단계에서
`SchemaFingerprint` 가 alembic 스냅샷에서 Flyway 기준으로 넘어갈 때 쓴 논리와 같다.

**반증했다** — `ObservationPrompt.SYSTEM` 에서 **마침표 하나를 지우자** 빨간불이 떴다. 주입하기
쉬운 형태(빈 값·파일 삭제)가 아니라 앞으로 실제로 일어날 방식(프롬프트 오타)으로 틀려 봤다.

**삭제 — 대조 자체가 무의미해지는 것.**

- `FastApiInteropIT` · `AlembicSchema` — 실행 중인 FastAPI 가 있어야 성립한다
- 파이썬 `openapi.json` 대조 **8 자리 중 6** — 스냅샷이 이미 덮는다(3-2)

### 3-2. `openapi.json` 대조 8 자리 — 스냅샷 커버리지를 세었다

| 자리 | 판정 |
|---|---|
| `HealthAndBootIT` ×4 (`/health` · 도달 컴포넌트 title/nullable · practice 9 · community 17) | 스냅샷이 덮음 → 삭제 |
| `AdmissionsEndpointIT` ×1 | 스냅샷이 덮음 → 삭제 |
| `ReportEndpointIT` ×2 | 스냅샷이 덮음 → 삭제(422 단언은 남겨 메서드를 개명) |
| `CoachReportEndpointIT` ×1 | 스냅샷이 덮음 → 삭제 |
| `AdminEndpointIT` ×1 | 🔥 **스냅샷 밖** → 대조 상대만 스냅샷으로 바꿔 살렸다 |
| `AuthSerializationContractTest` ×1 | 🔥 **동등성이 아니라 규칙** → 대조 상대만 바꿔 살렸다 |

지운 것은 **@Test 8 개**(HealthAndBootIT 10→6 · Admissions 3→2 · Report 4→3 ·
CoachReport 13→12 · FastApiInterop 1→0).

- **`AdminEndpointIT`** — 관리자 둘은 조건부 빈이라 **토큰 없이 뜨는 기본 컨텍스트의 springdoc
  출력에 나오지 않는다.** 그래서 `OpenApiSnapshotIT` 가 못 본다. 대조 상대를 커밋된 스냅샷으로
  바꾸니 오히려 뜻이 또렷해졌다 — "관리자를 켠 컨텍스트가 스펙에 정확히 두 경로를 더한다".
  `AdminStats`·`AdminFunnelStep`·`AdminCloseReasonCount` 가 스냅샷에 없는 것도 같은 이유이고,
  그래서 `AdminSchemaSnapshotTest` 가 중복이 아니다.
- **`AuthSerializationContractTest`** — 나머지 일곱은 "파이썬과 같은가" 를 묻지만 이것은
  **"auth 요청 셋만 unknown key 를 허용한다" 는 규칙**을 묻는다. 규칙은 파이썬이 사라져도
  성립하므로 대조 상대만 갈았다.

### 3-3. 비어 있던 자리 하나를 찾아 메웠다

`token_type` 의 값 `"bearer"` 를 단언하는 곳이 **`FastApiInteropIT` 하나뿐**이었고, **그마저
FastAPI 의 응답을 본 것**이라 **자바가 무엇을 내는지는 아무도 보지 않고 있었다.** OpenAPI
스냅샷도 못 덮는다 — `token_type` 을 `type: string` 까지만 적고 값을 고정하지 않는다.

→ **`AuthTokenEnvelopeIT`** 신설(테스트 2). 로그인·갱신 성공 응답의 봉투를 못박는다 —
`token_type == "bearer"` · `expires_in == 1800` · 필드 집합. **반증**: `AuthController` 의
`"bearer"` 를 `"Bearer"` 로 바꾸자 둘 다 빨간불.

4단계의 `PostgresAnalysisStoreIT` 와 같은 부류다 — **지우기 전에 다시 세면 비어 있던 자리가
나온다.**

## 4. 사라졌던 스펙 동등성 대조를 마지막으로 실측했다

`spec/M6-harness-retirement.md` §7 이 남긴 숙제다: 하네스는 자바 산출물을 **웹이 타입을
생성하는 파이썬 `openapi.json`** 에 맞댔고, 4단계 이후 아무도 그 대조를 하지 않는다. 파이썬이
사라지기 전이 **마지막 기회**였다.

**결과 — 파이썬 스펙과 자바 springdoc 스냅샷:**

- 경로 **32 / 32 일치** (한쪽에만 있는 것 없음)
- 컴포넌트 **75 / 75 일치** (이름 집합 동일)
- 원본 JSON 그대로는 75 중 39 가 다르다 — `required` 순서·표기 정규화 차이다
- **웹 타입으로 생성해 키 순서를 맞추면 diff 0 줄**

마지막 줄이 판정이다. 실제 소비자는 `apps/web` 의 `v2-schema.d.ts` 이고, 두 스펙이 **같은
타입을 만든다.** 생성원을 바꾼 뒤 실제로 재생성한 결과도 1426 삽입 / 1426 삭제인데
**정렬해서 대조하면 0 줄** — 순서만 바뀌고 내용은 한 글자도 다르지 않았다.

→ 그래서 웹의 타입 생성원을 자바로 옮겼다. 스냅샷을 `src/test/resources/openapi-snapshot.json`
에서 **`apps/api/spec/openapi.json`** 으로 옮겨 **웹 스크립트를 한 글자도 고치지 않았다**
(`openapi-typescript ../api/spec/openapi.json`). 그 경로는 계속 "커밋된 API 계약서" 를 뜻하고,
만드는 쪽만 pydantic 에서 springdoc 으로 바뀌었다.

⚠ **남은 한계.** `OpenApiSnapshotIT` 는 여전히 **자기 스냅샷**과 비교한다 —
`UPDATE_OPENAPI_SNAPSHOT=1` 로 다시 뜨면 무엇을 바꿨든 초록이다. 바깥 정본이 없어졌으므로 이
한계는 이제 **구조적**이고, diff 를 눈으로 보라는 지시가 유일한 방어다.

## 5. 스코프 밖으로 남긴 것

- **systemd 유닛 이름 `acttub-api-java` 는 그대로 두었다.** 디렉토리 rename 과 무관하고,
  돌고 있는 유닛을 개명하려면 disable/enable 이 얽힌 이행이 필요하다. 그래서
  `deploy/upload-api-java.sh` 와 ssm 모드 `be-java` 도 이름을 유지한다 — **`-java` 는 이제
  디렉토리가 아니라 유닛을 따르고**, 스크립트 머리말에 그렇게 적었다.
- 자바 소스의 **출처 서술**(`acting-agent/prompt.py` 같은 것)은 역사 기록이라 두었다. 다만
  **따라 하면 없는 경로로 가는 지시문 넷**은 고쳤다 — `regen-fingerprint.sh` 의 사용법과 안내
  둘 · `FlywayBaselineTest` 의 실패 메시지 · `SchemaFingerprint` javadoc.

## 6. 6단계로 넘기는 것

- 🔥 **ruleset 의 required status check 동기화 — 머지 직전에 한 번에.** 이번에 잡 이름이
  `api-java (gradle test · Testcontainers)` → **`api (gradle test · Testcontainers)`** 로
  바뀌었고 `api (pytest · DB 통합)` 이 사라졌다. 4단계가 남긴 `contract-harness` ·
  `contract-harness-java` 도 함께 뺀다. **지금 CI 잡은 `web` · `api` 둘뿐이다.**
- 🔥 **rename 후 재배포 확인.** 한 브랜치라 머지 직후가 그 시점이다. 특히 `fe` 잡의 방침
  게이트(발견 ②)와 웹 빌드의 `notices.json`(발견 ③)이 실제 러너에서 도는 것을 본다.
- `apps/api/CLAUDE.md` 전면 재작성 — 지금 이 파일은 제목부터 `apps/api-java 지침`이고,
  사라진 `REQUIRE_ALEMBIC_CHECK` · `check-refs.py` · parity 테스트 다섯을 이름으로 가리킨다.
- 루트 `CLAUDE.md` · `CONTEXT.md` 의 `apps/api-java` 서술, `docs/DEPLOY-*.md`,
  `apps/api/API.md` 드리프트.
- **마지막에** `SPEC.md` · `spec/` 폐기.
