# SPEC: 업로드 영상 클라이언트 압축 + 용량 게이트 100MB (TODO 1)

기준 커밋: `fe99977` · 브랜치: `feat/upload-compression`

## 배경 / 목적

- 현재 업로드는 브라우저 → S3 presigned PUT 직접 업로드이며 상한 550MB. 원본이 그대로 저장·재생되고, 서버는 Gemini 분석 직전에만 ffmpeg로 압축한다(`acting-summary/compress.py`).
- 550MB 원본 업로드는 모바일 회선에서 느리고 저장 비용이 크다. 프론트에서 재생 품질을 지키는 수준으로 압축해 **결과물 ≤ 50MB**를 목표로 하고, 백엔드는 **100MB 초과를 거부**하는 게이트로 바꾼다.
- 핵심 제약: **S3에 저장된 파일이 곧 재생본**이다(`presign_playback`). 따라서 압축 스펙은 Gemini용(768px/10fps)이 아니라 재생 품질 유지형(720p/30fps)으로 잡는다. Gemini용 축소는 지금처럼 서버가 분석 직전에 수행한다.
- 길이 상한은 3분 → **5분**으로 변경한다 (사용자 결정).

## 설계

### 프론트 (apps/web)

1. **입력 검증**: MP4/MOV(`video/mp4`·`video/quicktime`) + **길이 5분 이하**만. **원본 용량 상한(550MB)은 제거**한다. 길이는 기존 `videoDuration()`(metadata 로드)으로 확인.
2. **압축 모듈 신설** — `src/lib/media/` 아래(파일 구성은 구현 재량):
   - 라이브러리: **mediabunny** (WebCodecs 기반, MOV/MP4 입력 지원). AAC 인코딩 미지원 브라우저(Firefox 등)는 **`@mediabunny/aac-encoder` 폴리필을 동적 import로 등록**. 두 패키지는 로컬에서 선행 설치된다(Codex 샌드박스 네트워크 불가 — 설치된 패키지의 타입 선언이 API의 근거).
   - 번들 영향 최소화: mediabunny 자체도 압축 시점에 **dynamic import**로 로드.
   - **스킵**: 원본 ≤ 50MB면 재인코딩 없이 원본 그대로 업로드.
   - **출력 스펙**: MP4(H.264 `avc` + AAC), faststart 상당. 해상도는 **긴 변 1280px**(종횡비 유지, 짝수 강제, 원본이 더 작으면 업스케일 금지). 프레임레이트는 **최대 30fps**(원본이 30 이하면 유지). 오디오 AAC 128kbps, 채널·샘플레이트는 원본 유지.
   - **길이 적응형 비트레이트**: `videoBitrate = min(2_000_000, floor(0.95 × 50MB × 8 / durationSec) − 128_000)`. 1분짜리는 2Mbps, 5분짜리는 약 1.1~1.2Mbps. 계산 로직(해상도·비트레이트·스킵 판단)은 **순수 함수로 분리**해 node 테스트 가능하게 한다.
   - **진행률**: mediabunny `onProgress`(0~1)를 UI 콜백으로 전달.
   - **취소**: 업로드 AbortSignal과 연동해 변환도 중단.
   - **폴백**: WebCodecs 미존재, `Conversion.isValid` 실패(디코딩 불가 코덱 등), 변환 중 예외 → **원본 그대로 업로드 경로로 폴백**. 압축 결과가 원본보다 크면 원본 사용.
3. **업로드 게이트**: 실제 업로드할 파일(압축본 또는 폴백 원본)이 **100MB 초과면 업로드 중단** + 안내 카피(브라우저 변경 또는 파일 축소 유도, 한국어 존댓말).
4. **`env.ts` 상수**: `MAX_UPLOAD_BYTES = 100MB`(백엔드 게이트 미러, 주석 갱신), `MAX_DURATION_MS = 300_000`. 압축 관련 상수(목표 50MB, 스킵 50MB, 2Mbps, 128k, 1280px, 30fps)는 압축 모듈에 둔다.
5. **UI (`practice-flow.tsx`)**:
   - `selectUploadFile`·`begin`의 550MB 검사 제거, 길이 오류 카피는 상수에서 유도("5분").
   - `begin()`: 길이 확인 → 압축(진행률 표시, "압축 중" 단계) → 게이트 확인 → `uploadVideo()`(압축본은 `video/mp4`로 업로드).
   - 드롭존 카피 "MP4 · MOV · 최대 550MB · 3분 이내" → 용량 언급 없는 "MP4 · MOV · 5분 이내" 계열로 갱신.
   - 제출 버튼·선택 카드의 진행 표시에 압축 단계 추가.

### 백엔드 (apps/api)

6. `acting-api/src/acting_api/uploads.py`: `MAX_UPLOAD_BYTES = 100 * 1024 * 1024`. 검증·에러(413 `upload_too_large`)·presign 구조는 그대로.
7. `acting-summary/src/acting_summary/compress.py`: `TIMEOUT_SEC = 600.0`(5분 영상 대응, 초과 시 원본 사용 폴백은 그대로). 압축 스펙(768px/10fps 등) 변경 없음.
8. `acting-summary/router.py`의 legacy `/summarize` 한도(550MB)는 **변경하지 않는다**(별도 계약, 스코프 밖).

### 계약 / 문서

9. openapi.json에는 용량 수치가 없어 스키마 변경 없음이 예상된다. 확인 차 스펙 재생성 후 **diff 없음을 검증**한다(diff가 생기면 웹 타입 재생성 포함 같은 커밋에 반영).
10. 문서 내 550MB·3분 언급 현행화: `apps/api/API.md`(413 행, 제한 요약 표), `docs/PRD.md`(58행 부근 — 5분 이내·클라이언트 압축 50MB 목표·게이트 100MB), `apps/api/acting-api/README.md`(20행), `apps/api/docs/design-decisions.md`(51·80·82행).

## 완료 기준 체크리스트

- [ ] 50MB 초과 MP4/MOV 선택 시 브라우저에서 긴 변 1280px·≤30fps H.264+AAC MP4로 재인코딩되어 결과물 ≤ 50MB (5분 이하 어떤 길이든)
- [ ] 50MB 이하 파일은 재인코딩 없이 기존 경로 그대로 업로드
- [ ] WebCodecs 미지원/디코딩 불가 시 원본 업로드 폴백, 100MB 초과면 업로드 전 안내와 함께 거부
- [ ] 압축 진행률과 업로드 진행률이 단계 구분되어 표시
- [ ] 업로드 취소 시 변환·업로드 모두 중단
- [ ] 백엔드 intent 생성이 100MB 초과 `size_bytes`에 413 `upload_too_large` 반환 (기존 테스트는 상수 참조라 그대로 통과)
- [ ] 압축 계획 순수 함수의 node 테스트 존재 (경계: 스킵 임계, 2Mbps 상한, 5분 최저 비트레이트, 업스케일 금지, 세로 영상)
- [ ] `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build` 통과
- [ ] `cd apps/api && uv run --package acting-api pytest` 통과
- [ ] openapi.json 재생성 시 diff 없음 확인 (있으면 웹 타입 재생성 포함 반영)
- [ ] 문서 4곳(API.md·PRD.md·acting-api README·design-decisions.md)의 한도 수치 현행화

## 하지 말 것 (스코프 제한)

- 서버 Gemini 압축 스펙(768px/10fps/CRF28) 변경 금지 — `TIMEOUT_SEC` 상향만.
- legacy `/summarize` 라우터 한도 변경 금지.
- 업로드 3단계 흐름(intent→PUT→complete), presign 방식, 인증·rate limit 로직 변경 금지.
- ffmpeg.wasm 도입 금지. 녹화(MediaRecorder) 기능 추가 금지.
- `apps/web/src/lib/api/v2-schema.d.ts` 직접 수정 금지 (재생성 명령만).
- 스코프 밖 리팩터링 금지 (기존 코드 스타일·구조·카피 톤 유지, `tests/product-language-guard.test.mjs` 카피 가드 준수).

## 미결 사항

- mediabunny 정확한 API 표면(리사이즈 지정 방식·frameRate·cancel·AAC 폴리필 등록법)은 설치된 패키지의 타입 선언·README 기준으로 구현 시 확정. 문서상 `Conversion.init` / `onProgress` / `isValid` / `discardedTracks` / `BufferTarget` 확인됨.
- 비트레이트 계수(0.95 마진, 오디오 128k)는 실측 결과물이 50MB를 넘으면 조정 가능. 목표 불변: 5분 이하 어떤 입력이든 결과물 ≤ 50MB.

## 검증 명령

- 웹: `pnpm lint` · `pnpm typecheck` · `pnpm --filter web test` · `pnpm build`
- 백엔드: `cd apps/api && uv run --package acting-api pytest`
- 스펙 재생성(무변경 확인): `cd apps/api && uv run python -c "import json; from acting_api.app import create_app; json.dump(create_app().openapi(), open('spec/openapi.json','w'), ensure_ascii=False, indent=2)"` 후 `git diff --stat spec/openapi.json`
- 수동 확인: dev 루프(api :8000 + `pnpm dev`)에서 50MB 초과 영상 업로드 → 압축 진행률 → 업로드 → 재생 확인.
