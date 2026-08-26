# apps/mobile 지침

## 적용 범위·스택

Expo 54 + React Native + expo-router(파일 기반 라우팅) + TypeScript.

**Expo는 버전마다 API가 바뀝니다 — 코드를 쓰기 전에 해당 버전 문서를 확인합니다: https://docs.expo.dev/versions/v54.0.0/**

## 패키지 매니저는 npm입니다 (pnpm 아님)

`pnpm-workspace.yaml`이 `!apps/mobile`로 제외합니다 — pnpm 심링크가 Metro를 깨서. 이 디렉토리는 `package-lock.json`으로 자립 관리하며, 루트에서 `pnpm --filter`로 부를 수 없습니다.

## 명령어 (이 디렉토리 기준)

- `npm install`
- `npx expo start` — **Expo Go로는 뜨지 않습니다.** `expo-dev-client`와 네이티브 모듈(Firebase·Google Sign-In·Apple Auth)을 쓰므로 dev client 빌드가 필요합니다.
- `npm run ios` · `npm run android` — 로컬 네이티브 빌드(`expo run:*`). 실행 시 prebuild가 `ios/`·`android/`를 생성합니다.
- `npm run lint`
- 배포 빌드·제출은 EAS(`eas.json`).
- ⚠ **`tsc --noEmit`은 그대로 쓸 수 없습니다.** `app.json`이 `typedRoutes: true`라 라우트 타입이 `.expo/types/router.d.ts`에 생성되는데, `.expo/`는 `.gitignore`라 새 클론에는 없고 dev 서버가 만든 뒤로는 라우트를 추가해도 낡습니다. 그 상태로 돌리면 **실재하는 라우트가 전부 빨간불**이 됩니다(`/admissions`·`/memory` 등) — 코드가 아니라 생성물을 의심합니다.

## 테스트

`node --test tests/*.test.mjs` (이 디렉토리에서). Node가 `.ts` import를 그대로 읽으므로 웹과 달리 커스텀 로더가 없습니다.

`.github/workflows/ci.yml`의 **`mobile (node --test)`** 잡이 이것을 돌립니다. **잡 이름이 곧 required status check의 context**라, 이름을 바꾸면 ruleset 둘(`main`·`dev`)도 함께 고칩니다.

📌 **스위트가 외부 런타임 의존을 하나도 쓰지 않습니다** — import 하는 것은 `node:*` 빌트인과 프로젝트 `.ts` 파일뿐이고, `@/`로 들어오는 둘은 `import type`이라 지워집니다. `node_modules` 없이도 전부 통과하며 **CI 잡에 설치 단계가 없는 이유가 그것입니다.** 런타임 import를 하나 더하는 순간 그 전제가 깨지고 잡이 빨간불이 됩니다.

⚠ **lint·typecheck는 그 잡에 없습니다.** `expo lint`는 Expo 전체 트리 설치가 필요해 잡이 몇 분으로 늘고, `tsc`는 위 typed routes 사정 때문에 클린 체크아웃에서 의미 있는 결과를 내지 못합니다. **둘은 여전히 사람이 봅니다.**

⚠ **`tests/index.mjs`로 돌리지 않습니다.** 손으로 관리하는 import 목록이라 빠진 파일이 있고, 그 파일들은 조용히 건너뛰어집니다. 위 glob 명령이 디렉토리 전체를 봅니다.

## 네이티브 설정은 app.config.js가 소유합니다

- `ios/`·`android/`는 **gitignore된 prebuild 산출물**입니다(`.gitignore`의 `/ios`·`/android`). 직접 고치면 다음 prebuild에 날아갑니다 — 네이티브 설정은 `app.json` + `app.config.js` + `plugins/*`로 표현합니다.
- `plugins/with-rnfirebase-static.js`·`plugins/with-non-modular-headers.js`가 `@react-native-firebase` + static frameworks + New Architecture 조합의 컴파일 충돌(non-modular header)을 막습니다. 지우면 iOS 빌드가 깨집니다.
- `GoogleService-Info.plist`는 gitignore라 EAS 빌더에 올라가지 않습니다(git-tracked 파일만 업로드). EAS 파일 환경변수 `GOOGLE_SERVICE_INFO_PLIST`(secret)로 주입하고, 없으면 로컬 경로로 폴백합니다.

## 환경변수

`EXPO_PUBLIC_*`만 앱 번들에 새겨집니다 — **비밀은 넣지 않습니다.**

- `EXPO_PUBLIC_API_URL` — acting-api 베이스 URL.
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` — iOS OAuth URL scheme을 `app.config.js`가 여기서 reversed 형태로 도출합니다.
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`

## 구조

```text
app/          expo-router 화면 (파일 = 라우트)
components/   화면을 가로지르는 컴포넌트 (시트·다이얼로그·녹화 카드 등)
lib/          API 클라이언트·토큰 스토어·도메인 로직
hooks/
constants/    palette.ts
plugins/      Expo config plugin (네이티브 빌드 보정)
tests/        node --test 스위트 (위 「테스트」 참조)
scripts/      폰트·스토어 자산 생성 도구(파이썬) + reset-project
store/        스토어 등록 문안 (listing-ko.md)
docs/         PRACTICE-FLOW.md (연습 흐름 화면 대응표)
```

## 백엔드 호출

- 정본 백엔드는 `apps/api`(acting-api)이고, 웹과 달리 Next 프록시를 거치지 않고 `EXPO_PUBLIC_API_URL`로 직접 호출합니다.
- 화면에서 `fetch`를 직접 부르지 않습니다 — `lib/api.ts`(+`lib/api-request.ts`)를 통합니다. 토큰 부착·refresh·멱등 재시도는 `lib/token-store.ts`와 요청 클라이언트가 담당합니다.
- API 계약이 바뀌면 웹만 고치고 끝내지 않습니다. 모바일은 스키마 자동 생성이 없어 조용히 깨집니다.
