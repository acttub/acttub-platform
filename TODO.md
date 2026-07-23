# TODO

- [x] 압축 스펙 반영하기 (feat/upload-compression — 클라이언트 압축 50MB 목표·게이트 100MB·5분)
- [ ] S3 저장 폴더 구조가 합당한지 체크하기
- [ ] 영상 분석 이후 분석 결과는 보여주지 않고 갖고만 있기
- [ ] 채팅할 때 한글 마지막 한 글자 남는 문제 고치기 (IME 조합 이슈로 추정)
- [ ] 리포트 삭제 API 만들기 (연습 세션당 리포트 1개 제약과 연동 — 삭제 시 해당 세션 재코칭·재리포트 허용, 세션 소프트 삭제와의 관계 정의)
- [ ] 이전 기록 API 개편: `GET /v2/reports/{practice_session_id}` 신설(리포트 본문+playback_url 한 번에) + `GET /v2/reports` 목록 슬림화(`practice_session_id`·`headline`·`created_at`만) — 상세 신설과 같은 PR에서 진행
- [x] `GET /v2/practice-sessions/{id}/status` 폴링 경량 엔드포인트 신설 — 분석 대기 폴링이 상세 응답·presign 발급 없이 `{status, error_code}`만 받도록
- [ ] 미완료 연습 이어가기 별도 페이지(리포트 없는 세션 조회 + 이어가기 UI)
- [ ] 쓸데없는 파일들 제거하기 (안 쓰는 산출물·죽은 코드·불필요 문서 정리)
- [ ] 원본이 10MB 이하면 압축 생략하고 그대로 업로드 (모바일 `lib/compress.ts`는 목표 6MB, 웹 `lib/media/compress-video.ts` — 작은 파일은 압축 이득보다 인코딩 대기·품질 손실이 커서 스킵)
- [ ] 이름 입력은 최초 회원가입 때만 받기 (`apps/mobile/app/consent.tsx` — 지금은 동의 화면이 이름 입력을 항상 끼고 있고 `canProceed`가 `name.trim().length > 0`을 요구해서, 약관이 추가돼 재동의할 때도 이름을 다시 입력해야 한다. 이미 이름이 있으면 입력란을 숨기고 동의만 받도록 분리. 현재 이름은 로컬 저장(`lib/profile.ts`)이라 백엔드 프로필 API가 생기면 "최초"의 기준을 서버 값으로 옮길 것)

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
