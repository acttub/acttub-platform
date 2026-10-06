# Airbridge 모바일 설치·실행 계측

Airbridge Expo/React Native SDK를 통해 운영 앱의 설치·실행 이벤트를 수집한다.
기존 Firebase·Meta SDK와 ATT 요청 흐름은 유지한다. 별도의 JS 초기화 호출은 없으며,
Expo 플러그인이 생성하는 Android/iOS 네이티브 초기화를 사용한다.

이 변경은 SDK 설정만 추가한다. 신규 네이티브 빌드와 기기 검증 전에는
운영 계측이 연결됐다고 판단하지 않는다. OTA 업데이트만으로 적용할 수 없다.

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

## 이번 변경 범위

- 설치·실행 이벤트의 SDK 자동 수집
- 운영 환경의 Meta Install Referrer 공개 App ID 설정
- 기존 Meta·Firebase 플러그인 및 기존 ATT 요청 유지
- Airbridge의 ATT 대기 기본값은 덮어쓰지 않음

회원가입·로그인·구매·연습 이벤트, 사용자 ID 전달, Universal/App Links,
광고 계정 권한 연결, iOS SKAN 인증은 이 변경에 포함하지 않는다.

## 검증

의존성 설치 없이 CI와 같은 명령으로 설정 회귀 테스트를 포함해 실행할 수 있다.

```sh
node --test tests/airbridge-config.test.mjs
node --test tests/*.test.mjs
```

머지 후 실제 연결을 완료하려면 다음 검증이 별도로 필요하다.

1. EAS production 변수 세트에 App SDK Token을 Sensitive로 등록한다.
2. 개발 네이티브 빌드에서 앱 기동과 기존 로그인·ATT 흐름이 유지되는지 확인한다.
3. 승인된 운영 내부 배포 빌드에서 Android·iOS 각각 Airbridge 테스트 콘솔의
   설치·실행 이벤트 수신을 확인한다. 테스트 데이터가 운영 리포트에 남을 수 있음에 유의한다.
4. 검증 후 별도 승인된 스토어 배포 절차를 따른다.

- SDK 공식 가이드: https://help.airbridge.io/en/developers/expo-sdk-v4
- EAS 환경변수: https://docs.expo.dev/eas/environment-variables/
