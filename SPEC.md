# SPEC — 웹 UI/UX 수정 6건

기준 커밋: `859270d`(dev) · 브랜치: `feat/web-uiux-fixes`

## 배경 / 목적

`apps/web`에서 사용자가 직접 겪은 UI/UX 결함 6건을 한 번에 정리한다.
**기존 UI를 최대한 유지**하는 것이 상위 제약이다 — 레이아웃·색·컴포넌트 구조를 새로 짜지 않고
필요한 최소 변경만 넣는다.

`apps/mobile`은 범위 밖이다. `TODO.md` 11번(이름 입력은 최초 회원가입 때만)은 웹에서
`use-display-name-gate.ts:18`이 이미 처리하고 있어 이번 PR에서 제외하고 모바일 이슈로 남긴다.

## 사전 조사로 확정된 사실

- **배포 형태**: `pnpm build`(정적 export) → `out/` → EC2에서 FastAPI가 `STATIC_DIR`로 서빙.
  `app.py:283-299`가 `/practice/history?session=x`에도 같은 `history.html`을 반환하므로
  라우팅은 전부 클라이언트에서 일어난다. **사용자가 겪은 삭제 버그는 배포(정적 빌드) 환경이다.**
- **죽은 코드**: `practice-flow.tsx`의 `PracticeNewScreen`(906~)·`PracticeContextScreen`(997~)·
  `TextField`(795~806)는 도달 불가능하다. `step`은 `entryInitialStep[entry]`로만 초기화되고
  실사용 entry는 `home`·`history` 둘뿐인데, `step`을 `"video"`/`"context"`로 바꾸는 함수는
  `PracticeNewScreen`/`PracticeContextScreen`에만 전달되기 때문이다(`PracticeHome`·
  `PracticeHistoryScreen`은 받지 않는다). **이번 PR에서는 손대지 않는다** — `TODO.md` 9번으로 남긴다.
- **살아있는 입력 화면**: 새 연습은 `/practice/new` → `PracticeSingle`뿐이다.
- **동의 문서**: `terms`·`privacy`·`ai_analysis` 3종이 전부 `required=true`. 선택 동의는
  `ConsentType` enum에 아직 없다. 본문은 마크다운 원문인데 웹은 `whitespace-pre-wrap`으로
  평문 렌더 중이라 `#`·`##`·`**` 기호가 그대로 노출되고 있다.
- **테스트 인프라**: `node --test tests/*.test.mjs` 19개, 전부 순수 로직·계약 테스트.
  컴포넌트 테스트 도구(jsdom/testing-library)는 없다.

---

## 설계

### 1. 리포트 삭제 후 목록으로 이동

**증상**: 배포 환경에서 세션 상세의 삭제 버튼을 눌러 삭제가 성공해도 화면이 상세에 머문다.

**현재 코드** (`practice-flow.tsx:676-698`): `deletePracticeSession()` 성공 후
`router.replace(SESSION_DETAIL_PATH)`로 쿼리를 떼고, `sessionParam`이 `null`이 되면
동기화 effect(`:130-144`)가 `clearActiveSession()`을 호출해 목록으로 돌아가는 구조다.

**가설**: 정적 export에서 `router.replace`로 pathname은 그대로 두고 쿼리만 제거할 때
`useSearchParams()`가 갱신되지 않아 `sessionParam`이 계속 세션 id를 들고 있고,
`activeSessionId`(`:705`)가 여전히 truthy로 남는다. Phase 4에서 정적 빌드로 원인을 확정한다.

**설계**: URL을 단일 기준으로 쓰는 현재 구조를 유지하되, URL 갱신에 의존하지 않는
로컬 안전장치를 둔다.

```
deleteSession()
  await deletePracticeSession(id)
  markSessionDeleted(id)        ← 추가: 로컬 삭제 마킹
  forgetDeletedSession(id)
  router.replace(SESSION_DETAIL_PATH)

activeSessionId 계산 (:705)
  후보 id가 삭제 마킹돼 있으면 null로 취급 → 목록 화면으로 판정
```

- 404(이미 삭제됨·남의 리소스) 경로에도 같은 마킹을 적용한다.
- 마킹은 컴포넌트 로컬 state로 충분하다(삭제는 항상 상세 화면에서 일어나고, 목록으로 돌아간 뒤
  같은 id로 다시 들어갈 경로가 없다). 영속화하지 않는다.
- 원인이 다른 것으로 밝혀지면 근본 원인을 고치되, 아래 제약은 유지한다.
  - 풀 페이지 리로드(`window.location.assign` 등)로 해결하지 않는다 — 목록 재조회로 화면이 깜빡인다.
  - **dev/prod 환경 분기 금지** — 한 코드 경로여야 한다.

### 2. "겉으로 드러낸 태도와 속마음" → "서브텍스트"

- `practice-single.tsx:411` 입력 레이블
- `practice-single.tsx:31` 안내 문구 body — "상황 · 인물 · **서브텍스트**를 짧게 적어요."

`practice-flow.tsx:1123`은 죽은 코드이므로 건드리지 않는다.

### 3. placeholder 글씨 크기 축소

입력 **본문** 글씨 크기는 그대로 두고, `placeholder:text-[...]` 유틸리티만 추가해
각 필드 본문보다 한 단계 작게 만든다.

| 위치 | 필드 | 본문 크기 | placeholder |
| --- | --- | --- | --- |
| `login/page.tsx:313` | 사용자 ID (개발 로그인) | `text-base` 16px | 13px |
| `login/page.tsx:326` | 이메일 (개발 로그인) | `text-base` 16px | 13px |
| `name-prompt.tsx:52` | 이름 | `text-base` 16px | 13px |
| `practice-single.tsx:541` | 상황·인물 (`Field`) | `text-sm` 14px | 12.5px |
| `practice-single.tsx:412` | 서브텍스트 | `text-sm` 14px | 12.5px |
| `practice-single.tsx:472` | 채팅 답변 | 13.5px | 12.5px |
| `practice-flow.tsx:1698` | 코치 인터뷰 답변 | 15px | 13px |

`practice-flow.tsx:800`(`TextField`)은 죽은 코드이고 placeholder도 없으므로 제외한다.

### 4. 약관 본문 최소화 + 자세히 보기

`terms-gate.tsx`의 `ConsentDocumentCard`(`:324-392`)를 수정한다.

- 접힌 상태: 본문 미리보기 약 96px(3~4줄) + 하단 흰색 그라데이션 페이드.
- `▾ 자세히 보기` 토글 → 같은 자리에서 전문으로 펼침(모달 없음). 펼친 상태 문구는 `▴ 접기`.
- 토글은 `<button type="button">`으로 만든다 — `<form>` 안이므로 `type` 생략 시 submit이 된다.
- 접근성: `aria-expanded`, `aria-controls={bodyId}`를 붙인다. 접힌 상태에서도 본문 DOM은
  유지하고 높이만 제한한다(체크박스의 `aria-describedby={bodyId}`가 계속 유효해야 한다).
- 카드 헤더의 `document.title`과 본문 첫 줄(`# Acttub 이용약관`)이 중복되므로,
  렌더 시 본문 최상위 h1은 생략한다.

**경량 마크다운 렌더링** — 라이브러리를 추가하지 않고 `src/features/practice/consent-markdown.ts`
(신규)에 순수 함수를 둔다. 지원 범위는 실제 약관 3종이 쓰는 문법으로 한정한다:

| 문법 | 처리 |
| --- | --- |
| `# 제목` | 최상위 제목 — 렌더에서 생략(카드 헤더와 중복) |
| `## 소제목` | 굵은 중간 크기 제목 |
| `- 항목` | 목록 항목 |
| `**굵게**` | 굵게 |
| 표(`\| a \| b \|`) | 파이프 구분 텍스트로 평이하게 렌더(표 레이아웃 없음) |
| 빈 줄 | 문단 구분 |

파서는 문자열 → 구조화 노드 배열을 반환하고, 렌더는 React가 담당한다.
`dangerouslySetInnerHTML`은 쓰지 않는다.

### 5. "약관에 모두 동의합니다"

카드 리스트 **위**에 강조 박스로 체크박스 하나를 둔다.

- 체크 → 처리 대기 중인 모든 문서(필수·선택 전부)를 체크. 해제 → 전부 해제.
- 이미 `completed`(부분 실패 후 재시도 상황에서 처리 끝난 문서)이거나 `disabled`인 항목은
  건드리지 않는다.
- **양방향 동기화**: 개별 항목을 전부 체크하면 "모두 동의"도 자동으로 켜지고,
  하나라도 해제하면 꺼진다(파생 상태로 계산 — 별도 state를 두지 않는다).
- 대상 문서가 하나도 없으면(`documents.length === 0`) 이 박스를 렌더하지 않는다.
- `mode === "pending"`일 때만 노출한다(`info` 모드는 읽기 전용 화면).
- 제출 버튼("확인하고 계속하기")과 그 아래 안내 문구는 그대로 둔다.

### 6. 채팅 한글 마지막 글자 잔류

**증상**: Enter로 전송하면 메시지는 온전히 전송되는데, 비워진 입력창에 마지막 조합 중이던
글자 하나가 다시 나타난다.

**현재 코드**: 두 채팅 입력 모두 `!e.nativeEvent.isComposing` 가드는 이미 있다
(`practice-single.tsx:472`, `practice-flow.tsx:1704`). 따라서 원인은 Enter 가드가 아니라,
전송으로 state를 비운 뒤 늦게 도착한 `compositionend`가 조합 문자를 controlled textarea에
되돌려 놓는 것으로 본다.

**설계**: 두 입력 모두에 동일한 처리를 적용한다.

- 전송 시점에 `event.currentTarget.value = ""`로 DOM 값을 직접 비워 조합 버퍼를 끊는다.
- `onCompositionEnd`에서, 전송 직후 플래그가 서 있으면 그 이벤트의 값을 state에 반영하지 않고
  입력창을 비운 채로 둔다.
- 실제 원인이 다르면 Phase 4 진단 결과에 맞춰 고치되, **두 입력창 모두** 동일하게 처리한다.

`practice-flow.tsx`의 채팅은 세션 상세(`SessionView`)의 코치 인터뷰 입력으로 **살아있는 코드**다.

---

## 완료 기준 체크리스트

동작 확인은 정적 빌드(`pnpm build` → `out/`) 기준으로 한다.

- [ ] **C1** 세션 상세에서 삭제 → 확인 → 목록 화면으로 전환된다(로딩 화면에 갇히지 않는다).
- [ ] **C2** 삭제된 세션 카드가 목록에서 사라진다.
- [ ] **C3** 이미 삭제된 세션 삭제(404)에서도 목록으로 전환된다.
- [ ] **C4** `/practice/new`의 입력 레이블이 "서브텍스트"이고, 상단 안내 문구도 같은 용어를 쓴다.
- [ ] **C5** 표의 7개 필드에서 placeholder가 입력 본문보다 작게 보이고, **입력한 글자 크기는 그대로**다.
- [ ] **C6** 약관 화면 카드가 접힌 상태로 뜨고, 미리보기 하단이 페이드된다.
- [ ] **C7** "자세히 보기"를 누르면 같은 자리에서 전문이 펼쳐지고, 다시 누르면 접힌다.
      토글이 폼을 제출하지 않는다.
- [ ] **C8** 약관 본문에 `#`·`##`·`**` 기호가 보이지 않고 제목/본문이 시각적으로 구분된다.
- [ ] **C9** "약관에 모두 동의합니다"를 켜면 3개가 모두 체크되고, 끄면 모두 해제된다.
- [ ] **C10** 개별 3개를 손으로 다 체크하면 "모두 동의"가 자동으로 켜지고, 하나 해제하면 꺼진다.
- [ ] **C11** 동의 제출이 기존과 동일하게 동작한다(부분 실패 재시도 포함 회귀 없음).
- [ ] **C12** 두 채팅 입력창에서 한글을 IME로 입력하고 Enter → 전송된 메시지가 온전하고
      입력창에 잔글자가 남지 않는다.
- [ ] **C13** `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build` 전부 통과.
- [ ] **C14** 신규 순수 로직 테스트가 `node --test`로 통과한다 (마크다운 파서 / 모두 동의 상태 계산 /
      삭제 후 활성 세션 판정).

## 하지 말 것 (스코프 제한)

- `practice-flow.tsx`의 죽은 입력 화면(`PracticeNewScreen`·`PracticeContextScreen`·`TextField`)
  **제거·수정 금지**. `TODO.md` 9번으로 남긴다.
- `apps/mobile` 수정 금지. `TODO.md` 11번은 열어둔다.
- `apps/api` 수정 금지 — API 계약 변경 없음. 약관 본문(`consent_docs/*.md`)도 건드리지 않는다.
  → `spec/openapi.json`·`v2-schema.d.ts` 재생성 불필요.
- 새 런타임 의존성 추가 금지(마크다운 라이브러리·테스팅 라이브러리 포함).
- 레이아웃·색상 팔레트·컴포넌트 구조 재설계 금지. 기존 Toss 스타일 인라인 Tailwind 유지.
- 풀 페이지 리로드로 삭제 이동을 해결하지 않는다.
- dev/prod 환경별 코드 분기 금지.
- 스코프 밖 리팩터링·스타일 정리·의존성 업그레이드 금지.
- 생성물 수정 금지: `node_modules/`, `.next/`, `out/`, `.venv/`, `apps/web/src/lib/api/v2-schema.d.ts`.
- 커밋은 phase 단위로 남기되 **push는 하지 않는다**.

## 지켜야 할 규칙 (기존 저장소 관례)

- 사용자 카피는 한국어 존댓말("~해요"). `tests/product-language-guard.test.mjs`의 금지어
  (점수·판정·평가·등급·강점·약점·개선점 등)를 쓰지 않는다.
- 정적 export 제약: Server Actions·Route Handler·서버 `redirect()` 금지,
  `useSearchParams`는 `<Suspense>` 안에서만, 모듈 최상위 `window`/`navigator` 접근 금지.
- API 호출은 `src/lib/api/v2/*`를 통해서만. 이번 PR은 새 API 호출을 추가하지 않는다.
- 프레젠테이션 컴포넌트는 같은 파일의 로컬 함수로 둔다.

## 미결 사항

1. **항목 1의 근본 원인**이 정적 export의 `useSearchParams` 갱신 실패인지 Phase 4에서 확정한다.
   다른 원인이면 설계의 안전장치 대신 근본 원인을 고친다(제약은 유지).
2. **항목 6의 근본 원인**이 `compositionend` 잔류인지 Phase 4에서 실제 IME 입력으로 확정한다.
3. 두 항목 모두 검증은 **정적 빌드**로 한다 — dev 서버에서는 재현되지 않을 수 있다.
4. IME 재현은 macOS 한글 입력기로 사람이 직접 쳐야 확인된다. 자동 테스트로 대체할 수 없으므로
   Phase 4에서 확인하지 못하면 최종 보고에 "수동 확인 필요"로 남긴다.
