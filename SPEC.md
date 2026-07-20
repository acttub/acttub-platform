# SPEC: 업로드 영상 클라이언트 압축 + 용량 게이트 100MB (TODO 1)

기준 커밋: `fe99977` · 브랜치: `feat/upload-compression`

## 배경 / 목적

- 현재 업로드는 브라우저 → S3 presigned PUT 직접 업로드이며 상한 550MB. 원본이 그대로 저장·재생되고, 서버는 Gemini 분석 직전에만 ffmpeg로 압축한다(`acting-summary/compress.py`).
- 550MB 원본 업로드는 모바일 회선에서 느리고 저장 비용이 크다. 프론트에서 재생 품질을 지키는 수준으로 압축해 **결과물 50MB를 목표(soft target)**로 하고, 백엔드는 **100MB 초과를 거부**하는 경성 게이트로 바꾼다. (mediabunny의 bitrate는 목표치라 인코더 overshoot로 50MB를 다소 넘을 수 있음 — Codex 비판 #2 수용, 사용자 결정)
- 핵심 제약: **S3에 저장된 파일이 곧 재생본**이다(`presign_playback`). 따라서 압축 스펙은 Gemini용(768px/10fps)이 아니라 재생 품질 유지형(긴 변 1280px/≤30fps)으로 잡는다. Gemini용 축소는 지금처럼 서버가 분석 직전에 수행한다.
- 길이 상한은 3분 → **5분**으로 변경한다. 5분 상한은 **클라이언트 검증 한정**이다(백엔드는 기존처럼 duration을 검증하지 않음 — 합의 사항, Codex #10b 기각).
- **실제 업로드 화면은 `practice-single.tsx`(PracticeSingle)다** — `/practice/new`가 이를 렌더링한다. `practice-flow.tsx`(PracticeFlow)는 `/home`·`/practice/history` 전용이며 그 업로드 경로는 라우트에 연결되지 않는다. (Codex #1 수용 — 검증 완료)

## 설계

### 프론트 (apps/web)

1. **공통 업로드 준비 함수**: 검증(타입·길이) → 압축/스킵/폴백 → 게이트 확인을 하나의 공통 preflight로 묶어 `PracticeSingle`(실사용)과 `PracticeFlow.begin()`(비활성 경로) 둘 다 이를 사용하게 한다. 입력 검증: MP4/MOV(`video/mp4`·`video/quicktime`) + **길이 5분 이하**. **원본 용량 상한(550MB)은 제거.**
2. **압축 모듈 신설** — `src/lib/media/` 아래(파일 구성은 구현 재량):
   - 라이브러리: **mediabunny v1.50.9** (선행 설치됨). 압축 시점에 **dynamic import**로 로드.
   - **스킵**: 원본 ≤ 50MB면 재인코딩 없이 원본 그대로 업로드. (≤50MB HEVC도 스킵 — 재생 호환성은 기존과 동일하다는 합의로 Codex #9 기각)
   - **입력**: `Input` + `BlobSource`, `formats: [MP4, QTFF]` (`ALL_FORMATS` 금지 — 번들 축소, Codex #14).
   - **트랙**: `tracks: "primary"` 명시 (다중 트랙 시 비트레이트 예산 붕괴 방지, Codex #3).
   - **출력 스펙**: `Mp4OutputFormat`(faststart) + `BufferTarget`. H.264(`avc`) + AAC. 해상도는 per-track callback에서 `getDisplayWidth()/getDisplayHeight()` 기준 **긴 변 1280px**(종횡비 유지, 업스케일 금지 — mediabunny가 짝수 처리). 프레임레이트는 `computePacketStats().averagePacketRate`가 **30 초과일 때만 `frameRate: 30` 지정, 그 외 생략**(VFR 원본 타이밍 유지, Codex #8).
   - **오디오**: AAC 128kbps. WebCodecs가 소스의 실제 채널 수·샘플레이트로 AAC 인코딩 가능한지 `canEncodeAudio()`로 확인하고, 불가하면 `@mediabunny/aac-encoder`의 `registerAacEncoder()`를 동적 import로 등록(Codex #7). 원본 채널·샘플레이트 유지가 불가능하면 mediabunny의 2ch/48kHz 자동 재시도를 허용한다.
   - **길이 적응형 비트레이트**: `videoBitrate = min(2_000_000, floor(0.95 × 50MB × 8 / durationSec) − 128_000)`. 계산 로직(해상도·비트레이트·스킵 판단)은 **순수 함수로 분리**해 node 테스트 가능하게 한다. 테스트 대상 모듈은 `@/` 별칭 없이 상대 경로로 import 가능한 `.ts` 파일이어야 한다(테스트 로더 제약).
   - **결과 검증**: `isValid` 확인 + **primary video 트랙이 출력에 존재해야 하고, 입력에 오디오가 있었는데 출력에서 discard됐으면 실패로 간주해 원본 폴백**(무음 업로드 방지, Codex #4). 압축 결과가 원본보다 크면 원본 사용.
   - **진행률**: `onProgress`(0~1)를 UI 콜백으로 전달하되 **99%로 캡**하고, `execute()` resolve 후에만 100%·다음 단계 전환(Codex #13).
   - **취소**: AbortSignal 연동. `ConversionCanceledError`와 abort로 인한 예외는 **원본 폴백 대상에서 제외**하고 DOM `AbortError` 의미로 전파한다. 각 await 경계에서 `signal.aborted`를 확인한다(Codex #5). 취소 버튼 UI는 이번 스코프에서 제외(unmount/이탈 시 abort만) — 사용자 결정.
   - **폴백**: WebCodecs 미존재(`typeof VideoEncoder === "undefined"` 등), `isValid` 실패, 트랙 discard, 변환 중 예외(취소 제외) → **원본 그대로 업로드 경로로 폴백**.
3. **업로드 게이트**: 실제 업로드할 파일(압축본 또는 폴백 원본)이 **100MB 초과면 업로드 중단** + 안내 카피(브라우저 변경 또는 파일 축소 유도, 한국어 존댓말, `product-language-guard` 준수).
4. **`env.ts` 상수**: `MAX_UPLOAD_BYTES = 100MB`(백엔드 게이트 미러, 주석 갱신), `MAX_DURATION_MS = 300_000`. 압축 관련 상수(목표 50MB, 스킵 50MB, 2Mbps, 128k, 1280px, 30fps)는 압축 모듈에 둔다.
5. **UI — `practice-single.tsx`(주 대상)**:
   - 제출 시 **선택된 파일의 duration을 await로 확정 후 검증**한다. 새 파일 선택 시 이전 `durationMsRef` 잔존·metadata 미로드 제출 race를 제거한다(Codex #10a — 기존 버그 수정).
   - 제출 흐름: 길이 확인 → 압축(진행률 "압축 중" 단계 표시) → 게이트 확인 → `uploadVideo()`(압축본은 `video/mp4`, AbortSignal·업로드 진행률 연결).
   - "서버 처리 30~120초" 고정 카피를 제거하거나 단계 기반 표현으로 교체(Codex #11 — timeout 600초와 모순).
6. **UI — `practice-flow.tsx`(비활성 경로 정합성)**: 550MB 검사·카피(173·301·1038행) 제거/갱신, 길이 카피 상수 유도("5분"), `begin()`이 공통 preflight를 사용. 드롭존 카피는 용량 언급 없는 "MP4 · MOV · 5분 이내" 계열로.

### 백엔드 (apps/api)

7. `acting-api/src/acting_api/uploads.py`: `MAX_UPLOAD_BYTES = 100 * 1024 * 1024`. 검증·에러(413 `upload_too_large`)·presign 구조는 그대로. intent의 `duration_ms`는 source duration 의미로 유지(Codex #12 기각 — worker 미사용, 계약 주석만).
8. `acting-summary/src/acting_summary/compress.py`: `TIMEOUT_SEC = 600.0`(5분 영상 대응, 초과 시 원본 사용 폴백은 그대로). 압축 스펙(768px/10fps 등) 변경 없음.
9. `acting-summary/router.py`의 legacy `/summarize` 한도(550MB)는 **변경하지 않는다**(별도 계약, 스코프 밖).

### 계약 / 문서

10. openapi.json에는 용량 수치가 없어 스키마 변경 없음이 예상된다. 확인 차 스펙 재생성 후 **diff 없음을 검증**한다(diff가 생기면 웹 타입 재생성 포함 같은 커밋에 반영).
11. 문서 내 550MB·3분 언급 현행화: `apps/api/API.md`(413 행, 제한 요약 표), `docs/PRD.md`(58행 부근 — 5분 이내·클라이언트 압축 50MB 목표·게이트 100MB), `apps/api/acting-api/README.md`(20행), `apps/api/docs/design-decisions.md`(51·80·82행), **`apps/api/spec/api-spec.html`(550MB 3곳, Codex #15)**.

## 완료 기준 체크리스트

- [ ] `/practice/new`(PracticeSingle)에서 50MB 초과 MP4/MOV 선택 시 브라우저에서 긴 변 1280px·≤30fps H.264+AAC MP4로 재인코딩된다 (50MB는 soft target, 100MB 게이트는 경성)
- [ ] 50MB 이하 파일은 재인코딩 없이 기존 경로 그대로 업로드
- [ ] WebCodecs 미지원/디코딩 불가/트랙 discard 시 원본 업로드 폴백, 100MB 초과면 업로드 전 안내와 함께 거부
- [ ] 압축 진행률(≤99% 캡)과 업로드 진행률이 단계 구분되어 표시
- [ ] 취소(unmount/이탈)가 원본 폴백으로 오인되지 않고 변환·업로드 모두 중단
- [ ] PracticeSingle의 duration race(이전 파일 duration 잔존·미로드 제출) 제거
- [ ] 백엔드 intent 생성이 100MB 초과 `size_bytes`에 413 `upload_too_large` 반환 (기존 테스트는 상수 참조라 그대로 통과)
- [ ] 압축 계획 순수 함수의 node 테스트 존재 (경계: 스킵 임계, 2Mbps 상한, 5분 최저 비트레이트, 업스케일 금지, 세로 영상, fps 30 초과/이하)
- [ ] `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build` 통과
- [ ] `cd apps/api && uv run --package acting-api pytest` 통과
- [ ] openapi.json 재생성 시 diff 없음 확인 (있으면 웹 타입 재생성 포함 반영)
- [ ] 문서 5곳(API.md·PRD.md·acting-api README·design-decisions.md·spec/api-spec.html)의 한도 수치 현행화

## 하지 말 것 (스코프 제한)

- 서버 Gemini 압축 스펙(768px/10fps/CRF28) 변경 금지 — `TIMEOUT_SEC` 상향만.
- legacy `/summarize` 라우터 한도 변경 금지.
- 업로드 3단계 흐름(intent→PUT→complete), presign 방식, 인증·rate limit 로직 변경 금지.
- ffmpeg.wasm 도입 금지. 녹화(MediaRecorder) 기능 추가 금지. 취소 버튼 UI 추가 금지(후속).
- 서버측 duration 검증 추가 금지(후속 검토 대상).
- `apps/web/src/lib/api/v2-schema.d.ts` 직접 수정 금지 (재생성 명령만).
- 스코프 밖 리팩터링 금지 (기존 코드 스타일·구조·카피 톤 유지, `tests/product-language-guard.test.mjs` 카피 가드 준수).

## Codex 설계 비판 처리 기록 (Phase 2, 2026-07-20)

- **수용 #1(blocker)**: 실제 업로드 화면은 PracticeSingle — UI 주 대상 교체 + 공통 preflight (Claude가 라우트 직접 검증).
- **수용 #2(blocker, 완화안)**: 50MB는 soft target으로 변경, 경성 한도는 100MB 게이트 (사용자 결정 — 재시도 루프는 기각).
- **수용 #3·#4·#5·#7·#8·#10a·#11·#13·#14·#15**: tracks primary, 트랙 discard 검증, 취소 의미론 분리, AAC 폴리필 조건 검사, fps 평균 기반 명문화, duration race 수정, 대기시간 카피 수정, progress 99% 캡, formats [MP4, QTFF], api-spec.html 문서 추가.
- **부분 수용 #6**: BufferTarget 메모리 지적은 타당하나 1차 구현은 BufferTarget 유지, StreamTarget/OPFS는 미결 사항으로 (사용자 결정).
- **부분 수용 #5**: 취소 의미론은 수용, 취소 버튼 UI는 이번 스코프 제외 (사용자 결정).
- **기각 #9**: ≤50MB HEVC 재인코딩 — grilling에서 이미 검토·기각된 선택지(재생 호환성은 기존에도 동일). 
- **기각 #10b**: 서버측 duration 검증 — "5분은 프론트 검증만" 합의 유지, 스펙에 명시.
- **기각 #12**: intent `duration_ms` 재정의 — worker 미사용으로 실질 영향 없음, source duration 의미 유지.

## 미결 사항

- **StreamTarget/OPFS 전환**(Codex #6): 실기기(모바일 Safari)에서 BufferTarget 메모리 문제가 확인되면 `StreamTarget` + `FileSystemWritableFileStream`으로 전환. 1차 구현은 BufferTarget.
- **취소 버튼 UI**: 압축·업로드 진행 중 명시적 취소 버튼은 후속.
- 비트레이트 계수(0.95 마진, 오디오 128k)는 실측 결과물이 목표를 크게 넘으면 조정 가능.

## 검증 명령

- 웹: `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build`
- 백엔드: `cd apps/api && uv run --package acting-api pytest`
- 스펙 재생성(무변경 확인): `cd apps/api && uv run python -c "import json; from acting_api.app import create_app; json.dump(create_app().openapi(), open('spec/openapi.json','w'), ensure_ascii=False, indent=2)"` 후 `git diff --stat spec/openapi.json`
- 수동 확인: dev 루프(api :8000 + `pnpm dev`)에서 50MB 초과 영상 업로드 → 압축 진행률 → 업로드 → 재생 확인.
