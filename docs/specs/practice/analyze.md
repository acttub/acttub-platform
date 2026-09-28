# practice.analyze 분석

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.0
- 화면: A10(분석 진행), D6, D7, W6, M6, M6.3, W6.3-R. A10·W6의 "끝날 때까지 이 화면을 켜 두세요"는 화면을 떠나도 분석이 계속된다는 문구로 고친다(디자인에 반영할 것)
- 테이블: analyses, video_transcripts, ai_jobs

## 기능
시작된 회차의 영상을 서버가 분석해 관찰 기록을 만들고 받아쓰기를 남긴다. 화면은 작업 상태를 폴링해 대기·진행·완료·실패를 보여
주고, 완료되면 코치 대화로 넘어간다.

## 의도
현행 분석 워커·상태 전이·실패 분류·재시도(CONTRACT §5-7)는 그대로 두고, 결과 저장을 회차와 1:1인 analyses(기록 전체 jsonb, 완료
뒤 불변)로, 큐를 ai_jobs로 옮긴다. 작업 상태와 결과 상태는 다른 것이다.

## 목적
배우가 분석이 어디까지 됐는지 알고, 끝나면 그 근거로 대화를 시작한다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/practices/{practice_id}/status` | practice_id | `PracticeStatus` 200(stage·close_reason·analysis_status·job) | `practice_not_found` 404 |
| `GET /v2/practices/{practice_id}/analysis` | practice_id | `PracticeAnalysis` 200(`{id, format, status, summary}`) | `analysis_not_found` 404, `practice_not_found` 404 |
| `POST /v2/practices/{practice_id}/cancel` | practice_id | `PracticeStatus` 200(stage closed) | `analysis_already_finished` 409, `practice_not_found` 404 |
| `AnalysisWorkerScheduler.poll` (`ANALYSIS_WORKER_POLL_INTERVAL_SEC`, 기본 2초) | `pending` analyze 작업, lease `ANALYSIS_LEASE_SEC`(기본 1800초) | analyses·video_transcripts 저장, 작업 succeeded | timeout·parse·unsupported는 즉시 `failed`, 바깥 의존 실패는 `pending`으로 되돌린다 |
| `AnalysisWorkerScheduler.sweep` (`ANALYSIS_SWEEP_INTERVAL_SEC`, 기본 60초) | 3회 시도한 `pending` 작업 | 작업 `failed`(앞서 적힌 failure_reason을 유지하고 없을 때만 max_attempts), analyze면 회차 closed | — |
| `PushService.onAnalysisComplete` | 분석 완료 | 앱 완료 푸시(account.notification) | — |

## 상태
ai_jobs.status — 비동기 AI 작업 장부. 종류는 analyze·memory_update(이 영역)와 challenge_report(challenge.ai-report)다.

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| pending | 시작·이어하기·재시도가 analyze를 만든다, 대화 종료 뒤 memory_update 예약, running에서 일시 실패로 놓기(시도 수 유지) | practice.start, practice.resume, practice.memory, practice.analyze |
| running | pending을 선점(시도 수 +1, lease_token·만료 시각), 시도 수가 3 미만일 때만 | practice.analyze, practice.memory |
| succeeded | running에서 완료, lease_token이 그대로일 때 | practice.analyze, practice.memory |
| failed | running에서 즉시 실패(timeout·parse·unsupported), 3회 소진 뒤 정리(앞서 놓을 때 적힌 사유를 유지하고, 없을 때만 max_attempts), 취소(cancelled), 탈퇴(account_deactivated), 기억 세대 불일치(memory_epoch_stale) | practice.analyze, practice.memory, account.withdraw |

- 불변 조건: (user_id, request_id)당 작업 하나(`uq_ai_jobs_user_request`). 완료·실패·놓기는 lease_token이 그대로일 때만 통하고, 바뀌었으면
  저장 전체를 되돌린다. 놓기는 시도 수를 되돌리지 않는다(`AiJobLedger.MAX_ATTEMPTS` = 3).
- 끝 상태: succeeded·failed. 재시도는 같은 행을 되살리지 않고 새 작업을 만든다.

analyses.status — 분석 결과.

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| ready | 분석 완료, 못 본 구간 없음 | practice.analyze |
| partial | 분석 완료, 못 본 구간 있음 | practice.analyze |

- 불변 조건: 회차당 하나(`uq_analyses_practice`). 완료 뒤 덮어쓰지 않는다. 같은 회차의 두 번째 완료는 무시된다.
- 끝 상태: 처음 저장한 값.

video_transcripts.status — 영상 단위 받아쓰기.

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| ready | 그 영상의 첫 분석 완료(말소리가 있을 때). 같은 영상의 다음 분석은 새로 만들지 않는다 | practice.analyze |
| reserved·failed | 스키마(`ck_video_transcripts_status`)에만 있고 코드는 쓰지 않는다(열린 질문) | — |

- 불변 조건: 영상당 하나(`uq_video_transcripts_video`). 영상 삭제·파일 파기 때 함께 지운다(practice.library).
- 끝 상태: ready.

분석 결과 저장 → 회차 conversing, 최종 실패 → closed/analysis_failed, 취소 → closed/cancelled (정본: [practice.start](start.md#상태))

- ai_jobs.status는 pending·running·succeeded·failed이고 failed에는 사유(timeout·parse·unsupported·cancelled·account_deactivated 등)가
  붙는다. analyses.status는 ready·partial이다. 부분 실패는 partial로 남기고 못 본 구간을 채우지 않는다.

## 규칙·제약
- analyses는 format으로 갈린다. 신형(video_record_v1)은 acttub.video_record.v1 기록 전체를 jsonb 한 컬럼에 두고 id = record_id다. 기존
  갈래(legacy)는 현행 ObservationPack 원문을 그대로 두고 기존 응답 모양을 유지한다. 둘 다 완료 뒤 덮어쓰지 않고 워커 재시도로 기록
  version을 올리지 않는다. 기존 결과를 신형 형식으로 위장하지 않는다.
- 분석 조회(`GET …/analysis`)는 공개 요약만 준다. 기존 갈래의 summary는 `ObservationPackResponse`, 신형은
  `VideoRecordSummaryResponse`이고 전체 내부 원문·출처 목록은 내보내지 않는다. 새 분석이 없으면 옛 분석을 소유권을 확인해 읽는다.
  없는·남의 회차는 404 practice_not_found, 내 회차에 아직 분석이 없으면 404 analysis_not_found다. 영상 파일을 파기해도 저장된
  요약은 읽을 수 있다.
- 받아쓰기는 영상 단위로 만들고(원문·단어 시각·간격·처리 구간) 같은 영상의 다음 회차가 재사용한다.
- 폴링은 앱 4초, 웹 10초다. 화면을 떠나면 조회만 멈추고 돌아오면 서버 상태부터 읽는다. 앱은 완료 푸시를 받는다(account.notification).
- 실패 분류는 현행대로다. timeout·parse·unsupported는 즉시 failed, 저장소·ETag 같은 바깥 의존 실패는 다시 큐에 넣고 최대 3회다.
  같은 회차의 완료된 분석을 다시 돌리지 않는다.
- 게스트 하루 3회는 한국 시간 하루의 새 분석 요청 수다(코드 guest_daily_analysis_limit). 같은 요청 id 재전송·워커 재시도·폴링은 세지
  않는다. 회원은 한도가 없다. 두 흐름이 공존하는 동안 옛 external_operations의 분석 요청도 같은 하루에 센다.
- 명시적 취소("그만두기")는 failed/cancelled로 종결하고 lease를 지워 늦은 완료·재큐를 막는다. 화면 이탈은 취소가 아니다. 앱의 옛
  "분석 포기 = 연습 숨김"은 없앤다.
- 분석이 전부 실패하면 코치 대화를 시작할 수 없다(409, practice.coach). 근거 없는 대화를 허용하는 것은 별도 제품 결정이다.
- lease 규칙은 CONTRACT §5-7 그대로다(다른 워커가 선점하기 전에는 만료 뒤 완료도 허용, 토큰이 바뀌면 완료 거절).

## 예외
- 워커의 lease가 다른 워커에게 넘어간 뒤 이전 워커가 완료: 저장이 전부 롤백된다.
- 탈퇴·이관 도중 완료: 탈퇴면 결과를 저장하지 않고 취소, 이관이면 회원에게 결과·알림.
- 3회 모두 바깥 의존 실패: failed, 화면은 다시 시도 버튼(새 작업)을 준다.
- 부분 완료: partial이고 대화는 시작된다. 화면은 "일부 구간은 보지 못했어요"를 보인다.

## 검증 방법
- 시작 뒤 폴링: pending → running → succeeded로 바뀌고 analyses 1행(id = record_id, status ready)이 생긴다.
- 부분 실패 기록: analyses.status partial, 누락 구간이 기록에 있고 채워지지 않았다.
- timeout 실패: 즉시 failed, 재큐 없음. 저장소 실패 1회: 재큐, 2회째 성공 → succeeded, 시도 수 2.
- 게스트 3회 요청 뒤 4번째 시작: 429 guest_daily_analysis_limit. 같은 요청 id 재전송: 세지 않는다. 자정 뒤: 된다.
- parse 실패: 즉시 failed. unsupported: 즉시 failed. 3회 소진: failed, stage closed, "다시 시도"로 새 작업이 생기고 stage analyzing.
- 완료된 analyses의 record를 바꾸는 요청: 없다(불변). 앱은 4초, 웹은 10초 간격으로 status를 읽는다. 완료 시 앱에 푸시가 온다.
- 이관 중 완료: 회원의 회차에 결과, 회원 폰에 푸시. 탈퇴 중 완료: 결과 없음, failed/account_deactivated.
- 기존 갈래(legacy) 회차 완료: analyses.format legacy, 원문 ObservationPack, 기존 응답 모양.
- 취소: failed/cancelled, lease 없음, 늦게 온 완료는 거절.
- 화면을 떠나고 돌아옴: 서버 상태를 다시 읽고 작업은 계속 돌았다.
- 전부 실패한 회차에서 코치 시작: 409.
- lease 만료 뒤 재선점 없이 완료: 저장된다. 재선점 뒤 이전 워커 완료: 롤백.

## 범위 밖
- 대화 도중 재분석(PRD 「지금 하지 않는 것」). 같은 회차의 완료된 분석을 다시 돌리지 않는다.
- 분석이 전부 실패한 회차의 근거 없는 대화. 별도 제품 결정이다.
- 영상 전체를 손실 없이 텍스트로 복원한다는 보장.
- 멀티모달 파인튜닝(PRD 「지금 하지 않는 것」, ADR-010).

## 열린 질문
- running에 남은 작업을 다시 집는 코드가 없다. `PostgresAiJobLedger.claimNext`는 `pending`만 집고 정리(`sweepMaxAttempts`)도 `pending`만
  본다. 워커가 lease 도중 죽으면 그 작업은 lease가 지나도 running으로 남고 회차는 배우가 취소하기 전까지 analyzing에 머문다. 클래스 설명의
  "시한이 지나면 다시 집힌다"와 옛 원장(`ExternalOperationClaimer`는 만료된 running을 다시 집는다)과 다르다.
- video_transcripts의 reserved·failed는 스키마와 `TranscriptStatus`에만 있다. 코드는 분석 완료 때 ready만 `ON CONFLICT DO NOTHING`으로
  넣는다. practice.record의 "생성 예약을 공유해 하나만 만들고"는 예약이 아니라 유일 제약으로 이뤄진다. 예약을 구현할지 값을 지울지 정한다.

## 1층: 시간축이 있는 영상 기록 (SOMA-526)

정본은 `analyses.record`(format `video_record_v1`)의 `acttub.video_record.v1`이다(PostgresPracticeAnalysisStore). 정본은 분석 완료 후 덮어쓰지 않는다.
(v1 당시: `summaries.raw`에 저장하고 `summaries.id = record_id`였으며, 기존 `observations_json`, `uncertainties_json`은 새 기록에서 빈 배열이었다. 옛 행은 호환 읽기 경로로만 읽는다.)

- 원본을 최대 30초 청크로 분석하고 지역 시각·ID를 원본 기준으로 조립한다. 청크마다 최대 6회 생성 예산을 독립적으로 둔다. 구조 오류는 재생성하고, 필요하면 최소 7.5초까지 분할한다. 앞 청크의 실패가 뒤 청크의 예산을 소모하지 않는다.
- 영상 파트에 6 FPS 샘플링을 명시하고 프레임 사이 미세 변화·추정 시각의 한계를 기록한다. LOW thinking으로 청크별 생성 예산을 유지한다. [Gemini 영상 문서](https://ai.google.dev/gemini-api/docs/video-understanding)의 기본 샘플링 한계를 고려한 설정이며 실제 영상으로 비용·시각 품질을 확인한다.
- 전체 대사, 발성·호흡·리듬·시선·얼굴·움직임·환경의 관찰, 변화가 없는 상태, 관찰 한계를 저장한다. 상위 15개 등의 개수 제한을 두지 않는다. 각 구간의 참조와 처음부터 끝까지의 시간축을 검증한다.
- 받아쓰기의 모든 단어 시각과 단어 사이 간격을 보존한다. 무음으로 단정하지 않고 `word_gap`으로 기록한다. ASR와 영상 대사가 충돌하면 양쪽을 보존하고 한계를 남긴다. 모델 추정 시각은 `estimated`, ASR 단어 시각은 `aligned`다.
- 부분 실패는 `processing.status=partial`, `processed_ranges`, `missing_ranges`와 한계로 기록한다. 모든 청크가 실패하면 기존 분석 실패 흐름을 따른다. 분석이 전부 실패한 회차는 대화를 열 수 없다(409 `analysis_not_ready`, 위 「규칙·제약」). (v1 당시 설계는 근거 없는 상태로 대화를 여는 것이었다.)
- 영상 전체를 손실 없이 텍스트로 복원한다고 보장하지 않는다. 보이지 않거나 들리지 않는 부분은 설명을 만들어 채우지 않는다.

프롬프트: `apps/api/src/main/resources/coaching/video-record-prompt.txt`.
출력 스키마: 같은 디렉터리 `three-layer-contracts.schema.json`의 `layer1_chunk`.
공개 상세 응답의 `summary`는 새 기록일 때 `VideoRecordSummaryResponse`다. 원본 기록 전체를 공개 API로 내보내지 않는다.

### 대화 연속성을 위한 1층 규칙
- 대사 전체와 부정·조건·정정·호칭·말의 이어짐을 보존한다.
- 대사 속 사건과 실제 영상의 사건, 원문과 숨은 의도 추정을 구분한다.
- 청크의 원본 내 위치와 원본 길이를 제공하되 출력 시각은 청크 상대 시각을 유지한다.
- 녹음된 크기를 발성 문제로, 화면 밖 움직임을 행동 부재로 판정하지 않는다.
- 출력 계약은 유지한다. 새로운 의도·진단 필드를 만들지 않는다.
