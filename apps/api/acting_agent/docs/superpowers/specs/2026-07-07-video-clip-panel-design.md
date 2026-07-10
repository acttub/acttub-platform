# 코치 앱 영상 업로드 + 타깃 지점 재생 패널 설계

날짜: 2026-07-07
상태: 승인됨 (브라우저 구간 재생 방식, start만 사용 — 엣지 케이스 로직 없음)

## 문제

Gradio 코치 앱은 요약 JSON만 받는다. 코치가 짚는 지점(타깃 anomaly)을
배우가 영상에서 바로 볼 수 없다.

## 방향 (사용자 결정)

- 연기 영상을 함께 업로드하고, 채팅 시작 시 타깃 anomaly의 `start` 시점부터
  재생되는 플레이어를 표시한다.
- HTML5 미디어 프래그먼트(`src="...#t=초"`) 사용 — ffmpeg 등 추가 설치 없음.
- **start만 사용** — end/구간 종료·패딩·기타 엣지 케이스 로직은 넣지 않는다.
- 세션당 타깃 1개 고정이므로 패널은 시작 시 한 번만 설정한다.

## 변경

### 1. `src/acting_agent/clip.py` (신규 — 순수 로직)

- `to_seconds("00:12") -> 12` — MM:SS 파싱.
- `pick_target(summary) -> Anomaly | None` — severity 최상위 1개.
  `prompt._target_block`의 선택 로직을 이관해 프롬프트와 UI가 같은 타깃을 공유.
- `build_clip_html(video_url, start_seconds) -> str` — `#t=` 프래그먼트 플레이어 HTML.

### 2. `src/acting_agent/prompt.py`

- `_target_block`이 `clip.pick_target`을 사용 (동작 동일 리팩토링).

### 3. `coach_app.py`

- `gr.Video` 업로드 추가 (선택 입력).
- `gr.HTML` "코치가 보는 지점" 패널 추가.
- `start_chat(summary_file, video)`: 영상이 있으면
  `/gradio_api/file={path}#t={start초}` 플레이어 HTML 반환 (Gradio 6 파일 라우트).

### 4. 테스트

- `tests/test_clip.py`: to_seconds / pick_target / build_clip_html 유닛 테스트.
- 기존 프롬프트 테스트로 리팩토링 무결성 확인.

## 범위 밖

- end 시점·구간 종료 처리, 영상 없음/anomaly 없음 특수 UI, 매 답변 패널 갱신.
