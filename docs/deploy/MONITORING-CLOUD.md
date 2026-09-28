# Grafana Cloud 모니터링 적용·확인 절차

이 문서는 [전체 명세](MONITORING.md)의 Cloud 설정을 적용하고 확인하는 절차다.
로컬 구현·검증과 **실제 Cloud/Slack 확인은 별개**다. Cloud stack·사용자 권한·Free 플랜·PDC 연결·Slack 수신을 확인하기 전에는 운영 적용 완료로 기록하지 않는다.

## 저장소 설정과 도구

선언 파일과 도구는 [`deploy/monitoring/cloud`](../../deploy/monitoring/cloud)에 있다. **레포 파일이 정본**이고, `apply.py`가 그 내용을 Cloud에 맞춘다.

| 파일 | 책임 |
|---|---|
| `cloud.json` | 비밀이 아닌 stack 값: stack 주소, 환경별 공개 origin(`health_origins`), 외부 점검 위치(probe), Cloud Metrics 데이터 소스 UID, 디스크 경로 |
| `rules.json` | 1분 평가 알림 규칙. 환경별 규칙은 `health_origins`의 환경마다, 공유 규칙은 한 번 만든다 |
| `dashboards/*.json` | 서비스 전체·분석/코치·서버/DB/백업, KST·최근 1시간. 맨 위 한 줄 요약 + 접히는 구역 배치. 서버 화면의 API 프로세스 이하 구역은 grafana.com 대시보드 [19004](https://grafana.com/grafana/dashboards/19004)를 acttub 라벨(`job="api"`·`environment`)로 옮긴 것이다 |
| `slack.tmpl` | Slack 메시지 형식(수신점을 처음 만들 때 붙여 넣는다) |
| `apply.py` | 렌더링 → Cloud와의 차이(`diff`) → 적용(`apply`). 적용 직전 Cloud 설정을 `.backups/`에 저장 |
| `check.sh` | 토큰·실제 stack 없이 실행하는 CI/로컬 검증 |

2026-09-28까지는 Terraform으로 관리했다. 최초 적용(2026-09-14)의 state가 보관되지 않아 이후 적용이 소유권 검사에서 멈췄고, stack 하나를 3명이 쓰는 규모에 state 보관 부담이 맞지 않아 걷어냈다. `apply.py`의 렌더링은 Terraform 설정이 실제로 만든 Cloud 객체와 차이 0으로 대조한 뒤 옮겼다.

## 관리 범위와 복구

`apply.py`는 아래 객체만 uid 기준으로 만들거나 덮어쓴다. **이 밖의 Cloud 설정은 바꾸거나 지우지 않는다.**

- `acttub-monitoring` 폴더와 동명 규칙 그룹(그룹 전체를 `rules.json` 기준으로 교체하므로 UI에서 이 그룹에 추가한 규칙은 사라진다)
- `acttub-service`/`acttub-operations`/`acttub-infrastructure` 대시보드
- `acttub-health-<환경>` 외부 점검. `health_origins`에서 뺀 환경의 점검은 `checks_unmanaged`로 보고만 하고 지우지 않는다

`acttub-local-prometheus` 데이터 소스(PDC), `acttub-monitoring-slack` 수신점, Synthetic Monitoring 초기화는 **처음 한 번 사람이 만든다**(아래 절). `apply.py`는 이들이 있는지만 확인하고 없으면 쓰기 전에 멈춘다. 전체 `notification_policy`는 만들지 않는다. [전체 정책 트리는 하나의 리소스](https://grafana.com/docs/grafana/latest/alerting/set-up/provision-alerting-resources/file-provisioning/)여서 다른 정책을 덮을 수 있기 때문이다. 각 규칙의 `notification_settings`로 전용 Slack 수신점에 직접 연결한다.

직접 통지의 `group_by`는 `alertname`·`grafana_folder`에 `environment`·`site`·`datasource`를 더한다. **서로 다른 규칙을 하나의 알림으로 합치는 구성은 아니다.** 공유 exporter·호스트·데이터 소스 문제는 원인별 공유 규칙으로 만들고, 수집 장애가 개별 서비스 규칙을 정상으로 바꾸지 않게 한다.
`group_wait=10s`, `group_interval=1m`, `repeat_interval=1h`이며 복구 메시지를 보낸다.

적용 전 `apply.py`는 같은 uid의 규칙이 다른 그룹에 있거나 소유 대시보드가 다른 폴더에 있으면 멈춘다. 적용 직전에 Cloud를 다시 읽어 그 사이 바뀌었으면 멈추고, 적용 뒤 다시 읽어 차이가 남으면 실패로 끝난다. Cloud UI/API의 동시 편집까지 잠그지는 못하므로 적용 중 같은 객체를 따로 편집하지 않는다.

**복구**: 코드 복구는 직전 커밋으로 되돌린 뒤 다시 `apply`한다. 적용 직전 Cloud 상태는 `.backups/before-<UTC>.json`(0600, Git 제외)에 있다. 이 파일은 조사·수동 복원용이며 모니터링 복구에 앱 DB 복원이나 Prometheus 볼륨 삭제를 섞지 않는다.

## 처음 한 번 사람이 준비하는 것

1. Grafana Cloud stack이 실제 **Free 플랜**인지 확인한다. 체험판·Pro 전환, 초과 사용 설정이 없는지 계정 화면에서 본다.
2. 세 사람이 각자 개인 계정으로 접속하고 stack 권한은 **Admin 1명, Viewer 2명**이다. [Portal 역할과 stack 역할은 연결될 수 있다](https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/security-and-access/authentication-and-permissions/).
3. `apply.py`용 stack 서비스 계정 토큰을 **만료 기한을 두고** 만든다. 폴더·대시보드·알림 규칙 쓰기와 데이터 소스 조회가 필요하다(2026-09-14부터 `acttub-setup` 서비스 계정을 쓴다). Synthetic Monitoring은 stack의 SM 데이터 소스 프록시로 호출하므로 별도 SM 토큰은 없다.
4. Synthetic Monitoring을 초기화하고 **공개 probe ID 한 개**와 수집 중인 **Cloud Metrics 데이터 소스 UID**를 `cloud.json`에 적는다(현재 probe 13 Seoul, `grafanacloud-prom`).
5. PDC network를 만들고 [공식 PDC 절차](https://grafana.com/docs/grafana-cloud/observe-and-act/connect-externally-hosted/private-data-source-connect/configure-pdc/)대로 agent를 준비한다. 대상은 `prometheus:9090`만 허용한다. Cloud에 Prometheus 데이터 소스를 uid `acttub-local-prometheus`, URL `http://prometheus:9090`, 해당 PDC network, 기본 데이터 소스 아님으로 만든다. 수집 구성은 [홈서버 배포 문서](DEPLOY-HOME.md)와 `deploy/monitoring` 절차를 따른다.
6. Slack incoming webhook을 **#서비스-장애**에 연결하고, 이름 `acttub-monitoring-slack`인 Slack 수신점을 만든다. 제목은 `[{{ .Status | toUpper }}] Acttub {{ .CommonLabels.environment }} / {{ .CommonLabels.site }}`, 본문은 `slack.tmpl`, 복구 메시지 켬. 실제 대상 채널은 webhook이 정한다.

토큰은 레포 밖 권한 `0600` 파일이나 비밀 관리 도구에서 환경변수로 공급한다. 셸의 `set -x`, 명령행 인수, 스크린샷, PR·로그에 토큰을 남기지 않는다. PDC signing token·환경별 수집 토큰은 홈서버 측에만 둔다.

## 적용 명령

먼저 레포 루트에서 토큰 없는 검증을 실행한다. Python 3.9 이상과 promtool 공식 배포본을 받을 HTTPS 연결이 필요하다.

```sh
deploy/monitoring/cloud/check.sh
```

토큰을 공급한 터미널에서:

```sh
cd deploy/monitoring/cloud
export GRAFANA_TOKEN="$(cat ~/.config/acttub/grafana-token)"   # 0600 파일
python3 apply.py diff     # 바뀔 규칙 uid·대시보드·점검만 출력한다. 아무것도 쓰지 않는다
python3 apply.py apply    # 같은 차이를 반영하고, 적용 뒤 차이가 없는지 다시 확인한다
```

`diff`가 `No changes.`이면 Cloud와 레포가 같다. 규칙·대시보드를 바꾸는 PR은 머지 뒤 `apply`까지를 한 묶음으로 본다.

### 환경 고르기

`cloud.json`의 `health_origins` 키가 외부 점검·환경별 규칙·대시보드 환경 선택의 공통 기준이다. `dev`·`prod` 중 하나 또는 둘 다를 허용하며 빈 객체와 다른 환경 이름은 거절한다. 수집 설정의 `config.environments`도 같은 환경 집합으로 맞춘다.

두 환경이면 대시보드 3개·규칙 59개(환경별 22개씩 + 공유 15개)·점검 2개이고 화면 기본값은 prod다. 한 환경이면 규칙 37개·점검 1개이며 다른 환경의 점검·규칙·화면 선택값을 만들지 않는다. 환경을 빼면 그 환경 규칙은 그룹 교체로 사라지지만 외부 점검은 남으므로, 점검 삭제는 사용량과 복구를 따로 검토해 사람이 한다.

## 외부 점검과 예산

HTTP Basic 점검은 공개 `https://<환경 origin>/health`에 GET을 보낸다. 위치 1개, 60,000ms 간격, 10,000ms 제한, redirect 금지, HTTPS 및 HTTP **200**만 성공이다.
Basic 점검은 JSONPath 대신 RE2 정규식을 지원하므로, `HealthResponse`의 기존 고정 JSON 순서와 타입 전체를 확인한다. 최상위 `status="ok"`와 services/model/keep_alive/commit의 유효한 형상을 요구하며 HTML·중첩 status·중복 키·깨진 JSON을 통과시키지 않는다. health 계약의 필드나 직렬화 순서를 바꾸면 이 선언과 검증도 함께 갱신한다.

계획량은 `선택한 주소 수 × 1 위치 × 60회/시간 × 24시간 × 31일`이다. dev만 선택하면 **44,640회**, 두 환경이면 **89,280회**이며 월 100,000회 기준 여유는 각각 **55,360회**, **10,720회**다. `apply.py`는 이 계획량이 월 100,000회를 넘는 설정을 거절한다. [현재 공개 가격표](https://grafana.com/pricing/)와 실제 stack 사용량을 함께 확인한다.
추가 위치 1곳은 같은 양을 더하므로 두 환경을 두 위치로 늘리면 178,560회가 된다. 새 주소·수동 시험·기존 다른 SM 점검도 실제 사용량에 더한다. 한도 초과 시 중단/재개 동작은 이 로컬 검증으로 확인하지 않았다.

외부 장애 시간 예산은 다음 1분 점검까지 최대 60초 + 세 번째 실패까지 120초 + 10초 요청 제한 + 다음 규칙 평가 최대 60초 + 통지 묶음 10초로 **설계상 최대 약 4분 10초**다. 전송/Cloud 지연은 실제 Slack 수신으로 확인하며, 5분 이내 수신하지 못하면 완료로 판정하지 않는다.
SM의 사용자 label에 `label_` 접두어를 붙이는 기본 tenant도 있으므로 외부 규칙은 선택한 환경의 고유한 `job="acttub-health-<환경>"`로 대상을 찾고 규칙에 환경 label을 명시한다. tenant의 label 모드를 바꾸지 않는다.
Cloud 외부 점검의 14일 보관과 로컬 Prometheus의 30일 보관은 서로 다르다. 로컬 지표를 `remote_write`로 Cloud Metrics에 복제하지 않는다.

## service

서비스 전체 화면은 공개 health, 요청량·5xx·평균·p95, 활성 알림, 마지막 갱신 시각을 보여 준다.
API 요청량은 HTTP 재요청·폴링·멱등 응답 재사용도 포함한다. 일반 API 지연은 실제 `latency_class="ordinary"`만 사용해 health·metrics와 분석·코치·리포트의 장시간 경로를 제외한다.
요청량·5xx 건수/비율·일반 지연의 요청 수 조건은 `acttub_http_requests_total`을 사용한다. API가 `status_class=1xx|2xx|3xx|4xx|5xx|other`와 `latency_class=ordinary|long_running`의 12개 조합을 0으로 먼저 등록하므로, 새 라우트/상태의 첫 오류도 다음 수집에서 증가량으로 관측한다. 평균·p95·라우트별 상세는 기존 `http_server_requests_seconds_*`를 사용한다.

- 공개 health 실패: Cloud SM 표본과 공개 URL을 확인한다. DB 연결은 별도 점검한다.
- API 5xx: 5분 3건 및 5% 경계를 함께 보고 Sentry에서 같은 환경·기간을 조사한다.
- 일반 p95: 5분 20요청 이상인지 확인한다. 2초 초과 5분 지속 기준이다.
- 데이터 소스: `vector(0)` 정상 조회가 가능한지, PDC 연결·Prometheus가 살아 있는지 확인한다. 전용 규칙의 Error/No Data는 2분 지속 후 경고한다.
- 필수 수집: api는 환경별, db-health·backup은 **environment 없는 공유 `up`**, node·prometheus는 `environment="shared"`다. exporter의 실제 내용은 환경별 custom 지표로 구분한다.

수집 실패/대상 누락은 2분 지속 규칙으로, 오래된 표본은 마지막 갱신에서 120초가 지나면 별도 규칙으로 확인한다. 90초 넘은 낡은 값은 서비스 조건 평가에서 제외한다. 개별 서비스는 Error/No Data에서 직전 상태를 유지한다. 정상 표본이 돌아오기 전에 복구로 해석하지 않는다.
정상 수집 중 요청량 0은 무사용이다. p95의 `표본 없음`은 완료 표본이 없다는 뜻이다. 수집 상태가 실패·수집 전이거나 조회 자체가 Error이면 빈 화면을 정상으로 읽지 않는다.
외부 실패가 최근 5분 3건 미만으로 줄어도 최신 점검이 실패이면 쿼리는 No Data를 반환한다. 수집 공백 전의 성공을 복구 근거로 쓰지 않으며, 최신의 신선한 성공 표본이 있어야 실패 조건 해소를 반환한다. 일반 API 지연은 확인된 5분 요청 수가 20건 미만이면 조건을 해소하지만, 20건 이상인데 histogram이 없거나 계산할 수 없으면 No Data를 반환한다. 별도 histogram 누락 규칙은 `+Inf` 버킷까지 확인한다.
필수 API 지표 규칙은 HTTP 카운터의 12개 조합과 코치 2경로(`/v2/coach/start`·`reply`)의 active count/sum/max를 확인한다. 이 경로 목록은 `HttpMonitoringConfiguration.ACTIVE_POST_ROUTES`와 같아야 한다. 수집 중인 다른 경로나 상태의 지표가 누락을 가리지 않으며 유휴 상태의 0은 정상적인 지표 존재로 취급한다.

## operations

`kind=analyze|coach_start|coach_reply|report`를 사용한다. coach confirm은 report 원장 종류를 사용한다.
새 고유 접수(`accepted`)·실행 시도(`attempts`)·실제 외부 호출(`external_calls`, dependency=storage/observation/speech/model)·재큐(`requeues`)·종료 사건(`terminal`)을 구분한다. 실제 외부 호출은 기존 Port 호출 경계이며 SDK 내부 네트워크 재시도 수는 아니다.
멱등 응답 재사용은 새 고유 접수를 늘리지 않는다. HTTP 요청 수에서 고유 접수 수를 빼 재사용 횟수로 계산하지 않는다.

분석 최초 대기·재시도 대기·실제 실행·최초 접수부터 경과를 구분한다. 시간 없는 이전 행은 `unmeasured`에 표시한다. 이 값이 있으면 시간 gauge의 0을 정상 완료로 읽지 않는다. 영상 길이를 실행시간으로 쓰지 않는다.
원장 상태의 내부 집계는 기본 5초 간격이고 Prometheus 수집은 30초 간격이다. 내부 갱신·수집·1분 평가·통지 대기가 쌓이는 시간을 고려한 값이며, 실제 Cloud/Slack의 전송 지연은 아래 인수 검증에서 측정한다.
분석 대기 p95는 `kind="analyze"`만 집계해 빠른 코치·리포트의 선점 대기가 분석의 대기 시간을 희석하지 않는다. 필수 External Operation 지표 규칙은 네 종류별 접수·시도·재큐·종료, 의존성별 호출, 대기/실행 상태와 미측정 상태, 최장 시간, histogram의 `+Inf` 버킷, 집계 성공/시각의 조합을 확인한다.
최장 대기는 60초부터 화면에서 주의 표시하고, 180초 초과 또는 최초 접수 후 300초 초과 미완료가 Slack 조건이다. 코치·리포트는 `acttub_http_active_seconds_max`가 60초를 넘는 **진행 중 서버 HTTP 요청**을 본다. count/sum/max는 현재 진행 중 값이므로 `rate()`를 적용하지 않는다. inflight 경로 label은 `route`, 완료 HTTP 경로 label은 `uri`다.

최종 실패는 최근 5분의 새 `external|unexpected` 종료 사건 1건부터 경고한다. `expected`는 장애에서 제외하고 `unclassified`는 별도 관측 정보 누락 경고다. **해제는 새 실패 발생 조건이 해소된 뜻이며 해당 External Operation의 성공이 아니다.** 카운터는 관측된 재시작을 `increase()`로 처리하지만 첫 scrape 이전이나 프로세스가 꺼진 수집 공백의 사건을 복구하지 못한다. 과거 원장 행을 새 종료 사건으로 소급 통지하지 않는다.
종료 사건은 커밋 후 카운터이므로 DB 상태 집계의 성공·시각과 독립적으로 평가한다. API 수집과 해당 종류/분류 카운터가 모두 존재하고 신선해야 평가하며, DB 집계가 멈췄다는 이유로 새 실패 통지를 지연시키지 않는다.
원장 상태/Lease와 Sentry·Langfuse의 같은 환경·기간을 대조하며 재시도·Lease 상태를 모니터링 화면에서 변경하지 않는다. 설정 가능한 조사 링크에는 토큰·사용자 ID·세션·프롬프트·원문을 넣지 않는다.

## infrastructure

호스트 CPU·메모리·디스크는 공유 값 한 번만 집계한다. 디스크 `mountpoint`는 실제 데이터가 저장되는 호스트 경로와 대조한다.
CPU 90% 이상 10분, 가용 메모리 10% 미만 5분, 디스크 여유 15% 미만 5분/5% 미만 즉시 경고다. JVM·GC·Hikari 연결 풀은 환경별로 본다.
DB는 인증된 내부 probe 실패가 2분 지속될 때 경고한다. 공개 health만 정상이라고 DB 정상으로 판단하지 않는다.
백업은 마지막 성공 이후 93,600초(26시간) 초과 또는 미해결 실패 5분 지속이 경고다. 상태 읽기 실패·누락·파손·목적지 불일치는 별도 경고로 보고 마지막 성공 값으로 숨기지 않는다. exporter 단절 때 백업 복구를 보내지 않는다.
백업 복구 여부는 상태 파일뿐 아니라 기존 [복원 검증 절차](DEPLOY-HOME.md)로 확인한다. 알림을 끄려고 성공 시각을 수동 갱신하지 않는다.

## 종료 시각 있는 일시 중지

Slack 메시지의 일시 중지 링크는 Grafana의 공식 `.SilenceURL`을 사용한다. [공식 silence 화면](https://grafana.com/docs/grafana/latest/alerting/configure-notifications/create-silence/)에서 Alertmanager를 **Grafana**로 두고 시작·종료 날짜/시각을 지정한다.
`owner=acttub-monitoring` 및 대상 `environment`·`site`·필요한 `target`을 확인하고, 점검 이유를 기록한 뒤 적용한다. 전체 공유 PDC 점검은 dev/prod와 shared에 영향을 주므로 미리 범위와 시간을 정한다.
종료 시각 없는 규칙 Pause나 반복 mute interval로 계획 점검을 대신하지 않는다. Silence는 평가·대시보드를 계속 유지하고 통지만 중지하며, 종료 후 조건이 남으면 다시 통지해야 한다. 실제 작은 dev 점검에서 종료 전 억제와 종료 후 재통지를 확인한다.

## 실제 stack 인수 검증 기록

아래 항목은 **실제 계정/서비스에서 확인한 뒤** 시각·증거 링크·성공/실패를 별도 기록한다. 이 문서의 존재나 로컬 HTTP fixture 성공으로 체크하지 않는다.

| 확인 | 실제 성공 조건과 기록 |
|---|---|
| 계정/권한 | 세 개인 로그인, Admin 1/Viewer 2. Viewer 두 명이 세 화면·알림을 조회하고 데이터 소스/규칙/통지 설정을 바꾸지 못함. Portal 상속까지 확인 |
| 비용/보관 | 실제 Free 플랜·활성 사용자 3명·해당 월 SM 누적 사용량, 선택한 환경의 계획량과 남은 여유, 14일/30일 구분. 추가 위치/주소 없음 |
| PDC | network ID 일치, 연결 agent 확인, Cloud에서 local `up` 조회 성공. PDC가 prometheus:9090 외 DB/다른 호스트에 연결할 수 없음 |
| 외부 health | 선택한 환경의 공개 health 정상 200+본문, 제어된 dev/격리 대상의 500·200+비정상본문·timeout·복구. 실제 외부 위치 한 개 |
| 통지 배선 | #서비스-장애에 최초 알림이 도착하고 환경/대상/조건/관측값/시각/대시보드/절차 링크가 올바름. webhook 채널을 실제 수신으로 확인 |
| 시간 | 공개 연속 실패 시작~Slack 최초 수신 ≤5분. 다른 규칙은 조건/지속 시간 충족 후 ≤2분. 실제 수신 시각을 기록 |
| 반복/해제 | 동일 장애 첫 통지 후 약 1시간 재알림, 정상 관측 뒤 해제, 해제 뒤 재발은 새 최초 통지. 실패 사건 해제를 실행 성공으로 표시하지 않음 |
| 데이터 단절 | 격리 환경 PDC/Prometheus Error/NoData 2분 경고. 개별 서비스 직전 상태 유지, 거짓 복구 없음. 필수 대상/지표/집계 갱신을 각각 끊고 정상 관측 재개로 복구 |
| 경계값 | HTTP 저트래픽/무표본, Expected Rejection, 새 실패 1건/미분류, 분석 180/300초, inflight 60초, 호스트·DB·백업 경계. 운영 데이터를 인위 변경하지 않음 |
| Silence | 종료 날짜/시각·일치 labels·영향받는 규칙을 확인. 기간 내 미전송, 종료 후 조건이 남으면 재통지 |
| 재적용/복구 | 실제 `diff` 검토, `apply` 뒤 `diff`가 변경 없음, 기존 타인 설정 보존, `.backups/`와 직전 커밋으로 복구 가능 |

로컬 `check.sh`는 `apply.py`의 렌더링(두 환경 59개·한 환경 37개, Error/NoData 처리, Slack 라우팅, health 본문 정규식)과 로컬 대체 HTTP API에서의 첫 적용/재적용 무변경/UI 수정 되돌림/타인 객체 보존/사전 조건 누락 시 무쓰기를 검증한다. promtool은 실제 규칙식으로 threshold·지속·해제·낮은 표본 수·무표본·counter reset·Expected Rejection·분류 누락·공유 exporter·수집 갱신 중단을 평가하고 대시보드 PromQL도 파싱한다.
수집 공백 뒤 실패만 돌아오는 경우와 histogram 누락은 promtool에서 **원래 쿼리의 No Data**를 검증한다. Prometheus 알림이 사라지는 것을 Grafana의 복구로 해석하지 않는다. 렌더링된 `noDataState`/`execErrState`가 서비스 규칙에서 `KeepLast`인지 별도로 검증하며, 실제 Grafana 평가기의 시간에 따른 동작과 Slack 전송은 위 실제 stack 인수 검증 범위로 남긴다.
Grafana Cloud의 실제 권한·과금·PDC 네트워크·Grafana 평가기의 실제 Error/NoData 상태 전이와 Slack 전달 지연/수신은 위 실제 확인의 몫이다. 최초 7일 관측 뒤 임계값과 대응 결과를 검토한다.

## 로컬 검증 기록 (2026-09-13, Terraform 시절)

macOS arm64에서 `deploy/monitoring/cloud/check.sh`가 종료 코드 0으로 완료됐다. 공식 checksum으로 내려받은 Terraform 1.16.2와 promtool 3.14.0을 사용했다.

- Terraform `fmt -check`, `validate`, native mock-provider 테스트 **3개 통과**.
- 실제 promtool에서 규칙 정의 **37개** 파싱, 표본/시간 입력 **63개 시나리오·99개 알림 판정·16개 원래 쿼리 판정 통과**. 환경별 Cloud 규칙으로 전개하면 **59개**다.
- 세 대시보드의 PromQL **48개 파싱 통과**.
- 실제 Grafana provider가 로컬 HTTP 경계와 통신하는 검사 **4개 통과**: 미리보기 무변경, 첫 적용/동일 재적용/기존 리소스 수정, 타인 리소스 보존, 소유권 충돌과 미리보기 뒤 변경 차단, 사설 probe 거절을 확인했다.
- 필수 지표의 유휴 0과 특정 종류/경로/분류 누락을 실제 promtool로 확인하는 **4개 검사·22개 판정 통과**. Python 검사는 provider 검사와 합쳐 8개다.
- 여섯 검토 보완은 기존 쿼리에서 실패를 먼저 확인한 뒤 수정했다: 외부 점검 공백 후 거짓 복구, 새 라우트의 첫 오류 세 건, histogram 누락과 실제 저사용량의 구분, 필수 지표 조합 누락, DB 집계 장애 중 종료 실패 통지, 빠른 코치 요청과 분석 대기 p95의 분리. 실제 provider 출력의 서비스 `KeepLast` 및 데이터 소스의 2분 Error/NoData 통지 설정도 확인했다.
- 실제 Cloud·Slack에는 요청을 보내지 않았다. Linux CI 전체 범위와 실제 stack 인수 검증은 별도로 수행한다.

## 환경 선택 로컬 검증 기록 (2026-09-14, Terraform 시절)

macOS arm64에서 `deploy/monitoring/cloud/check.sh`가 종료 코드 0으로 완료됐다.

- Terraform `fmt -check`, `validate`, native mock-provider 테스트 **9개 통과**: dev 단독·prod 단독·기본 두 환경, 빈/알 수 없는 환경 집합과 잘못된 origin 거절을 확인했다. dev 생성물에 prod 점검·규칙·필수 지표 쿼리·화면 선택값·공유 알림 링크가 없고, 두 환경의 기존 UID·대시보드 3개·규칙 59개·선택값·예산이 유지됐다.
- 실제 provider의 로컬 HTTP 경계 검사 **7개 통과**: dev 최초 적용과 변경 없는 재적용, 기존 UID와 규칙 설정을 유지하는 prod 확장, 확장 뒤 변경 없는 plan, 환경 축소의 `prevent_destroy` 차단을 확인했다. 선택하지 않은 prod의 예약된 점검/규칙 UID 충돌도 계속 거절했다.
- 기존 promtool 규칙·대시보드 쿼리 검사와 필수 지표 검사 **4개**가 통과했다. Python 검사는 provider 검사와 합쳐 **11개**다.
- 소유권·저장 계획 적용 도구와 규칙 원문의 조건/시간/KeepLast 계약은 변경하지 않았다. 실제 서버·Cloud·Slack 호출, 자격증명 조회, 운영 적용은 이 검증에 포함하지 않았다.
