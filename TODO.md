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
