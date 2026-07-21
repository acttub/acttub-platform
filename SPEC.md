# SPEC: SEO / AEO / GEO 설정 (apps/web)

기준 커밋: `722626c` · 브랜치: `feat/seo-aeo-geo`

## 배경 / 목적

`apps/web`은 SEO·AEO·GEO 관점에서 백지 상태다. metadata는 루트 layout의 title/description 두 줄뿐이고, robots.txt·sitemap.xml·OG 이미지·canonical·JSON-LD·llms.txt가 전부 없다. `public/` 디렉토리 자체가 존재하지 않는다.

목적: 검색엔진(SEO), 답변엔진(AEO), 생성형 엔진(GEO)이 Acttub을 정확히 이해·인용하도록 기반 설정을 갖춘다. 실제 인덱싱 가치가 있는 공개 페이지는 랜딩(`/`) 하나이므로, 랜딩에 신호를 집중하고 나머지는 noindex로 정리한다.

전제 (조사·Codex 비판으로 확인됨):

- FastAPI 서빙 로직(`apps/api/.../app.py:239` catch-all)은 `out/` 루트의 정확 일치 파일을 우선 반환한다 → robots.txt 등은 **파일 생성만으로 서빙됨, 백엔드 변경 불필요**.
- `out/`에 `practice/new.html`, `practice/history.html` 등 페이지별 HTML이 개별 생성된다 → 페이지별 메타가 산출물에 반영된다.
- Next 16.2.10. `robots.ts`/`sitemap.ts`/`opengraph-image.tsx`는 정적 export에서 빌드타임 정적 파일로 생성된다(문서상 지원, 최종 확인은 빌드).
- **`/terms`·`/home`·`/practice/new`·`/practice/history`의 page.tsx는 이미 서버 컴포넌트다** (클라이언트 경계는 feature 내부). 전환 리팩터가 필요한 것은 랜딩(`/`)과 `/practice` 스텁뿐이며, `/login`은 layout으로 우회한다.
- Next 16.2.10의 ImageResponse 기본 폰트는 **Latin 전용**이며, 한국어 감지 시 빌드 중 Google Fonts에서 Noto Sans KR를 네트워크로 받아오고 **실패해도 한국어가 빠진 PNG를 성공으로 생성**한다 → 로컬 폰트 주입 필수.
- `tests/product-language-guard.test.mjs`가 `src/` 전체에서 금지 카피(점수·판정·등급·레벨·강점·약점·개선점 계열 + score/grade/rate/level/judge/improvement 등)를 검사한다 → 새 metadata·JSON-LD·OG 카피도 통과해야 한다. 확정 카피 5종은 금지 regex 비저촉 확인됨.
- `tests/login-provider-defaults.test.mjs`가 `login/page.tsx` 내부 구현을 직접 검사한다 → 로그인 페이지는 손대지 않는 설계를 택한다.

## 확정된 결정 (사용자 승인)

| 항목 | 결정 |
|---|---|
| 정식 도메인 | `https://acttub.com` (www 없음). www는 인프라에서 apex로 리다이렉트 |
| 사이트 URL 주입 | `NEXT_PUBLIC_SITE_URL` 빌드타임 env, 미설정 시 기본값 `https://acttub.com`. **정규화 필수** (아래 설계 §2) |
| 기본 title | `Acttub — 질문으로 다시 보는 연기 연습` |
| title template | `%s \| Acttub` |
| description | `내 연기 영상을 올리면 장면 맥락에서 확인한 단서가 질문으로 돌아와요. 질문으로 연기 장면을 다시 생각하는 연습 도구예요.` |
| 인덱싱 범위 | 랜딩(`/`)만 index 허용. `/login`, `/terms`, `/home`, `/practice`, `/practice/new`, `/practice/history` 전부 noindex 메타 |
| sitemap | `https://acttub.com/` 단일 URL |
| JSON-LD | `WebSite` + `SoftwareApplication` + `Organization` (랜딩에만) |
| Organization | 이름 Acttub, url, `sameAs: ["https://www.instagram.com/acttub_com/"]` (추적 파라미터 제거), 이메일 `acttub0527@gmail.com`. logo는 자산 없음 → 생략 |
| SoftwareApplication | `offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" }` (현재 무료 확인됨) + 필수·권장 필드 (설계 §3) |
| OG 이미지 | `opengraph-image.tsx` ImageResponse 코드 생성. 1200×630, 어두운 단색 배경 + `Acttub` + 태그라인 `질문으로 다시 보는 연기 연습`. 색상은 globals.css 브랜드 색과 일치. 장식 없음. **로컬 한국어 폰트 주입** |
| GEO | `public/llms.txt` 포함. manifest·FAQ 섹션 제외 |

## 설계

### 새 파일

1. `apps/web/src/lib/config/env.ts` — `NEXT_PUBLIC_SITE_URL` 항목을 주석으로 문서화(env.ts가 선택 변수의 단일 문서라는 기존 규칙 준수). 실제 해석·정규화는 seo 모듈(§2)이 담당.
2. `apps/web/src/lib/seo/site-metadata.ts` — 플레인 TS 모듈(next 런타임 비의존, node:test 직접 테스트 가능).
   - `resolveSiteUrl(raw?: string): string` — `new URL()`로 http(s) URL 검증, trailing slash 제거 정규화. 빈 값·공백·비정상 scheme이면 기본값 `https://acttub.com` 사용.
   - `buildRootMetadata(siteUrl?)` — metadataBase, title(default + template), description, openGraph(siteName·locale `ko_KR`·type `website` — **url 없음**), twitter(card `summary_large_image`). **canonical·openGraph.url을 루트에 두지 않는다** (metadata 상속으로 모든 noindex 페이지에 랜딩 canonical이 전파되는 오신호 방지).
   - `buildLandingMetadata(siteUrl?)` — 랜딩 전용: `alternates.canonical: "/"` + `openGraph.url`.
   - `buildNoindexMetadata(title?)` — `robots: { index: false, follow: false }`.
   - siteUrl은 **인자 주입** 방식(기본값은 호출 시 `process.env.NEXT_PUBLIC_SITE_URL`을 `resolveSiteUrl`로 해석) — module-time 상수 캐시로 인한 테스트 불성립 문제 회피.
3. `apps/web/src/lib/seo/json-ld.ts` — 순수 빌더 3종, `@context: "https://schema.org"`, **stable `@id`로 상호 연결** (예: Organization `#org`, WebSite `#website`(publisher→`#org`), SoftwareApplication `#app`).
   - `buildOrganizationJsonLd(siteUrl?)` — name `Acttub`, url, sameAs(Instagram), email.
   - `buildWebSiteJsonLd(siteUrl?)` — name, url, inLanguage `ko`, publisher `@id`.
   - `buildSoftwareApplicationJsonLd(siteUrl?)` — name, url, description(확정 카피), applicationCategory `EducationalApplication`, operatingSystem `Web`, offers `{ "@type": "Offer", price: "0", priceCurrency: "KRW" }`, publisher `@id`. rating/review가 없으므로 rich result 자격은 기대하지 않는다(aggregateRating 등 허위 필드 금지).
4. `apps/web/src/app/robots.ts` — 전체 허용 + `/v2/`·`/health` disallow + `Sitemap:` 라인. noindex는 robots.txt가 아니라 메타태그 담당(크롤러가 noindex를 읽으려면 크롤 허용 필요).
5. `apps/web/src/app/sitemap.ts` — `/` 단일 엔트리. `lastModified` 생략(단일 URL에 의미 없고 빌드 재현성 유지).
6. `apps/web/src/app/opengraph-image.tsx` — ImageResponse 빌드타임 생성. **리포에 커밋한 한국어 폰트 서브셋**(Noto Sans KR 계열, OFL 라이선스, ttf/otf — 태그라인 렌더에 필요한 최소 서브셋 권장)을 Node fs로 읽어 `fonts` 옵션에 주입(빌드 네트워크 의존 제거). `alt`·`size`(1200×630)·`contentType` export 포함. `twitter-image.tsx`는 default·alt·size·contentType 전부 재export.
7. `apps/web/public/llms.txt` — llms.txt 관례(H1 + 요약 인용문 + 링크 섹션). 서비스 요약, 랜딩·Instagram·문의 이메일 링크. 한국어, 금지 카피 톤 준수.

### 기존 파일 수정

8. `apps/web/src/app/layout.tsx` — metadata를 `buildRootMetadata()`로 교체 (canonical·og.url 없음).
9. `apps/web/src/app/page.tsx` (랜딩) — `"use client"` 제거하고 서버 컴포넌트로 전환. 클라이언트 로직(로그인 시 `/home` replace 포함)은 자식 클라이언트 컴포넌트로 추출(렌더 결과·동작 동일 유지). `buildLandingMetadata()` export + JSON-LD 3종 `<script type="application/ld+json">` 삽입.
10. `apps/web/src/app/login/layout.tsx` **신설** — metadata(title `로그인`, noindex)만 export. **`login/page.tsx`는 수정하지 않는다** (`tests/login-provider-defaults.test.mjs`가 내부 구현을 검사하므로).
11. `/terms`, `/home`, `/practice/new`, `/practice/history`의 각 page.tsx — **이미 서버 컴포넌트이므로 `buildNoindexMetadata()` export만 추가**. `/practice` 스텁(클라이언트 리다이렉트)만 최소 분리: 서버 page.tsx가 noindex metadata를 export하고 리다이렉트 로직은 작은 클라이언트 자식으로 추출.

### 테스트 (node:test, `tests/*.test.mjs`, ts-module-loader 상대 import)

12. `tests/seo-metadata.test.mjs` — `resolveSiteUrl`: 기본값, 정상 오버라이드, trailing slash 제거, 빈 값·공백·비정상 scheme 폴백. 빌더: 인자 주입으로 기본값·오버라이드 검증(env 조작 불필요), 루트 metadata에 canonical·og.url 부재, 랜딩 metadata에 canonical 존재, noindex 빌더의 robots 플래그.
13. `tests/seo-json-ld.test.mjs` — 3종 빌더: `@context`/`@type`/`@id` 연결 정확성, SoftwareApplication의 name·url·description·applicationCategory·operatingSystem, offers의 `@type: Offer`·price `"0"`·KRW, sameAs에 추적 파라미터 없는 Instagram URL, 이메일, undefined 값 없음, JSON 직렬화 가능.
14. `tests/seo-routes.test.mjs` — robots()·sitemap() 반환값: disallow 목록, sitemap URL, 단일 엔트리.
15. `tests/seo-noindex-guard.test.mjs` — 소스 스캔 가드: 랜딩을 제외한 모든 `src/app/**/page.tsx`(또는 이를 담당하는 layout)가 **`export const metadata = buildNoindexMetadata(` 형태의 실제 export**를 갖는지 검사(단순 참조 검사 금지). 랜딩은 noindex 미참조 + `buildLandingMetadata` export 검사. `public/llms.txt` 존재·비어있지 않음·`acttub.com` 포함 검증 포함.
16. 금지 카피 가드 확장 — `public/llms.txt`도 금지어 검사 대상에 포함(기존 `product-language-guard.test.mjs`의 스캔 대상 확장 또는 동일 금지어 목록을 공유 헬퍼로 추출, 구현 재량).

## 완료 기준 체크리스트

- [ ] `pnpm build` 후 `out/`에 `robots.txt`·`sitemap.xml`·`llms.txt`·OG 이미지 파일이 생성된다.
- [ ] `out/index.html`에 canonical(`https://acttub.com/`), og:title·og:description·og:image(절대 URL)·og:image:alt·og:image:type·og:image:width/height, twitter card 메타, JSON-LD 3종이 포함된다.
- [ ] noindex 페이지들의 HTML(`login.html`·`terms.html`·`home.html`·`practice.html`·`practice/new.html`·`practice/history.html`)에 robots noindex 메타가 있고, **canonical·og:url이 랜딩 값으로 상속되어 있지 않다**.
- [ ] 생성된 OG 이미지 PNG에 한국어 태그라인이 실제로 렌더된다(빌드 후 이미지 확인).
- [ ] `sitemap.xml`에 `https://acttub.com/` 단일 URL만 있다.
- [ ] `robots.txt`에 `/v2/`·`/health` disallow와 `Sitemap:` 라인이 있다.
- [ ] `resolveSiteUrl` 정규화(기본값·오버라이드·이상값 폴백)가 테스트로 검증된다.
- [ ] `pnpm lint`·`pnpm typecheck`·`pnpm --filter web test`(product-language-guard, 기존 login-provider-defaults 포함 전부) 통과.
- [ ] 랜딩·로그인 기존 동작 회귀 없음: 로그인 상태에서 `/` 접근 시 `/home` replace, `/login?next=` 플로우, `<Suspense>` 경계 유지, `login/page.tsx` 무변경.

## 하지 말 것 (스코프 제한)

- `apps/api` 변경 금지 — 단 하나의 예외: 확장자 없는 metadata 파일의 Content-Type 판별 보강(Phase 4 처리 기록 참조, 사용자 승인).
- `login/page.tsx` 수정 금지 (layout으로 우회).
- 랜딩의 보이는 UI·카피 변경 금지 (서버 컴포넌트 래핑과 JSON-LD 삽입만 허용, 렌더 결과 동일 유지).
- manifest / PWA / FAQ 섹션 / hreflang(다국어) 추가 금지.
- JSON-LD에 aggregateRating 등 실체 없는 필드 추가 금지.
- www→apex 리다이렉트 등 인프라·DNS 설정 다루지 않음.
- 생성물(`v2-schema.d.ts`, `out/`, `node_modules/` 등) 수정 금지.
- 스코프 밖 리팩터링 금지 (컴포넌트 전환은 metadata export에 필요한 최소 범위만).

## Codex 설계 비판 처리 기록 (Phase 2, 2026-07-21)

- **수용 #1(high)**: canonical·og.url 루트 상속 오신호 → 랜딩 전용 `buildLandingMetadata`로 분리.
- **수용 #2(high)**: `/login` 추출 시 `login-provider-defaults.test.mjs` 파손 → `login/layout.tsx` metadata 우회, 페이지 무변경.
- **수용 #3(high)**: ImageResponse 한국어 폰트가 빌드 네트워크 의존 + 실패 시 무음 → 로컬 폰트 서브셋 커밋·주입, 렌더 확인을 완료 기준에 추가.
- **수용 #4(medium)**: module-time 상수 캐시로 env 오버라이드 테스트 불성립 → 빌더 인자 주입 방식.
- **수용 #5(medium)**: 4개 페이지는 이미 서버 컴포넌트(스펙 사실 정정) → metadata export만, 전환은 랜딩·`/practice` 스텁만.
- **부분 수용 #6(medium)**: noindex 가드를 실제 export 형태 검사로 강화. 빌드 산출물 HTML 검사는 자동 테스트가 아닌 Phase 4 검증 절차로(테스트 스위트에 빌드 의존 배제).
- **수용 #7(medium)**: `resolveSiteUrl` 정규화 + 이상값 폴백 + 테스트.
- **수용 #8(medium)**: SoftwareApplication 필드 보강(applicationCategory·operatingSystem·Offer @type·@id 연결), rich result 비기대 명시.
- **수용 #9(low)**: OG alt·size·contentType export + twitter-image 전체 재export.
- **수용 #10(low)**: llms.txt 금지 카피 검사 포함.

## Phase 4 실행 검증 처리 기록 (2026-07-21)

- lint·typecheck·웹 테스트 79/79·빌드·산출물 체크리스트 전부 통과. OG PNG(1200×630, 28KB)의 한국어 태그라인 렌더를 이미지로 직접 확인.
- **결함 발견·수정(사용자 승인)**: Next가 OG 이미지를 확장자 없는 `out/opengraph-image`로 내보내 FastAPI `FileResponse`가 `application/octet-stream`으로 서빙(실측). "백엔드 변경 불필요" 전제가 이 케이스에서 깨짐 → `app.py`에 PNG 매직 바이트 기반 `_extensionless_media_type` 보강 + `tests/test_static_frontend.py` 신설(4건). 수정 후 실서빙 재실측: `/opengraph-image`·`/twitter-image` → `image/png`. acting-api pytest 228 passed.
- ImageResponse × 정적 export 호환 미결 사항 해소: 빌드타임 정적 생성 확인됨.

## 미결 사항
- **Render에서 www→apex 301 리다이렉트 동작 여부**: 배포 시 확인 (인프라, 이 작업 범위 밖).
- **Google Search Console 소유 확인 + sitemap 제출**: 배포 후 사용자 후속 작업. 필요 시 verification 메타는 추후 추가.
- **로고 이미지 자산 부재**: Organization.logo 생략. 로고가 생기면 추가.

## 검증 명령

- `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build`
- 빌드 산출물 확인: `out/robots.txt`·`out/sitemap.xml`·`out/llms.txt`·OG 이미지 존재, `out/index.html`의 canonical·OG(alt/type/size 포함)·JSON-LD, noindex 페이지들의 메타 grep + canonical 미상속 확인, OG PNG 한국어 렌더 확인.
- 수동 확인: dev 루프(:3000)에서 랜딩·로그인 플로우 회귀 확인.
