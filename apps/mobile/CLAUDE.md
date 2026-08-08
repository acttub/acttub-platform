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
lib/          API 클라이언트·토큰 스토어·도메인 로직
plugins/      Expo config plugin (네이티브 빌드 보정)
constants/    palette.ts
hooks/
docs/         PRACTICE-FLOW.md (연습 흐름 화면 대응표)
```

## 백엔드 호출

- 정본 백엔드는 `apps/api`(acting-api)이고, 웹과 달리 Next 프록시를 거치지 않고 `EXPO_PUBLIC_API_URL`로 직접 호출합니다.
- 화면에서 `fetch`를 직접 부르지 않습니다 — `lib/api.ts`(+`lib/api-request.ts`)를 통합니다. 토큰 부착·refresh·멱등 재시도는 `lib/token-store.ts`와 요청 클라이언트가 담당합니다.
- API 계약이 바뀌면 웹만 고치고 끝내지 않습니다. 모바일은 스키마 자동 생성이 없어 조용히 깨집니다.
