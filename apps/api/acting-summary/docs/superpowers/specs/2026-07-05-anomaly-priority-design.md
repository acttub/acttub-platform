# 이상징후 우선순위 개편 설계

날짜: 2026-07-05

## 목적

요약 JSON의 `anomalies`가 평평한 리스트라 다음 단계 코칭 챗봇이 뭘 먼저 다뤄야 할지 알 수 없다.
"가장 중요한 문제"와 "가장 중요한 파트(핵심 구간 + 핵심 축)의 문제"가 우선순위로 드러나도록 개편한다.

## 원칙 정리 (기존 규칙 4와의 관계)

- 합격/불합격·점수 판정은 계속 금지한다. 그건 다음 단계 챗봇의 몫.
- 단, `severity`는 배우 평가가 아니라 **서브텍스트 의도 훼손 크기** 기준의 코칭 우선순위 신호로 허용한다.

## 스키마 변경 (`src/acting_summary/schema.py`)

### `Anomaly` 시점 → 구간 (추가 요청)

`timestamp`(단일 시점)를 `start`/`end`(구간 시작·끝)로 교체한다.
순간적인 이상이면 `end`를 `start`와 같게 채운다.

### `Anomaly` 필드 추가

- `severity: Literal["high", "mid", "low"]` — 서브텍스트 의도 훼손 크기 기준
- `severity_reason: str` — 왜 이 등급인지. 핵심 구간/핵심 축 해당 여부를 포함하고,
  `impact_on_intent` 내용을 반복하지 않는다.

### `SceneSummary` 필드 추가 (`anomalies` 앞)

- `key_moment: str` — 서브텍스트상 가장 중요한 시간 구간 + 왜 중요한지
- `key_dimension: str` — 이 씬에서 가장 중요한 연기 축 + 왜 중요한지

### `anomalies` 설명 변경

중요도순 정렬(high→low), 같은 등급 안에서는 key_moment/key_dimension 관련 항목이 먼저.
절대 생략 금지 유지.

## 고정 그리드 스캔 (추가 요청 — 실행 간 anomaly 편차 완화)

영상을 00:00부터 5초 고정 간격 그리드(00:00~00:05, ...)로 나눠 구간마다 6축을 점검하며
이상을 찾는다. 시계 기준이라 같은 영상이면 구간이 항상 동일하다.
점검 기록 출력 필드(`segment_scan`)는 도입했다가 사용자 결정으로 제거 — 스캔은
프롬프트 내부 지침으로만 유지하고 출력하지 않는다.
함께 `temperature=0.0`, `seed=42`를 summarizer에 고정했다.

## anomaly 구간 규칙 (추가 요청 — 실영상 튜닝 반영)

이상 구간은 감지된 한 순간이 아니라 **지속·반복되는 전체 범위**로 잡는다.
같은 성질의 이상이 반복되면 하나로 묶어 start=최초 등장, end=마지막 등장으로 적고
개별 등장 시점은 what에 나열한다. 단, 묶기는 같은 성질끼리만 하며 항목 수를 줄이는
규칙이 아니다(성질이 다른 이상은 별개 유지). 정말 순간적인 이상만 end=start.
dimension은 한국어 축 이름(대사, 템포, 높낮이, 움직임, 표정, 감정)만 허용, 영어 금지.
C-pro 59초 실영상으로 3회 검증: 구간이 4~19초로 자연스럽게 잡히고 그리드·key_moment는
실행 간 일관, 개별 anomaly 목록의 실행 간 편차는 남음(→ N회 다수결 집계가 다음 단계).

## 관찰 수치화 규칙 (추가 요청)

observation의 모든 축은 해석어 대신 수치화·측정 가능한 표현(방향·각도·신체 위치·초 단위 시간·횟수)으로 적는다.
나쁜 예: "팔을 오른쪽으로 움직인다" / 좋은 예: "왼쪽 어깨 부근에서 오른쪽 45도 방향으로 팔을 쭉 뻗는다".

## 프롬프트 변경 (`src/acting_summary/prompt.py`)

- 새 규칙: `key_moment`/`key_dimension`을 먼저 판단하고, 그것이 severity 판단과 정렬의 기준이 된다.
- 규칙 3(anomalies)에 `severity`·`severity_reason` 작성 지침과 정렬 규칙 추가.
- 규칙 4 재서술: "합격/불합격·점수 판정은 하지 않는다. 단 코칭 우선순위를 위한 severity는
  의도 훼손 크기 기준으로 매긴다."

## 테스트

- `tests/test_schema.py`: severity Literal 제약(허용값/불허값), severity_reason 필수,
  key_moment/key_dimension 필수, roundtrip 갱신.
- `tests/test_prompt.py`: severity·key_moment·key_dimension 키워드와 정렬 규칙 문구 포함 여부.

## 범위 밖

- 코치 에이전트(acting_agent 레포)에서의 우선순위 소비 방식.
- 점수화·수치화(0~100 등)는 하지 않는다.
