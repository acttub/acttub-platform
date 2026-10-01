# acttub 모바일 앱

Expo 앱이며 acting-api(`apps/api`)의 클라이언트입니다. 작업 규칙은 [CLAUDE.md](CLAUDE.md), 연습 화면 대응은
[PRACTICE-FLOW.md](docs/PRACTICE-FLOW.md), 화면 정본은 루트 [CLAUDE.md 「조건부 정본」](../../CLAUDE.md#조건부-정본)의
pen 파일입니다.

## 개발 셋업

기본 베이스 URL은 `https://dev.acttub.com` 이고
`EXPO_PUBLIC_API_URL` 로 덮습니다(`lib/api.ts`) — 빌드 프로필별 값은 `eas.json` 에 있습니다.

1. `npm install`
2. 기본값(dev) 말고 다른 백엔드를 보려면 루트에 `.env` 파일 생성 (git에 올라가지 않음):
   ```
   EXPO_PUBLIC_API_URL=https://acttub.com
   ```
   (운영을 보는 예시다. 로컬 백엔드를 보려면 `localhost` 가 아니라 폰이 닿는 IP 를 적는다.)
3. `npx expo start`. 어느 빌드로 열어 검증하는지는 [CLAUDE.md 「개발·검증」](CLAUDE.md#개발검증)을 따릅니다.

주의: Expo Go로 열 때는 폰의 Expo Go가 SDK 54 지원 버전이어야 합니다 (이 프로젝트가 SDK 54인 이유).
