# SPEC: SEO / AEO / GEO 설정 (apps/web)

기준 커밋: `722626c` · 브랜치: `feat/seo-aeo-geo`

## 배경 / 목적

`apps/web`은 SEO·AEO·GEO 관점에서 백지 상태다. metadata는 루트 layout의 title/description 두 줄뿐이고, robots.txt·sitemap.xml·OG 이미지·canonical·JSON-LD·llms.txt가 전부 없다. `public/` 디렉토리 자체가 존재하지 않는다.

목적: 검색엔진(SEO), 답변엔진(AEO), 생성형 엔진(GEO)이 Acttub을 정확히 이해·인용하도록 기반 설정을 갖춘다. 실제 인덱싱 가치가 있는 공개 페이지는 랜딩(`/`) 하나이므로, 랜딩에 신호를 집중하고 나머지는 noindex로 정리한다.

전제 (조사로 확인됨):

- FastAPI 서빙 로직(`apps/api/.../app.py` catch-all)은 `out/` 루트의 정확 일치 파일을 우선 반환한다 → robots.txt 등은 **파일 생성만으로 서빙됨, 백엔드 변경 불필요**.
- `out/`에 `practice/new.html`, `practice/history.html` 등 페이지별 HTML이 개별 생성된다 → 페이지별 메타가 산출물에 반영된다.
- Next 16.2.10. `robots.ts`/`sitemap.ts`/`opengraph-image.tsx`는 정적 export에서 빌드타임 정적 파일로 생성된다.
- `tests/product-language-guard.test.mjs`가 `src/` 전체에서 금지 카피(점수·판정·등급·레벨·강점·약점·개선점 계열 + score/grade/rate/level/judge/improvement 등)를 검사한다 → 새 metadata·JSON-LD·OG 카피도 통과해야 한다.

## 확정된 결정 (사용자 승인)

| 항목 | 결정 |
|---|---|
| 정식 도메인 | `https://acttub.com` (www 없음). www는 인프라에서 apex로 리다이렉트 |
| 사이트 URL 주입 | `NEXT_PUBLIC_SITE_URL` 빌드타임 env, 미설정 시 기본값 `https://acttub.com` |
| 기본 title | `Acttub — 질문으로 다시 보는 연기 연습` |
| title template | `%s \| Acttub` |
| description | `내 연기 영상을 올리면 장면 맥락에서 확인한 단서가 질문으로 돌아와요. 질문으로 연기 장면을 다시 생각하는 연습 도구예요.` |
| 인덱싱 범위 | 랜딩(`/`)만 index 허용. `/login`, `/terms`, `/home`, `/practice`, `/practice/new`, `/practice/history` 전부 noindex 메타 |
| sitemap | `https://acttub.com/` 단일 URL |
| JSON-LD | `WebSite` + `SoftwareApplication` + `Organization` (랜딩에만) |
| Organization | 이름 Acttub, url, `sameAs: ["https://www.instagram.com/acttub_com/"]` (추적 파라미터 제거), 이메일 `acttub0527@gmail.com`. logo는 자산 없음 → 생략 |
| SoftwareApplication | `offers: { price: "0", priceCurrency: "KRW" }` (현재 무료 확인됨) |
| OG 이미지 | `opengraph-image.tsx` ImageResponse 코드 생성. 1200×630, 어두운 단색 배경 + `Acttub` + 태그라인 `질문으로 다시 보는 연기 연습`. 색상은 globals.css 브랜드 색과 일치. 장식 없음 |
| GEO | `public/llms.txt` 포함. manifest·FAQ 섹션 제외 |

## 설계

### 새 파일

1. `apps/web/src/lib/config/env.ts` — `SITE_URL` 추가 (`NEXT_PUBLIC_SITE_URL ?? "https://acttub.com"`, 주석으로 용도 문서화. env.ts가 선택 변수의 단일 문서라는 기존 규칙 준수).
2. `apps/web/src/lib/seo/site-metadata.ts` — 플레인 TS 모듈. `SITE_NAME`·`DEFAULT_TITLE`·`SITE_DESCRIPTION` 상수와 `buildRootMetadata()`(metadataBase, title template, openGraph[siteName·locale `ko_KR`·type website·url], twitter[card `summary_large_image`], canonical), `buildNoindexMetadata(title)`(`robots: { index: false, follow: false }`) 빌더. **next 런타임에 의존하지 않는 순수 객체 반환** → node:test로 직접 테스트 가능.
3. `apps/web/src/lib/seo/json-ld.ts` — `buildWebSiteJsonLd()` / `buildSoftwareApplicationJsonLd()` / `buildOrganizationJsonLd()` 순수 빌더. `@context: "https://schema.org"`.
4. `apps/web/src/app/robots.ts` — 전체 허용 + `/v2/`·`/health` disallow + `Sitemap:` 라인. noindex는 robots.txt가 아니라 메타태그 담당(크롤러가 noindex를 읽으려면 크롤 허용 필요).
5. `apps/web/src/app/sitemap.ts` — `/` 단일 엔트리. `lastModified` 생략(단일 URL에 의미 없고 빌드 재현성 유지).
6. `apps/web/src/app/opengraph-image.tsx` (+ `twitter-image.tsx` 재export) — ImageResponse 빌드타임 생성.
7. `apps/web/public/llms.txt` — llms.txt 관례(H1 + 요약 인용문 + 링크 섹션). 서비스 요약, 랜딩·Instagram·문의 이메일 링크. 한국어, 금지 카피 톤 준수.

### 기존 파일 수정

8. `apps/web/src/app/layout.tsx` — metadata를 `buildRootMetadata()`로 교체.
9. `apps/web/src/app/page.tsx` (랜딩) — `"use client"` 제거하고 서버 컴포넌트로 전환. 클라이언트 로직(로그인 시 `/home` replace 포함)은 자식 클라이언트 컴포넌트로 추출(렌더 결과·동작 동일 유지). 페이지 metadata(canonical `/`) + JSON-LD 3종 `<script type="application/ld+json">` 삽입.
10. `apps/web/src/app/login/page.tsx` — 동일 패턴으로 서버 컴포넌트 전환(기존 `<Suspense>` 경계 유지). metadata: title `로그인`, noindex.
11. `/terms`, `/home`, `/practice`, `/practice/new`, `/practice/history`의 각 `page.tsx` — 서버 컴포넌트화(필요 시 클라이언트 래퍼 추출) + `buildNoindexMetadata()` export.

### 테스트 (node:test, `tests/*.test.mjs`, ts-module-loader 상대 import)

12. `tests/seo-metadata.test.mjs` — site-metadata 빌더: 기본값(도메인·title·template·description), `NEXT_PUBLIC_SITE_URL` 오버라이드 동작, noindex 빌더의 robots 플래그.
13. `tests/seo-json-ld.test.mjs` — 3종 빌더: `@context`/`@type` 정확성, offers price `"0"`·KRW, sameAs에 추적 파라미터 없는 Instagram URL, 이메일, undefined 값 없음, JSON 직렬화 가능.
14. `tests/seo-routes.test.mjs` — robots()·sitemap() 반환값: disallow 목록, sitemap URL, 단일 엔트리.
15. `tests/seo-noindex-guard.test.mjs` — 소스 스캔 가드(기존 product-language-guard 스타일): `src/app/**/page.tsx` 중 랜딩을 제외한 전부가 noindex 빌더를 참조하는지, 랜딩은 참조하지 않는지. `public/llms.txt` 존재·비어있지 않음·`acttub.com` 포함 검증도 이 파일에 포함.

## 완료 기준 체크리스트

- [ ] `pnpm build` 후 `out/`에 `robots.txt`·`sitemap.xml`·`llms.txt`·OG 이미지 파일이 생성된다.
- [ ] `out/index.html`에 canonical(`https://acttub.com/`), og:title·og:description·og:image(절대 URL), twitter card 메타, JSON-LD 3종이 포함된다.
- [ ] `out/login.html`·`terms.html`·`home.html`·`practice.html`·`practice/new.html`·`practice/history.html`에 noindex 메타가 포함된다.
- [ ] `sitemap.xml`에 `https://acttub.com/` 단일 URL만 있다.
- [ ] `robots.txt`에 `/v2/`·`/health` disallow와 `Sitemap:` 라인이 있다.
- [ ] `NEXT_PUBLIC_SITE_URL` 오버라이드가 테스트로 검증된다.
- [ ] `pnpm lint`·`pnpm typecheck`·`pnpm --filter web test`(product-language-guard 포함) 전부 통과.
- [ ] 랜딩·로그인 기존 동작 회귀 없음: 로그인 상태에서 `/` 접근 시 `/home` replace, `/login?next=` 플로우, `<Suspense>` 경계 유지.

## 하지 말 것 (스코프 제한)

- `apps/api` 변경 금지 (서빙 로직이 이미 지원함).
- 랜딩의 보이는 UI·카피 변경 금지 (서버 컴포넌트 래핑과 JSON-LD 삽입만 허용, 렌더 결과 동일 유지).
- manifest / PWA / FAQ 섹션 / hreflang(다국어) 추가 금지.
- www→apex 리다이렉트 등 인프라·DNS 설정 다루지 않음.
- 생성물(`v2-schema.d.ts`, `out/`, `node_modules/` 등) 수정 금지.
- 스코프 밖 리팩터링 금지 (서버 컴포넌트 전환은 metadata export에 필요한 최소 범위만).

## 미결 사항

- **ImageResponse × 정적 export 호환**: 빌드타임 생성이 되는 것으로 파악되나 Phase 4 빌드에서 최종 확인. 실패 시 대안: PNG를 사전 생성해 `public/`에 커밋하고 metadata에서 참조.
- **Render에서 www→apex 301 리다이렉트 동작 여부**: 배포 시 확인 (인프라, 이 작업 범위 밖).
- **Google Search Console 소유 확인 + sitemap 제출**: 배포 후 사용자 후속 작업. 필요 시 verification 메타는 추후 추가.
- **로고 이미지 자산 부재**: Organization.logo 생략. 로고가 생기면 추가.

## 검증 명령

- `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build`
- 빌드 산출물 확인: `out/robots.txt`·`out/sitemap.xml`·`out/llms.txt`·OG 이미지 존재, `out/index.html`의 canonical·OG·JSON-LD, noindex 페이지들의 메타 grep.
- 수동 확인: dev 루프(:3000)에서 랜딩·로그인 플로우 회귀 확인.
