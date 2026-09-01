# apps/web 지침

## 시작 순서

1. 명령과 버전은 `package.json`에서 확인합니다.
2. 작업 갈래에 맞는 문서를 먼저 읽습니다.
   - **테스트를 추가·수정하거나 실패를 진단**할 때 → [TESTING.md](TESTING.md)
   - **계측·이벤트·동의·번들러**를 바꿀 때 → [ANALYTICS.md](ANALYTICS.md)
   - **성능 예산·Lighthouse**를 바꿀 때 → [PERFORMANCE.md](PERFORMANCE.md)
3. API 계약을 바꾸면 루트 `CLAUDE.md`의 「API 계약 변경」 순서를 함께 따릅니다.

## 서버 경계

이 앱은 화면을 정적 프리렌더하고 Node 프로세스로 `.next/standalone/`을 서빙하며,
`/v2/*`·`/health`를 Spring Boot로 프록시합니다. Route Handler·Server Actions·middleware에
비즈니스 API를 만들지 않고 `apps/api`에 엔드포인트를 추가합니다.

빌드가 서버 코드를 허용하더라도 이 경계는 그대로입니다. 백엔드가 Next와 Spring Boot로
갈리면 인증·권한·계약 검증도 두 벌이 됩니다.

## 빌드·프리렌더

- 배포 빌드는 `package.json`의 `build` 스크립트를 그대로 사용하고 `build`를 `typecheck`보다
  먼저 실행합니다. Next 빌드가 `next-env.d.ts`와 `.next/types`를 만듭니다.
- 번들러를 바꾸기 전에는 `ANALYTICS.md`의 세션 리플레이 검증을 통과시킵니다. 현재 webpack
  선택은 빌드 성공 여부가 아니라 녹화 청크의 런타임 동작을 지키는 가드입니다.
- `API_ORIGIN`은 빌드 시 `routes-manifest.json`에 굳습니다. 배포 프록시 대상을 런타임
  환경변수로 바꿀 수 있다고 가정하지 않습니다.
- 페이지 프리렌더를 유지합니다. `useSearchParams`는 `<Suspense>` 안에서 사용하고, 모듈
  최상위의 `window`·`navigator` 접근을 피하며, 클라이언트 번들에는 공개값만 넣습니다.
- 보안 컨텍스트 전용 브라우저 API는 HTTP로 여는 LAN 개발 환경에서도 동작할 폴백을 둡니다.

## 데이터·API

- 화면은 `src/lib/api/v2/*`를 통해 호출합니다. 토큰·refresh·멱등 재시도·429 백오프는 공용
  클라이언트가 맡고 UI에서 다시 구현하지 않습니다.
- 서버 응답 하나가 화면의 단일 상태라면 `src/lib/react/use-resource.ts`의 `useResource`를
  사용합니다. 조회 키는 원시값 하나로 주고 `null`은 조회 게이트로 씁니다.
- 목록 누적, 폼 초기값, 편집 상태, 같은 응답을 세우는 경로가 둘 이상인 화면은 별도 state를
  유지합니다. 기존 예외 자리의 코드 주석이 그 판단의 정본입니다.
- 화면 오류 문구는 `src/lib/api/v2/errors.ts:errorMessage`로 만들고, 404는 리소스 존재 여부를
  드러내지 않는 중립 카피를 사용합니다.

## 스타일·카피

- 프레젠테이션 컴포넌트는 같은 파일의 로컬 함수로 둡니다. 두 화면이 실제로 공유할 때만 해당
  feature의 가장 가까운 공통 파일로 올립니다.
- 사용자 카피는 한국어 존댓말을 사용합니다. 금지 문구는 `pnpm test`에 포함된 제품 언어
  가드가 판정합니다.

## 완료 기준

- 시작 순서에서 해당하는 모든 갈래의 문서와 실제 설정을 확인합니다.
- 빌드·프록시 변경은 `build → typecheck`와 배포 산출물에서 검증하고, 번들러 변경은 계측
  런타임까지 확인합니다.
- API 변경은 공용 클라이언트 경계와 루트 계약 변경 순서를, 화면·카피 변경은 UI 가이드와
  영향받는 흐름을 확인합니다.
- 테스트는 [TESTING.md](TESTING.md)의 완료 기준과 루트 CI의 web 잡 범위를 통과합니다.
