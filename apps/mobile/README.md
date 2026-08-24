# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

문서: [연습 흐름 (목업 M4~M9)](docs/PRACTICE-FLOW.md) — 화면 대응표, 진행 줄·영상
접이식 규칙, 개발용 UI 미리보기.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## acttub 개발 셋업

이 앱은 acting-api(`apps/api`)의 클라이언트입니다. 기본 베이스 URL은 `https://dev.acttub.com` 이고
`EXPO_PUBLIC_API_URL` 로 덮습니다(`lib/api.ts`) — 빌드 프로필별 값은 `eas.json` 에 있습니다.
화면 명세: Confluence "기능 명세서 acttub 화면·기능" (TSSNN/23724034)

1. `npm install`
2. 기본값(dev) 말고 다른 백엔드를 보려면 루트에 `.env` 파일 생성 (git에 올라가지 않음):
   ```
   EXPO_PUBLIC_API_URL=https://acttub.com
   ```
   (운영을 보는 예시다. 로컬 백엔드를 보려면 `localhost` 가 아니라 폰이 닿는 IP 를 적는다.)
3. `npx expo start` → 폰의 Expo Go(SDK 54)로 QR 스캔

주의: 폰의 Expo Go가 SDK 54 지원 버전이어야 합니다 (이 프로젝트가 SDK 54인 이유).
