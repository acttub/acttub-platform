# 웹 성능 계약

## 목표

프로덕션 정적 빌드의 비로그인 랜딩 페이지(`/`)는 모바일 Lighthouse Performance
점수 90 이상을 유지합니다. Lighthouse CI는 기본적으로 세 번 측정하고 각 성능
예산의 중앙값을 사용해 한 번의 이례적인 측정이 결과를 결정하지 않게 합니다.

저장소 루트의 성능 명령은 다음 용도로 사용합니다.

- `pnpm perf` — 웹 정적 빌드 후 Lighthouse CI 성능 예산을 검증합니다.
- `pnpm perf:web` — 기존 `apps/web/out/`을 대상으로 Lighthouse CI를 실행합니다.
- `pnpm perf:healthcheck` — Lighthouse CI 실행 환경과 설정을 사전 점검합니다.

최종 확인에서는 측정 횟수를 다섯 번으로 늘릴 수 있습니다.

```sh
LHCI_RUNS=5 pnpm perf
```

`pnpm perf:web` 실행 시 Lighthouse CI는 `apps/web/out/`을 임시 정적 서버로 열고
사용 가능한 포트를 동적으로 배정하므로 고정 포트를 전제로 하지 않습니다. 보고서는
`apps/web/artifacts/lighthouse/mobile/`에 저장되며 Git 추적 대상에서 제외됩니다.

## 허용 기준

임시 정적 서버의 `/`를 측정한 모바일 중앙값은 다음 예산을 모두 만족해야 합니다.

- Lighthouse Performance 점수: 90 이상
- Largest Contentful Paint (LCP): 2.5초 이하
- Cumulative Layout Shift (CLS): 0.1 이하
- Total Blocking Time (TBT): 200밀리초 이하

TBT는 반복 가능한 실험실 진단 지표이며, 필드 전용 지표인 INP를 대체하지 않습니다.
이 문서는 성능 계약만 다루며 전체 릴리스 완료 조건을 대신하지 않습니다. 일반 변경
검증에서는 다음 명령도 별도로 확인합니다.

- `pnpm lint`
- `pnpm typecheck`
- `pnpm --filter web test`
- `pnpm build`

## 측정 범위

현재 자동 측정은 공개 비로그인 화면인 `/`만 대상으로 합니다. 다음 경로는 인증 또는
약관 상태가 필요하므로 비로그인 Lighthouse 수집 대상에 넣지 않습니다.

- `/home`
- `/practice/new`
- `/practice/history`
- `/terms`

`/home`, `/practice/new`, `/practice/history` 같은 보호 화면은 인증되지 않으면
`/login`으로 이동하며 Google 로그인이 항상 표시되고, `next dev`에서만 development
테스트 폼이 함께 표시됩니다. 인증 토큰은
`localStorage`에 저장되므로 쿠키만 설정해서는 인증 상태를 재현할 수 없습니다.
`/terms`는 API가 제공하는 약관 상태에 의존합니다. 이 경로들은 결정적인 테스트 계정,
`localStorage` 토큰 주입, 안정적인 API 픽스처가 마련된 뒤 별도 시나리오로 추가합니다.

## 실험실 점수와 Core Web Vitals

0~100 결과는 Lighthouse 실험실 점수입니다. 실제 Core Web Vitals는 배포 후 실제
사용자 기반 Chrome UX Report 또는 Search Console 데이터로 확인합니다. 이 필드
데이터의 누적 기간은 일상적인 개발 피드백 루프로 사용할 수 없습니다.

Lighthouse CI 버전은 고정합니다. Lighthouse 또는 Chrome 버전이 바뀌면 점수도 달라질
수 있으므로 의도적으로 업그레이드하고 새 기준선을 기록합니다.
