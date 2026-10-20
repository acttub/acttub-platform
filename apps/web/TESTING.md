# 웹 테스트

웹 테스트를 추가·수정하거나 실패를 진단할 때 읽습니다.

## 기본 경계

- 테스트는 `tests/*.test.mjs`에서 Node test runner로 실행합니다.
- TypeScript·TSX 소스를 직접 불러오는 테스트는 `tests/ts-module-loader.mjs`를 등록합니다. 이
  로더가 TS 변환, 확장자 없는 상대 import, `@/` 별칭을 처리합니다.
- 실제 동작을 실행할 수 있으면 소스 문자열을 `readFileSync`와 정규식으로 맞추는 테스트를
  새로 만들지 않습니다. 그런 테스트는 멀리 떨어진 심볼을 우연히 이어 붙이고 리팩터링에
  행동과 무관하게 깨집니다.

## React 훅

1. 훅을 부르는 최소 컴포넌트를 `tests/fixtures/*.tsx`에 둡니다.
2. `tests/mount-probe.mjs`에서 `mountProbe`와 필요한 `react`·`window`를 가져옵니다. 이 파일이
   jsdom 전역을 먼저 세운 뒤 React를 import하는 순서를 보장합니다.
3. `latest`, `everyRender`, `act`, `text` 중 행동을 증명하는 가장 좁은 표면을 단언합니다.
4. 테스트가 끝나면 probe를 `unmount()`합니다.

`dom-setup.mjs`는 필요한 전역만 심습니다. jsdom `window` 전체를 `globalThis`에 복사하면
`performance` 재귀와 React 19 `FormData` 충돌이 생깁니다. 새 전역이 필요하면 하나씩 추가합니다.

`act`는 production React 빌드에 없으므로 훅 테스트는 `NODE_ENV=production`을 전제로 하지
않습니다. `next/*` 서브패스를 직접 import하는 훅은 Node ESM용 목이나 더 작은 seam을 둡니다.

## 컴포넌트·화면

1. `ts-module-loader.mjs`와 `mount-probe.mjs`를 먼저 불러오고, `@testing-library/react`와 대상 컴포넌트는 그 뒤에
   `await import`로 불러옵니다. jsdom 전역이 React보다 먼저 서야 합니다.
2. 요소는 역할과 접근 가능한 이름(`getByRole`)으로 찾고, 사용자가 보는 결과(글자, 링크 주소, 호출된 API의 인자)를 단언합니다.
3. `next/navigation`처럼 Node에서 돌지 않는 모듈은 `registerHooks`로 바꿔 끼웁니다(`analytics-cross-tab.test.mjs` 참고).
4. 테스트마다 `cleanup`을 부릅니다.

## 단언 수준

- 훅·상태 전이·API 어댑터·순수 로직의 행동을 단언합니다.
- 컴포넌트 마크업 모양(클래스, 태그 구조)을 고정하지 않습니다.
- 회귀 테스트는 수정 전 행동에서 실패하고 수정 후 통과하는지 확인합니다.

## 커버리지

`pnpm test:coverage`가 표를 출력하고 `coverage/lcov.info`를 남깁니다. Node 커버리지는 테스트가 불러온
파일만 집계하므로 표의 비율은 한 번도 import되지 않은 파일을 빼고 계산됩니다. `readFileSync`로
소스 문자열만 읽는 테스트도 커버리지에 잡히지 않습니다. `apps/mobile`의 `npm run test:coverage`도 같은 방식입니다.

**완료 기준:** 새 동작과 실패 갈래가 실행 가능한 테스트로 고정되고, `apps/web`에서 실행한 전체
`pnpm test`에서 다른 테스트 파일과 격리된 채 통과합니다.
