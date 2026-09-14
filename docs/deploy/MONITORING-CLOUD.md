# Grafana Cloud 모니터링 적용·확인 절차

이 문서는 [전체 명세](MONITORING.md)의 Cloud 설정을 적용하고 확인하는 절차다.
로컬 구현·검증과 **실제 Cloud/Slack 확인은 별개**다. Cloud stack·사용자 권한·Free 플랜·PDC 연결·Slack 수신을 확인하기 전에는 운영 적용 완료로 기록하지 않는다.

## 저장소 설정과 공식 도구

선언 파일과 도구는 [`deploy/monitoring/cloud`](../../deploy/monitoring/cloud)에 있다.

| 파일 | 책임 |
|---|---|
| `versions.tf`, `.terraform.lock.hcl` | Terraform 1.16.2, 공식 `grafana/grafana` provider 4.46.0 고정 |
| `main.tf`, `rules.json` | 전용 폴더·PDC 데이터 소스·Slack 수신점·1분 평가 규칙 |
| `external.tf` | 선택한 dev/prod 공개 `/health`, 외부 위치 1곳, 60초 간격·10초 제한 |
| `dashboards/*.json`, `dashboards.tf` | 서비스 전체·분석/코치·서버/DB/백업, KST·최근 1시간 |
| `slack.tmpl` | 환경·대상·조건·관측값·시각·확인 링크·해제 의미·일시 중지 링크 |
| `manage.py` | 실제 설정 차이 미리보기, 소유권 충돌/적용 전 변경 확인, 저장된 Terraform 계획 적용 |
| `check.sh` | 시크릿·실제 stack 없이 실행하는 CI/로컬 검증 |

2026-09-13에 [공식 provider 4.46.0 릴리스](https://github.com/grafana/terraform-provider-grafana/releases/tag/v4.46.0), 해당 버전의 [데이터 소스 스키마](https://github.com/grafana/terraform-provider-grafana/blob/v4.46.0/docs/resources/data_source.md), [규칙 스키마](https://github.com/grafana/terraform-provider-grafana/blob/v4.46.0/docs/resources/rule_group.md), [Synthetic Monitoring 스키마](https://github.com/grafana/terraform-provider-grafana/blob/v4.46.0/docs/resources/synthetic_monitoring_check.md)를 대조했다.
실제 provider의 `terraform providers schema -json`, `validate`, `test`도 사용한다.
Terraform 배포본은 [HashiCorp 공식 배포](https://releases.hashicorp.com/terraform/1.16.2/), promtool은 수집 구성과 같은 [Prometheus 3.14.0 공식 배포](https://github.com/prometheus/prometheus/releases/tag/v3.14.0)를 사용한다.

provider 잠금 파일에는 개발 Mac(`darwin_arm64`)과 CI(`linux_amd64`)의 체크섬을 함께 기록한다. provider를 갱신할 때 Cloud 디렉터리에서 `terraform providers lock -platform=darwin_arm64 -platform=linux_amd64`로 공식 서명과 두 플랫폼의 해시를 확인한 뒤 커밋한다. CI의 `-lockfile=readonly`는 유지한다. [공식 잠금 명령](https://developer.hashicorp.com/terraform/cli/commands/providers/lock)

## 소유권과 복구

별도 Terraform state 하나가 `acttub-monitoring` 폴더·동명 규칙 그룹, `acttub-local-prometheus` 데이터 소스, `acttub-service`/`acttub-operations`/`acttub-infrastructure` 대시보드, `acttub-monitoring-slack` 수신점, `acttub-health-dev`/`acttub-health-prod` 점검을 소유한다.
외부 점검과 환경별 규칙은 `health_origins`에 선택한 환경에만 만든다. 소유권 충돌 검사는 두 환경의 예약된 이름/UID 모두에 유지하므로, 선택하지 않은 prod 이름에 기존 타인 자원이 있으면 가져오거나 덮지 않고 중단한다.
기존 Cloud Metrics 데이터 소스는 UID만 참조하며 기본 데이터 소스를 바꾸지 않는다.

전체 `grafana_notification_policy`는 만들지 않는다. [공식 문서](https://grafana.com/docs/grafana/latest/alerting/set-up/provision-alerting-resources/file-provisioning/)상 전체 정책 트리는 하나의 리소스여서 적용하면 다른 정책을 덮을 수 있기 때문이다.
각 규칙의 `notification_settings`로 전용 Slack 수신점에 직접 연결한다. 이 기능은 stack에서 사용할 수 있어야 하며, 실제 적용 전 `alertingSimplifiedRouting` 지원 및 규칙별 통지 설정 저장을 확인한다.

공식 provider는 직접 통지의 `group_by`에 `alertname`·`grafana_folder`를 요구한다. 여기에 `environment`·`site`·`datasource`를 더한다. **서로 다른 규칙을 하나의 알림으로 합치는 구성은 아니다.** 공유 exporter·호스트·데이터 소스 문제는 원인별 공유 규칙으로 만들고, 수집 장애가 개별 서비스 규칙을 정상으로 바꾸지 않게 한다.
`group_wait=10s`, `group_interval=1m`, `repeat_interval=1h`이며 복구 메시지를 보낸다. 선택한 환경에 24시간 적용한다.

`manage.py plan`은 기존 리소스를 GET으로 확인하고 Terraform의 실제 차이를 출력한다. state에 없는 같은 UID/이름, 다른 폴더에서 충돌하는 규칙 UID, 소유 그룹/수신점에 추가된 타인의 항목은 쓰기 전에 거절한다.
선택한 probe가 공개 위치이고 폐기되지 않았는지, Cloud Metrics 데이터 소스가 로컬 PDC 데이터 소스와 구분되는지 조회한다. stack이 규칙별 라우팅을 명시적으로 비활성화했으면 중단한다. 설정 조회에 기능 플래그가 없는 stack은 공식 UI에서 지원 여부를 확인한다.
`apply`는 저장된 계획·소스·대상 API·Cloud 상태가 미리보기와 일치하는지 다시 확인한다. 계획에서 리소스 삭제나 소유 범위 확대는 거절한다.
Terraform state 잠금 외에 Cloud UI/API를 통한 동시 변경까지 원자적으로 잠글 수는 없다. 관리자는 적용 중 같은 리소스를 별도로 편집하지 않는다. 적용 중 네트워크 오류가 났을 때는 state와 실제 UID부터 확인하며, 새 이름으로 복제하거나 전체 재생성을 하지 않는다.

복구는 직전 검증된 선언 파일과 **보호한 최신 state**를 함께 준비해 다시 미리보기·적용한다. 오래된 선언으로 복구할 때도 현재 state를 유지한다.
state를 잃으면 기존 Cloud 리소스가 있다고 해서 자동으로 소유권을 가져오지 않는다. 보호 사본을 복구하거나 실제 UID·내용을 대조한 뒤 각 리소스를 공식 Terraform import 절차로 가져온다. 모니터링 복구에 앱 DB 복원이나 Prometheus 볼륨 삭제를 섞지 않는다.

## 처음 준비할 실제 값과 시크릿

1. Grafana Cloud stack을 준비하고 실제 **Free 플랜**인지 확인한다. 체험판·Pro로 생성됐는지, 결제 전환·초과 사용 설정이 있는지 실제 계정 화면에서 확인한다.
2. 세 사람이 각각 개인 계정으로 접속하게 하고 stack 권한을 **Admin 1명, Viewer 2명**으로 설정한다. 초기 Admin은 사용자 본인이다. Cloud Portal에서 상속되는 권한까지 확인한다. [Cloud 권한 문서](https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/security-and-access/authentication-and-permissions/)처럼 Portal 역할과 stack 역할은 연결될 수 있다.
3. 자동화용 stack 서비스 계정과 만료가 있는 토큰을 별도로 만든다. 데이터 소스·폴더·대시보드·알림 provisioning에 필요한 권한만 부여한다. 초기 적용에 Admin 서비스 계정을 사용할 경우 사람 Admin 계정과 구분하고 토큰을 보호한다. Grafana HTTP API용 서비스 계정 토큰과 Cloud Access Policy 토큰은 서로 대체할 수 없다.
4. Synthetic Monitoring을 초기화하고 실제 지역의 API origin, 별도 SM API 토큰, **공개 probe ID 한 개**, 수집 중인 **Cloud Metrics 데이터 소스 UID**를 확인한다. 예제의 probe `1`을 실제 확인 없이 사용하지 않는다.
5. PDC network를 만들고 네트워크 ID와 agent용 signing token을 구분한다. [공식 PDC 절차](https://grafana.com/docs/grafana-cloud/observe-and-act/connect-externally-hosted/private-data-source-connect/configure-pdc/)를 따라 agent를 준비하며 대상은 `prometheus:9090`만 허용한다. 앱/수집 구성은 [홈서버 배포 문서](DEPLOY-HOME.md)와 `deploy/monitoring` 절차를 따른다.
6. Slack incoming webhook을 **#서비스-장애**에 연결한다. incoming webhook의 실제 대상 채널은 Slack에서 정해진다. Terraform의 `recipient`만 바꿔 채널이 바뀐다고 가정하지 않는다.

비밀 값은 레포 밖 권한 `0600`의 보호 파일/비밀 관리 도구에서 환경변수로 공급한다. 셸의 `set -x`, Terraform `TF_LOG`, 명령행 인수, 스크린샷, PR·로그에 토큰을 남기지 않는다.

| 환경변수 | 내용 |
|---|---|
| `GRAFANA_AUTH` | stack 서비스 계정 토큰 |
| `GRAFANA_SM_URL` | 실제 지역 SM API HTTPS origin (`/api/v1`은 붙이지 않음) |
| `GRAFANA_SM_ACCESS_TOKEN` | SM 설정용 API 토큰 |
| `TF_VAR_slack_webhook_url` | #서비스-장애에 이미 연결된 webhook |

PDC signing token·환경별 수집 토큰은 홈서버 측에만 공급한다. Cloud Terraform 변수에 복제하지 않는다.
**Terraform state와 저장된 plan에는 Slack webhook 평문이 들어갈 수 있다.** `sensitive`는 화면 표시를 가릴 뿐 암호화가 아니다. state·backup·plan·audit 파일은 Git에서 제외하고 `0600` 권한과 암호화된 보호 사본을 유지한다. plan을 CI artifact로 업로드하지 않는다.

## 적용 명령

먼저 레포 루트에서 시크릿 없는 검증을 실행한다. Python 3.9 이상과 공식 배포본을 받을 HTTPS 연결이 필요하며 시스템 도구를 설치·변경하지 않는다.

```sh
deploy/monitoring/cloud/check.sh
```

Terraform/promtool은 무시되는 `.validation/tools`에 checksum 검증 후 설치한다. 이미 준비한 정확한 버전은 `TERRAFORM`·`PROMTOOL` 절대 경로로 지정할 수 있다.

비밀 환경변수를 공급한 관리자 터미널에서:

```sh
cd deploy/monitoring/cloud
umask 077
cp example.tfvars.json stack.tfvars.json
# stack.tfvars.json에 실제 stack/공개 origins/probe/PDC network/Cloud datasource/디스크 경로를 입력한다.
export TERRAFORM="$PWD/.validation/tools/terraform"
python3 manage.py plan --vars stack.tfvars.json --plan changes.tfplan
# 표시된 실제 차이를 검토한 다음 같은 저장 계획을 적용한다.
python3 manage.py apply --plan changes.tfplan
python3 manage.py plan --vars stack.tfvars.json --plan reapply.tfplan
```

두 번째 plan은 변경 없음이어야 한다. API 적용 후 일부 상태만 반영된 실패는 위 소유권·복구 절차로 조사한다.
운영 적용과 Slack 전송은 별도 실제 작업이며 `check.sh`가 실행하지 않는다.

### dev만 먼저 설치하기

`health_origins`의 키가 외부 점검·환경별 규칙·대시보드 환경 선택의 공통 기준이다. `dev` 또는 `prod` 하나, 둘 다를 허용하며 빈 객체와 다른 환경 이름은 거절한다. 예제 파일은 기존처럼 두 환경을 포함한다. dev만 설치할 때는 `stack.tfvars.json`의 해당 값을 다음처럼 설정하고, 수집 설정의 `config.environments`도 같은 환경 집합으로 맞춘다.

```json
"health_origins": { "dev": "https://dev.acttub.com" }
```

이 구성은 대시보드 3개, dev 규칙 22개와 공유 규칙 15개(총 37개), 공개 점검 1개를 만든다. prod 점검·알림 규칙·필수 지표 검사를 만들지 않고 세 화면의 선택값과 공유 알림 링크도 dev로 향한다. 호스트·수집기·데이터 소스의 공유 규칙과 기존 평가 간격·KeepLast·Error/NoData 처리는 유지한다.

나중에 prod를 추가하려면 수집기의 prod 설정을 준비한 뒤 **기존 state를 유지한 채** `health_origins`에 prod origin을 추가하고 새 plan을 검토·적용한다. 두 환경에서는 기존 UID와 대시보드 3개·규칙 59개·점검 2개 구성을 유지하며 화면 기본값은 prod다. dev 점검과 기존 규칙의 UID는 바뀌지 않는다. 저장된 plan의 소스/Cloud 변경 확인과 소유권 검사는 그대로 적용한다.

이미 적용한 환경을 키에서 빼는 축소는 해당 점검 삭제가 되어 `prevent_destroy`가 차단한다. state를 지우거나 새 state로 다시 적용해 이 제한을 우회하지 않는다. 환경 철거는 소유 자원과 복구 방법을 별도로 검토한다.

## 외부 점검과 예산

HTTP Basic 점검은 공개 `https://<환경 origin>/health`에 GET을 보낸다. 위치 1개, 60,000ms 간격, 10,000ms 제한, redirect 금지, HTTPS 및 HTTP **200**만 성공이다.
Basic 점검은 JSONPath 대신 RE2 정규식을 지원하므로, `HealthResponse`의 기존 고정 JSON 순서와 타입 전체를 확인한다. 최상위 `status="ok"`와 services/model/keep_alive/commit의 유효한 형상을 요구하며 HTML·중첩 status·중복 키·깨진 JSON을 통과시키지 않는다. health 계약의 필드나 직렬화 순서를 바꾸면 이 선언과 검증도 함께 갱신한다.

계획량은 `선택한 주소 수 × 1 위치 × 60회/시간 × 24시간 × 31일`이다. dev만 선택하면 **44,640회**, 두 환경이면 **89,280회**이며 월 100,000회 기준 여유는 각각 **55,360회**, **10,720회**다. Terraform 출력 `external_checks_31_day_budget`도 선택한 수로 계산한다. [현재 공개 가격표](https://grafana.com/pricing/)와 실제 stack 사용량을 함께 확인한다.
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
필수 API 지표 규칙은 HTTP 카운터의 12개 조합과 코치 3경로·리포트 1경로의 active count/sum/max를 확인한다. 수집 중인 다른 경로나 상태의 지표가 누락을 가리지 않으며 유휴 상태의 0은 정상적인 지표 존재로 취급한다.

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
| 재적용/복구 | 실제 plan 차이 검토, apply 뒤 두 번째 plan 변경 없음, 기존 타인 설정 보존, 보호 state/시크릿 사본과 직전 설정으로 복구 가능 |

로컬 `check.sh`는 선언 파싱·실제 Terraform provider schema/plan과 로컬 대체 HTTP API의 첫 적용/재적용/충돌/변경 감지를 검증한다. promtool은 실제 규칙식으로 threshold·지속·해제·낮은 표본 수·무표본·counter reset·Expected Rejection·분류 누락·공유 exporter·수집 갱신 중단을 평가하고 대시보드 PromQL도 파싱한다.
수집 공백 뒤 실패만 돌아오는 경우와 histogram 누락은 promtool에서 **원래 쿼리의 No Data**를 검증한다. Prometheus 알림이 사라지는 것을 Grafana의 복구로 해석하지 않는다. Terraform native test와 실제 provider가 로컬 API에 보낸 `noDataState`/`execErrState`가 서비스 규칙에서 `KeepLast`인지 별도로 검증하며, 실제 Grafana 평가기의 시간에 따른 동작과 Slack 전송은 위 실제 stack 인수 검증 범위로 남긴다.
Grafana Cloud의 실제 권한·과금·PDC 네트워크·Grafana 평가기의 실제 Error/NoData 상태 전이와 Slack 전달 지연/수신은 위 실제 확인의 몫이다. 최초 7일 관측 뒤 임계값과 대응 결과를 검토한다.

## 로컬 검증 기록 (2026-09-13)

macOS arm64에서 `deploy/monitoring/cloud/check.sh`가 종료 코드 0으로 완료됐다. 공식 checksum으로 내려받은 Terraform 1.16.2와 promtool 3.14.0을 사용했다.

- Terraform `fmt -check`, `validate`, native mock-provider 테스트 **3개 통과**.
- 실제 promtool에서 규칙 정의 **37개** 파싱, 표본/시간 입력 **63개 시나리오·99개 알림 판정·16개 원래 쿼리 판정 통과**. 환경별 Cloud 규칙으로 전개하면 **59개**다.
- 세 대시보드의 PromQL **48개 파싱 통과**.
- 실제 Grafana provider가 로컬 HTTP 경계와 통신하는 검사 **4개 통과**: 미리보기 무변경, 첫 적용/동일 재적용/기존 리소스 수정, 타인 리소스 보존, 소유권 충돌과 미리보기 뒤 변경 차단, 사설 probe 거절을 확인했다.
- 필수 지표의 유휴 0과 특정 종류/경로/분류 누락을 실제 promtool로 확인하는 **4개 검사·22개 판정 통과**. Python 검사는 provider 검사와 합쳐 8개다.
- 여섯 검토 보완은 기존 쿼리에서 실패를 먼저 확인한 뒤 수정했다: 외부 점검 공백 후 거짓 복구, 새 라우트의 첫 오류 세 건, histogram 누락과 실제 저사용량의 구분, 필수 지표 조합 누락, DB 집계 장애 중 종료 실패 통지, 빠른 코치 요청과 분석 대기 p95의 분리. 실제 provider 출력의 서비스 `KeepLast` 및 데이터 소스의 2분 Error/NoData 통지 설정도 확인했다.
- 실제 Cloud·Slack에는 요청을 보내지 않았다. Linux CI 전체 범위와 실제 stack 인수 검증은 별도로 수행한다.

## 환경 선택 로컬 검증 기록 (2026-09-14)

macOS arm64에서 `deploy/monitoring/cloud/check.sh`가 종료 코드 0으로 완료됐다.

- Terraform `fmt -check`, `validate`, native mock-provider 테스트 **9개 통과**: dev 단독·prod 단독·기본 두 환경, 빈/알 수 없는 환경 집합과 잘못된 origin 거절을 확인했다. dev 생성물에 prod 점검·규칙·필수 지표 쿼리·화면 선택값·공유 알림 링크가 없고, 두 환경의 기존 UID·대시보드 3개·규칙 59개·선택값·예산이 유지됐다.
- 실제 provider의 로컬 HTTP 경계 검사 **7개 통과**: dev 최초 적용과 변경 없는 재적용, 기존 UID와 규칙 설정을 유지하는 prod 확장, 확장 뒤 변경 없는 plan, 환경 축소의 `prevent_destroy` 차단을 확인했다. 선택하지 않은 prod의 예약된 점검/규칙 UID 충돌도 계속 거절했다.
- 기존 promtool 규칙·대시보드 쿼리 검사와 필수 지표 검사 **4개**가 통과했다. Python 검사는 provider 검사와 합쳐 **11개**다.
- 소유권·저장 계획 적용 도구와 규칙 원문의 조건/시간/KeepLast 계약은 변경하지 않았다. 실제 서버·Cloud·Slack 호출, 자격증명 조회, 운영 적용은 이 검증에 포함하지 않았다.
