# AGENTS.md

## 적용 범위

이 지침은 `apps/web/src/app/api` 아래의 임시 Next.js API에 적용됩니다.

## 목적

이곳의 API는 초기 개발 단계에서 사용하는 백엔드 대체 구현입니다. 장기적으로 계획된 백엔드는 `apps/api`의 Spring Boot이므로, 모든 route는 향후 이전 대상이라는 전제로 작성합니다.

## API 계약 규칙

- Route Handler만 사용합니다: App Router segment 안의 `route.ts` 파일을 사용합니다.
- `/api/v1/*` 아래의 versioned REST path를 선호합니다.
- `GET`, `POST`, `PUT`, `PATCH`, `DELETE`처럼 명확한 HTTP method를 사용합니다.
- 명확한 status code와 JSON 응답 형태를 반환합니다.
- 요청/응답 DTO는 안정적으로 유지하고 `src/lib/api`에서 재사용할 수 있게 합니다.
- 공개 API 계약의 일부로 Next.js 전용 동작에 의존하지 않습니다.
- UI 컴포넌트가 route handler나 서버 구현 파일을 직접 import하지 않게 합니다.

## 구현 규칙

- route handler는 얇게 유지합니다:
  1. 요청 파싱/검증,
  2. service/repository 코드 호출,
  3. typed JSON 응답 반환.
- 임시 비즈니스 로직은 `src/server/services`에 둡니다.
- 임시 데이터 접근 코드는 `src/server/repositories` 또는 `src/server/db`에 둡니다.
- persistence가 mock이라면 임시 구현임을 명확히 표시합니다.

## 이전 메모

API route를 추가하거나 변경할 때는 Spring Boot 이전을 위해 충분한 정보를 남깁니다:

- endpoint path
- method
- request body/query params
- response body
- status code
- auth/permission 가정
- validation 규칙
