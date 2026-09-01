# apps/mobile 지침

## 시작 순서

1. 이 앱은 pnpm 워크스페이스 밖에서 npm으로 자립 관리합니다. 명령과 버전은 이 디렉터리의
   `package.json`·`package-lock.json`을 확인합니다.
2. Expo API를 바꾸기 전에 설치된 SDK 버전과 일치하는 공식 문서를 확인합니다.
3. 작업 갈래에 맞는 정본을 읽습니다.
   - **네이티브 설정·플러그인** → `app.json`, `app.config.js`, `plugins/*`
   - **EAS 빌드·제출·Firebase 파일** → `eas.json`, `.easignore`, `app.config.js`
   - **연습 화면 대응** → [PRACTICE-FLOW.md](docs/PRACTICE-FLOW.md)의 화면 표. 검증 명령은 CI를
     따릅니다.
   - **테스트·CI** → 루트 `.github/workflows/ci.yml`의 `mobile` 잡

## 개발·검증

- 네이티브 모듈을 포함한 전체 기능 검증은 development build에서 합니다. Expo Go로 열리는
  제한된 경로를 전체 앱 검증으로 간주하지 않습니다.
- `typedRoutes` 타입은 `.expo/types`에 생성됩니다. 라우트 타입 오류를 판정하기 전에 현재
  라우트에서 타입을 다시 생성하고, 오래된 `.expo/` 산출물을 코드 오류로 해석하지 않습니다.
- 공통 최소 CI 관문은 `node --test tests/*.test.mjs`입니다. 이 잡은 설치 없이 실행되므로
  테스트에 런타임 외부 의존을 추가하면 CI의 설치 단계도 함께 바꿉니다.
- lint와 typecheck는 현재 mobile CI 관문이 아닙니다. 실행했다면 생성된 Expo 라우트 타입을
  포함해 결과의 전제를 함께 기록합니다.

## 네이티브·EAS

- `ios/`·`android/`는 prebuild 산출물입니다. 영속할 네이티브 설정은 `app.json`,
  `app.config.js`, `plugins/*`로 표현합니다.
- EAS 빌드에 포함되는 파일은 `.gitignore`만 보고 추측하지 않습니다. 이 앱은 `.easignore`와
  평가된 `app.config.js`가 함께 결정하므로 Firebase 파일 전달 방식을 바꿀 때 둘을 같이
  확인합니다.
- `EXPO_PUBLIC_*`는 앱 번들에 들어가는 공개값입니다. 비밀을 넣지 않습니다.
- API URL을 바꾸면 요청 대상뿐 아니라 `lib/analytics.ts`의 운영 계측 판정도 함께 확인합니다.

## 백엔드 호출

- 화면은 `lib/api.ts`와 `lib/api-request.ts`를 통해 acting-api를 호출합니다. 토큰·refresh·멱등
  재시도는 공용 요청 계층에 둡니다.
- API 계약이 바뀌면 생성 타입이 없는 모바일의 요청·응답 타입과 모든 소비자를 직접
  검색합니다. 웹 타입 생성이 성공한 것만으로 모바일 호환을 판정하지 않습니다.

## 완료 기준

- 시작 순서에서 해당하는 모든 갈래의 정본과 소비처를 확인합니다.
- 네이티브 설정·플러그인은 평가된 설정과 영향받는 플랫폼의 development build로 검증합니다.
- EAS build·submit·Firebase 파일 전달은 `eas.json`·`.easignore`·평가된 앱 설정과 해당 EAS
  프로필의 실행 결과를 함께 확인합니다.
- API 변경은 요청·응답 타입과 모든 호출부를 확인합니다.
- 화면·카피는 typed routes를 다시 생성한 뒤 development build에서 바뀐 경로와 상태를 직접
  열어 카피·상호작용을 확인합니다.
- 공통 최소 CI 관문을 새 의존 조건에서도 재현합니다.
