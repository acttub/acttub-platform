# Airbridge 모바일 설치·실행 계측

Airbridge Expo/React Native SDK를 통해 운영 앱의 설치·실행 이벤트를 수집한다. 앱은 SDK가 알려 주는 설치 귀속 결과를
이 기기에서 새로 가입한 계정에만 서버로 한 번 보내고(`lib/signup-attribution.ts`, SOMA-588), 귀속 콜백이 오지 않은 가입은
기기 ID를 한 번 넘겨 서버가 Airbridge에서 다시 가져오게 한다(`lib/airbridge-device.ts`, SOMA-643).
기존 Firebase·Meta SDK와 ATT 요청 흐름은 유지한다. 별도의 JS 초기화 호출은 없으며,
Expo 플러그인이 생성하는 Android/iOS 네이티브 초기화를 사용한다. SDK 설정을 바꾸면 OTA 업데이트만으로 적용할 수 없고
새 네이티브 빌드가 필요하다.

## 환경과 토큰

- Airbridge App Name: `acttub`
- `AIRBRIDGE_ENVIRONMENT=production`: `airbridge.production.json`, 수집 활성화
- `AIRBRIDGE_ENVIRONMENT=development` 또는 로컬 기본값: SDK 비활성화
- API URL과 Airbridge 환경이 서로 다르거나 환경명이 잘못되면 설정 평가에서 중단한다.
- `production`·`preview-prod` EAS 프로필은 명시적으로 EAS `production` 변수 세트를 사용한다.
  개발 계열의 기존 EAS 변수 세트 선택 방식은 변경하지 않는다.

빌드 전에 EAS 프로젝트의 **production 환경**에 `AIRBRIDGE_APP_TOKEN`을 등록한다.
값은 Airbridge의 **App SDK Token**을 사용하고 가시성은 **Sensitive**로 설정한다.
이 값은 Expo app config의 로컬 평가 단계에도 필요하므로, 로컬 CLI에서 읽을 수 없는
**Secret** 가시성만으로 등록하면 운영 빌드가 시작 전에 실패한다.

App SDK Token은 SDK 동작을 위해 최종 네이티브 바이너리에 포함되는 앱 식별용 값이다.
저장소, `eas.json`, 로그, 스크린샷에는 실제 값을 남기지 않는다.
S2S Token이나 계정 API Token을 이 변수에 넣어서는 안 된다.
로컬에서 운영 설정을 평가할 때도 환경변수로 주입하고 평가된 전체 설정을 출력하지 않는다.

토큰이 없는 개발 설정은 비활성용 대체값으로 플러그인 리소스를 생성한다.
SDK는 비활성 상태이므로 운영 데이터로 보내지 않는다. 운영 토큰이 없으면
앱 실행 중이 아니라 설정 평가 단계에서 중단한다.

## 참고

- SDK 공식 가이드: https://help.airbridge.io/en/developers/expo-sdk-v4
- EAS 환경변수: https://docs.expo.dev/eas/environment-variables/
