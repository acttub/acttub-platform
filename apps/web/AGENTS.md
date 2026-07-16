# AGENTS.md

## 적용 범위

이 지침은 `apps/web`의 Next.js 웹 앱에 적용됩니다.

## 기술 스택

- Next.js App Router
- TypeScript
- Tailwind CSS
- ESLint
- 저장소 루트에서 관리하는 pnpm workspace

## 명령어

가능하면 저장소 루트에서 명령어를 실행합니다:

- `pnpm dev:web`
- `pnpm lint:web`
- `pnpm build:web`

동일한 루트 alias:

- `pnpm dev`
- `pnpm lint`
- `pnpm build`

## 구조

권장 소스 구조:

```text
src/
  app/          App Router 페이지, 레이아웃, route handler
  components/   재사용 UI 컴포넌트
  features/     제품/도메인 feature 모듈
  lib/
    api/        클라이언트 API 접근 코드와 공유 DTO 타입
    config/     앱 설정
  server/       Next Route Handler용 임시 서버 사이드 로직
```

필요할 때만 폴더를 만들고, 빈 추상화 계층은 추가하지 않습니다.

## 프론트엔드/API 경계

장기적인 백엔드는 `apps/api`의 Spring Boot입니다. 그 전까지는 이 앱이 `src/app/api` 아래의 Next.js Route Handler로 임시 API를 제공할 수 있습니다.

규칙:

- UI, component, feature 코드는 반드시 `src/lib/api/*`를 통해 API를 호출합니다.
- UI 코드에서 `src/server/*`를 직접 import하지 않습니다.
- 요청/응답 DTO를 명시적으로 유지하고, 이전하기 쉬운 형태로 작성합니다.
- 나중에 프론트엔드 호출부를 바꾸지 않고 Spring Boot에서 구현할 수 있는 HTTP 계약을 선호합니다.
- 향후 모바일 앱이나 Spring Boot 서비스에서도 같은 동작이 필요하다면 Server Actions를 핵심 백엔드 계약으로 사용하지 않습니다.

## Next.js 규칙

- `src/app` 아래에서는 App Router 규칙을 따릅니다.
- 기본적으로 Server Component를 선호하고, 상호작용, 브라우저 API, 클라이언트 상태가 필요할 때만 `"use client"`를 추가합니다.
- route handler는 얇게 유지합니다: 입력 파싱, server/service 코드 호출, 응답 반환만 담당합니다.
- 의도적으로 공개하는 값이며 `NEXT_PUBLIC_`로 이름 붙인 경우가 아니라면 환경 변수 접근은 서버 사이드에 둡니다.
