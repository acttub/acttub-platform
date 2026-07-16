# AGENTS.md

## 프로젝트 구조

이 저장소는 Acttub 플랫폼을 위한 pnpm 모노레포입니다.

현재 및 예정 앱 구성:

- `apps/web`: Next.js 웹 앱입니다. 현재 활성 개발 대상은 이 앱뿐입니다.
- `apps/api`: 향후 Spring Boot 백엔드가 들어갈 위치입니다. 백엔드 작업이 시작되기 전까지 비워둡니다.
- `apps/mobile`: 향후 React Native 앱이 들어갈 위치입니다. 모바일 작업이 시작되기 전까지 비워둡니다.
- `packages/*`: 향후 공통 타입, 유틸리티, UI primitive, 설정 등을 담을 공유 패키지 위치입니다.

## 패키지 매니저

- `pnpm`을 사용합니다.
- npm, yarn, bun lockfile을 추가하지 않습니다.
- 루트 스크립트:
  - `pnpm dev`: 웹 앱 실행
  - `pnpm lint`: 웹 앱 lint 검사
  - `pnpm build`: 웹 앱 빌드

## 저장소 규칙

- 앱별 코드는 해당 `apps/*` 디렉토리 안에 둡니다.
- 재사용 코드는 실제 두 번째 사용처가 생긴 뒤에만 `packages/*`로 분리합니다.
- 생성물 또는 로컬 전용 디렉토리는 수정하지 않습니다:
  - `.omx/`
  - `node_modules/`
  - `.next/`
- diff는 작게 유지하고, 가장 좁은 범위의 관련 명령으로 먼저 검증한 뒤 웹 변경 사항은 `pnpm lint`와 `pnpm build`로 확인합니다.

## 백엔드 방향성

장기적인 백엔드 목표는 `apps/api`의 Spring Boot입니다.

초기 제품 개발 단계에서는 `apps/web` 안에 임시 Next.js Route Handler API를 둘 수 있습니다. 이 API들은 향후 이전 대상이라고 보고 작성합니다:

- HTTP path와 DTO를 안정적으로 유지합니다.
- REST 스타일의 `/api/v1/*` 계약을 선호합니다.
- 프론트엔드 UI가 임시 서버 내부 구현에 직접 결합되지 않게 합니다.
- 나중에 Spring Boot가 보존해야 할 가정은 문서화합니다.
