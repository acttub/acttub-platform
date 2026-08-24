# TODO

- [x] 압축 스펙 반영하기 (feat/upload-compression — 클라이언트 압축 50MB 목표·게이트 100MB·5분)
- [ ] S3 저장 폴더 구조가 합당한지 체크하기
- [ ] 영상 분석 이후 분석 결과는 보여주지 않고 갖고만 있기
- [ ] 채팅할 때 한글 마지막 한 글자 남는 문제 고치기 (IME 조합 이슈로 추정)
- [ ] 리포트 삭제 API 만들기 (연습 세션당 리포트 1개 제약과 연동 — 삭제 시 해당 세션 재코칭·재리포트 허용, 세션 소프트 삭제와의 관계 정의)
- [ ] 이전 기록 API 개편: `GET /v2/reports/{practice_session_id}` 신설(리포트 본문+playback_url 한 번에) + `GET /v2/reports` 목록 슬림화(`practice_session_id`·`headline`·`created_at`만) — 상세 신설과 같은 PR에서 진행
- [x] `GET /v2/practice-sessions/{id}/status` 폴링 경량 엔드포인트 신설 — 분석 대기 폴링이 상세 응답·presign 발급 없이 `{status, error_code}`만 받도록
- [ ] 미완료 연습 이어가기 별도 페이지(리포트 없는 세션 조회 + 이어가기 UI)
- [ ] 쓸데없는 파일들 제거하기 (안 쓰는 산출물·죽은 코드·불필요 문서 정리) — 웹·API 죽은 코드는 실행 4단계가 전부 끝났다(기록: [docs/archive/REFACTOR-web-api.md](docs/archive/REFACTOR-web-api.md)). 그 문서가 남긴 관찰 중 중복 헬퍼 3종은 아직 살아 있다
- [ ] 원본이 10MB 이하면 압축 생략하고 그대로 업로드 (모바일 `lib/compress.ts`는 목표 6MB, 웹 `lib/media/compress-video.ts` — 작은 파일은 압축 이득보다 인코딩 대기·품질 손실이 커서 스킵)
- [ ] 이름 입력은 최초 회원가입 때만 받기 (`apps/mobile/app/consent.tsx` — 지금은 동의 화면이 이름 입력을 항상 끼고 있고 `canProceed`가 `name.trim().length > 0`을 요구해서, 약관이 추가돼 재동의할 때도 이름을 다시 입력해야 한다. 이미 이름이 있으면 입력란을 숨기고 동의만 받도록 분리. 현재 이름은 로컬 저장(`lib/profile.ts`)이라 백엔드 프로필 API가 생기면 "최초"의 기준을 서버 값으로 옮길 것)
- [ ] S3 instance role 전환을 며칠 관찰한 뒤 공유 IAM 사용자 `acting-api` access key를 Inactive로 전환하고, 추가 관찰 후 삭제하기 (secret은 복구 불가하므로 즉시 삭제하지 않음)
- [x] 영상 버킷의 `DeleteObject`·`ListBucket` 권한 누락 해결 (2026-08-04). 코드 변경 없이 IAM 정책만 고쳤다 — dev는 인라인 `acttub-dev-videos-s3`, 운영은 관리형 `acttub-video-s3-access` v4. 이제 분석 워커의 만료 intent 정리가 실제로 지우고, 없는 객체 `HeadObject`가 403 대신 404를 받아 `upload_not_found`(409)가 정상 반환된다. 각 role은 여전히 자기 버킷만 허용하므로 dev↔운영 경계는 그대로다(양쪽에서 반대편 head·list·put이 403인 것을 확인)

## 모바일 인증·분석 동시성 — 실기기 검증 필요 (feat/report-and-mobile-fixes 후속)

2026-07-23 작업에서 M5(분석 복구)·M6(idempotent 재시도)·M7(취소)를 구현하며 인증
자격증명과 작업 소유권 구조를 새로 넣었다. adversarial 리뷰를 4라운드 돌렸고 매 라운드
실제 결함이 나왔다(4→3→3→3건). 정적 리뷰만으로는 수렴하지 않는 영역이라 아래는
**실기기 확인 후에 닫아야 한다.**

- [ ] M7 실기기 검증: `uploadAsync` → `createUploadTask` 교체가 iOS·Android에서 정상 동작하는지. 압축·PUT·API 대기·폴링 각 단계에서 화면을 이탈했다 재진입했을 때 중복 pipeline이나 좀비 작업이 없는지
- [ ] M5 실기기 검증: 분석 중 앱을 강제 종료한 뒤 재실행하면 분석 화면으로 복귀해 폴링이 재개되는지. 계정 전환·이미 삭제된 세션(404)에서 무한 루프가 없는지
- [ ] `react-native-compressor` 취소가 캐시에 부분 파일을 남기는지 실기기 확인 (리뷰 시점엔 hypothesis였음). 남는다면 압축 산출물만 정리하고 원본 URI는 절대 삭제하지 말 것
- [ ] AuthProvider 이벤트 → recovery owner 전환을 잇는 React behavioral 통합 테스트 추가 (현재는 credential queue·API·state machine 단위로만 검증됨)
- [ ] 모바일 검증 명령을 package script로 승격 (`node --test tests/`·`npx tsc --noEmit`이 현재 어디에도 등록돼 있지 않아 사람이 기억해야 함)

## CI/CD 자동화 (GitHub Actions, 2026-07-24~)

Phase 1(PR 게이트)까지 도입 완료. 그 전엔 CI 전무·전부 수동 SSH 배포였다
(`docs`가 아니라 [dev-server-deploy]/[prod-server-deploy] 메모 참고).

- [x] Phase 1 PR 게이트 (#36): `.github/workflows/ci.yml` — dev·main 대상 PR에서 web(lint·typecheck·test·build)·api(pytest + `postgres:16-alpine` service로 `RUN_DB_TESTS=1` DB 통합) 검증. ruleset에 두 잡을 required status check로 등록해 초록이어야 머지. (함정: check context = 잡 이름 문자열 그대로라, `ci.yml` 잡 `name` 변경 시 ruleset도 함께 갱신 안 하면 dev·main 머지가 전부 막힌다)
- [x] Phase 2 배포 자동화 (#71, 후속): `.github/workflows/deploy.yml` 하나가 dev·prod를 모두 처리. 빌드는 runner에서(재현성 확보), 전송은 S3, 설치는 SSM Run Command라 SSH 키·서버 IP를 Secrets에 두지 않는다. dev는 `dev` push 자동(마이그레이션 포함)·운영은 `workflow_dispatch`. 환경 분기는 워크플로가 아니라 GitHub Environments variables가 담당. 절차는 `docs/DEPLOY-VPC.md`(운영)·`docs/DEPLOY-DEV.md`(개발)
  - [x] 개발 서버를 단일 EC2 구성으로 신설 → 검증 → `dev.acttub.com` DNS 전환 (#77, 2026-08-04). 구 인스턴스(`3.38.235.185`)는 **다른 AWS 계정**에 있어 그쪽에서 폐기해야 한다
  - [x] 운영 role 신뢰 정책의 `sub` 조건을 `environment:prod`로 좁힘 (2026-08-04). GitHub `prod` 환경을 먼저 만들어야 동작한다 — 없는 상태로 좁히면 다음 운영 배포가 assume 단계에서 실패
- [ ] Phase 3 env 단일화: dev/prod `.env` 드리프트 근절(2026-07-23 dev에만 있던 `APPLE_OAUTH_CLIENT_ID`로 운영 웹 Apple 로그인만 401 난 사고) — GitHub Environments secret을 단일 소스로 배포 시 렌더링. systemd 유닛(`acting-api.service`)을 레포로 편입 + `daemon-reload`
- [x] `Node.js 20 deprecated` 경고 제거 (#79): checkout v7 · setup-node v7 · action-setup v6 · configure-aws-credentials v6 · setup-uv **v9.0.0**. (함정: `astral-sh/setup-uv`는 v8부터 메이저 별칭 태그(`vN`)를 발행하지 않아 `@v9`로는 액션을 찾지 못한다 — 정확한 버전으로 고정할 것)

## 웹 성능 예산 미달 (2026-08-04 발견)

`pnpm perf`(Lighthouse CI)가 **LCP 임계값을 초과해 실패하는 상태**다. CI에는 성능 측정이 없어 그동안 드러나지 않았다. 새로 생긴 문제가 아니다 — 정적 export 시절 측정 방식(`staticDistDir`)으로도 같은 값이 나오는 것을 3회씩 비교해 확인했다(2527ms 대 2530ms).

```
LCP 실측 2527~2530ms   vs   예산 2500ms      (Performance 점수 0.97, CLS 0, TBT 0은 통과)
LCP 구성: TTFB 452 + Render Delay 2078       LCP 요소는 랜딩 `<h1>`
```

- [ ] 방향 결정 후 처리. 둘 중 하나다
  - **임계값 현실화**(2500 → 2600): 실측이 30ms 초과라 사실상 경계값이다. 간단하지만 근본 해결은 아니다
  - **렌더 지연 개선**: Render Delay 2078ms가 대부분이다. `<h1>`이 하이드레이션 이후에 최종 렌더되는 구조라, 초기 HTML에서 바로 확정되게 바꾸면 크게 떨어진다. 프론트 렌더 구조를 손대는 일이라 범위가 있다
- [ ] 결정 후 `apps/web/PERFORMANCE.md`의 허용 기준도 함께 맞춘다
