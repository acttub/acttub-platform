# 홈서버 모니터링 수집

명세는 [MONITORING.md](../../docs/deploy/MONITORING.md), 앱 배포 정본은
[DEPLOY-HOME.md](../../docs/deploy/DEPLOY-HOME.md)다. 이 디렉터리는 별도 Compose 프로젝트의
Prometheus·PDC·호스트·DB health·백업 수집을 담당한다. Cloud 선언 설정은 [cloud](cloud/)에 있다.
앱 배포 스크립트와 Actions의 앱 파일 전송에는 이 프로젝트를 넣지 않는다.

## 구성

| 서비스 | 이미지 고정 버전 | 접근 범위 |
|---|---|---|
| Prometheus | 3.14.0 | 전용 조회망·수집기망·선택한 환경의 수집망 |
| PDC | 0.0.64, OpenSSH 모드 | 전용 조회망만, 전달 목적지 `prometheus:9090`만 허용 |
| node exporter | 1.12.1 | 수집기망, `/proc`·`/sys`·호스트 루트 읽기 전용 |
| DB health·백업 exporter | Python 3.13.12 / Alpine 3.23 | 각각 환경별 수집망·수집기망, 또는 수집기망만 |

모든 이미지는 [compose.yml](compose.yml)에 버전과 SHA-256 digest를 함께 고정했다.
Prometheus는 **30초**마다 수집하고 `metrics` 볼륨에 **30일** 보관한다. `retention_size`는 필수이며
실측하지 않은 기본 용량을 운영값으로 넣지 않는다. 용량 상한이 먼저 적용되면 30일 이전 기록도
정리될 수 있고, WAL·index·compaction 임시 공간까지 제한하는 디스크 할당량은 아니다.

`config.environments`는 `dev`·`prod` 중 하나 이상을 포함하는 객체다. 빈 객체나 다른 환경 이름은
거부한다. DEV만 시작하려면 `config.example.json`을 복사한 설정에서 `environments.prod` 항목을
제거한다. 이 경우 운영 토큰·수집 대상·DB probe·수집망·백업 볼륨을 요구하거나 생성하지 않는다.
공유 호스트 지표는 선택한 환경 수와 관계없이 한 번만 수집한다.

앱의 `api`만 자기 프로젝트의 `default`와 `scrape`에 참가한다. 선택한 환경의 앱이 만든
`acttub-<env>_scrape`를 모니터링이 외부 네트워크로 참조한다.
API 별칭은 각각 `acttub-dev-api`·`acttub-prod-api`이고 DB·웹·터널·백업은 기존 기본망을 유지한다.
일반 앱 기동에 모니터링 네트워크나 토큰을 요구하지 않는다. 환경 전체를 철거할 때는 먼저
모니터링을 내려 수집망에서 분리한다. 모니터링을 내릴 때 `down -v`를 사용하지 않는다.

PDC는 OpenSSH의 `PermitRemoteOpen=prometheus:9090`를 사용하며 Go SSH 모드는 명시적으로 끈다.
조회망은 PDC의 Cloud HTTPS/SSH 발신을 위해 외부 통신이 가능하다. 앱 기본망·수집망에는
연결하지 않는다. 이는 모든 인터넷 발신을 차단하는 방화벽이 아니라 **Cloud에서 전달되는 요청의
목적지 제한**과 Docker 네트워크 분리다. Cloud 데이터 소스 URL은 `http://prometheus:9090`이다.
Prometheus 관리 변경 API·reload HTTP는 켜지 않으며 어떤 서비스도 호스트 포트를 공개하지 않는다.

## 최초 준비

1. 선택한 환경의 앱 `.env`에 서로 다른 난수 `MONITORING_TOKEN`과 `MONITORING_ENVIRONMENT=dev` 또는
   `prod`를 공급하고 기존 앱 배포를 실행한다. 관리 포트는 `9091`이며 Bearer 토큰으로
   `/actuator/prometheus`·`/actuator/health/db`에 접근한다. 토큰이 없으면 관리 접근만 거부한다.
2. 기존 환경별 백업 프로필이 만든 `acttub-<env>_backup_state` 볼륨과 성공 기록을 확인한다.
   관리 도구는 누락된 백업 볼륨을 새로 만들어 성공처럼 표시하지 않는다.
3. 이 디렉터리의 버전별 소스를 홈서버에 별도로 준비하고 `config.example.json`을
   `monitoring.json`으로 복사한다. 실제 프로젝트명·백업 버킷·DB명·Cloud의 PDC cluster·stack ID를
   맞춘다. Docker 데이터가 위치한 **마운트 지점**을 `data_mountpoint`로 지정한다.
   그 파일시스템은 node exporter 기동 전에 마운트되어 있어야 한다. 나중에 마운트를 추가·교체하면
   node exporter를 재생성하고 값이 실제 데이터 디스크와 같은지 다시 대조한다.

실제 Linux 홈서버에서 아래 읽기 전용 명령으로 디스크·가용 메모리를 먼저 확인한다.
개발 Mac/CI의 Docker VM 값은 운영 홈서버 실측으로 쓰지 않는다.

```bash
docker info --format '{{.DockerRootDir}}'
findmnt -T /var/lib/docker -o TARGET,SOURCE,FSTYPE,AVAIL,SIZE
python3 deploy/monitoring/manage.py --data-dir /var/lib/docker preflight
```

Docker data-root가 다르면 실제 경로를 사용한다. 애플리케이션 데이터 증가 여유, 30일 예상 수집량,
WAL·index·압축 중 임시 공간을 함께 고려해 `retention_size`에 `MB`·`GB`·`TB` 단위의 양의 정수를
넣는다. Prometheus 권고는 할당한 저장 공간의 최대 80~85%를 보관 상한으로 사용하는 것이다.
실제 수집 뒤 아래 명령과 볼륨 증가량을 대조하고 첫 7일 동안 다시 조정한다.

```bash
python3 deploy/monitoring/manage.py capacity
docker system df -v
```

`capacity`는 실제 5분 수집 속도로 30일의 sample 크기를 추정한다(2 bytes/sample 가정).
파일·index·WAL·압축 여유를 포함하지 않으므로 이것만으로 30일 보관을 보증하지 않는다.

시크릿은 로컬 `secrets/`에 선택한 환경의 `<env>-token`과 `pdc-token` 파일로 별도 공급한다.
DEV 전용 구성은 `dev-token`·`pdc-token`만 필요하다. `--without-pdc`는 PDC 기동만 생략하므로
PDC 설정과 토큰 파일 검증은 그대로 수행한다.
환경별 token은 앱과 동일해야 하고, PDC token은 Cloud의 PDC signing 자격증명이다.
파일 내용은 16자 이상 공백 없는 토큰, 파일 권한은 `600`, 디렉터리는 `700`으로 둔다.
실제 토큰을 명령 인자·셸 히스토리·저장소·로그에 쓰지 않는다.

```bash
chmod 700 secrets
chmod 600 secrets/dev-token secrets/pdc-token
```

운영도 선택했다면 `chmod 600 secrets/prod-token`을 추가로 실행한다.

도구가 생성하는 `/svc/acttub/monitoring`은 `700`이다. 그 안의 버전별 설정·시크릿 사본은
컨테이너의 서로 다른 UID가 자기 bind mount를 읽을 수 있도록 파일 `444`·하위 디렉터리 `755`를
쓴다. 호스트의 다른 사용자는 바깥 `700` 디렉터리를 통과할 수 없다. 이 바깥 권한을 넓히지 않는다.
각 서비스는 필요한 하위 디렉터리만 읽기 전용으로 받고, PDC token은 실행 시 환경변수로 읽어
컨테이너 명령 인자나 `docker compose config`에 남기지 않는다.

## 버전·검증·적용·복구

Python 3.9 이상과 Docker Compose가 필요하다. source 디렉터리는 버전별 보관하고, 새 소스나
시크릿을 적용할 때 새 버전명을 사용한다. 아래 예시는 배포 명령이며 실제 서버 적용은 별도
운영 작업으로 수행한다. 일반 앱 배포와 결합하지 않는다.
소스의 `compose.yml`은 환경별 연결을 채우기 전의 템플릿이므로 `render`가 생성한 릴리스로
Compose 검사·적용을 실행한다.

```bash
# 수정 내용을 고정된 버전 디렉터리로 렌더링한다. 이미 존재하는 버전은 덮어쓰지 않는다.
python3 deploy/monitoring/manage.py --config monitoring.json --secrets-dir secrets render monitoring-v1

# 실제 Compose 구조, pinned promtool·PDC·OpenSSH의 설정 수용 여부를 검사한다.
# PDC 접속이나 Cloud 설정 변경은 하지 않는다. 명령의 원시 오류 출력은 시크릿 보호를 위해 숨긴다.
python3 deploy/monitoring/manage.py check monitoring-v1
python3 deploy/monitoring/manage.py version monitoring-v1

# 초기 수집만 확인할 때: PDC를 시작하지 않는다. 이미 실행 중인 PDC를 중지하지는 않는다.
python3 deploy/monitoring/manage.py --without-pdc apply monitoring-v1
python3 deploy/monitoring/manage.py verify monitoring-v1

# PDC를 포함한 별도 프로젝트 적용; 동일 버전 재적용은 같은 설정을 사용한다.
python3 deploy/monitoring/manage.py apply monitoring-v1
python3 deploy/monitoring/manage.py version

# 소스/설정 변경은 새 버전으로 렌더링하고 같은 검사를 거친다.
python3 deploy/monitoring/manage.py --config monitoring.json --secrets-dir secrets render monitoring-v2
python3 deploy/monitoring/manage.py apply monitoring-v2

# 직전 성공 적용 버전으로 되돌린다. 명시한 이전 버전도 가능하다.
python3 deploy/monitoring/manage.py rollback
python3 deploy/monitoring/manage.py rollback monitoring-v1
```

다른 설치 경로는 모든 명령에 동일한 `--state-dir`을 지정한다. `apply`가 성공한 뒤에만 `current`와
`previous`를 갱신한다. 적용 실패는 자동 복구를 의미하지 않는다. 일부 컨테이너가 이미 변경됐을 수
있으므로 기록한 이전 버전을 명시해 다시 적용한다. 복구도 같은 프로젝트의 `metrics` 볼륨을
사용하고 DB 복원·DB/지표 볼륨 삭제를 수행하지 않는다. 디스크 자체 손실 때 과거 지표 손실을
수용하며, 소스·별도 보호한 시크릿을 준비해 새 볼륨에서 수집을 재개한다.

DEV 수집을 유지하며 운영을 추가할 때는 운영 앱의 토큰·수집망·기존 백업 상태 볼륨을 먼저 준비하고,
설정에 `environments.prod`를 추가한 새 릴리스를 렌더링·검사·적용한다. 같은 `project`와
`--state-dir`을 유지해야 기존 `metrics` 볼륨과 DEV 기록이 이어진다. 도구는 프로젝트명 변경을
거부하며, 환경을 추가하거나 이전 DEV 전용 릴리스로 복구해도 지표 볼륨을 삭제하지 않는다.
DEV 전용으로 복구하면 새 운영 수집은 중단되지만 기존 운영 지표는 보관 정책에 따라 남는다.

`verify`는 선택한 환경의 scrape·DB probe·백업 상태 읽기와 목적지 일치를 검사한다. 최신 백업 성공/26시간
초과·미해결 실패는 아래 지표로 따로 판정한다. PDC 실제 연결, Cloud 조회/권한, Slack 알림은
Cloud 쪽 실제 검증으로 확인해야 한다. 컨테이너가 실행 중이라는 사실만으로 이를 통과시키지 않는다.

## 지표 계약

| job | environment | 의미 |
|---|---|---|
| `api` | dev/prod | 환경별 인증된 API metrics. scrape 설정이 환경 label을 소유 |
| `db-health` | `up`에는 없음, payload에는 dev/prod | 공유 HTTP exporter가 환경별 관리 DB health를 검사 |
| `backup` | `up`에는 없음, payload에는 선택한 dev/prod | 공유 exporter가 선택한 환경의 읽기 전용 상태 볼륨을 검사 |
| `node` | shared | 호스트 CPU·MemAvailable·지정한 데이터 마운트의 filesystem |
| `prometheus` | shared | 수집기 자체 상태와 수집량 |

API가 노출한 중복 `environment`는 scrape label로 치환하고 `exported_environment`는 제거한다.
DB와 백업 exporter의 `up=0`은 수집기 자체 단절이다. DB probe 실패는 HTTP exporter가 살아 있어도
`acttub_db_probe_success{environment="dev|prod"}=0`이다. probe는 DNS·본문 읽기까지 포함해 환경당
3초의 실행 상한을 쓰고(두 환경 합계 약 6초, scrape timeout은 10초),
리다이렉트·환경변수 HTTP proxy를 사용하지 않으며, 200 응답의 JSON `status=UP`만 성공이다.
동시에 한 scrape만 처리하고 겹친 요청은 503으로 거부하므로 probe 프로세스가 무제한 늘지 않는다.
`acttub_db_probe_duration_seconds`는 실제 점검 소요 시간이다.

백업 exporter는 AWS·DB 자격증명을 받지 않는다. 기존 백업의 root 소유 `600` 파일과 `700`
디렉터리를 읽기 위해 UID 0으로 실행하지만 Linux capabilities를 전부 제거하고 루트 파일시스템과
상태 볼륨을 읽기 전용으로 둔다. 원본 상태 파일 권한은 넓히지 않는다.

| 지표 | 값 |
|---|---|
| `acttub_backup_state_read_success` | JSON 구조·시각 검증까지 성공하면 1 |
| `acttub_backup_target_match` | 설정한 버킷/prefix/DB와 상태의 목적지가 같으면 1 |
| `acttub_backup_last_success_timestamp_seconds` | 일치하는 목적지의 유효한 성공 epoch, 없거나 신뢰할 수 없으면 0 |
| `acttub_backup_unresolved_failure` | failed 또는 last_error가 남으면 1; running만으로 실패를 지우지 않음 |
| `acttub_backup_state{state="…"}` | 아래 일곱 고정 상태 중 하나만 1, 나머지는 0 |

상태는 `ok`, `unreadable`, `missing`, `corrupt`, `target_mismatch`, `no_success`,
`unresolved_failure`다. 목적지 불일치는 미해결 실패보다 먼저 표시되며 개별 failure 지표는 유지한다.
2000년 이전·현재보다 5분 넘게 미래·NaN·Infinity·bool·문자열 시각은 `corrupt`다. 성공 없는 최초 실행은
`no_success`, 성공 전 최초 실패도 `unresolved_failure`로 표시한다. `ok`는 읽기 가능한 정상 상태이며
26시간 경과 여부는 성공 시각으로 별도 평가한다. 오류 원문·객체 주소·해시·토큰은 지표/label/로그에 넣지 않는다.

## 자동 검증과 남은 운영 검증

```bash
python3 -m unittest discover -s deploy/monitoring/tests -v
deploy/home/deploy-test.sh

# 기존 앱 스모크의 모든 검증이 성공한 이미지에만 재사용 태그를 만든다.
SMOKE_EXPORT_API_IMAGE=acttub-api:monitoring-ci \
SMOKE_EXPORT_WEB_IMAGE=acttub-web:monitoring-ci deploy/home/smoke.sh

# 앱을 재빌드하지 않는다. 운영/Cloud 자격증명 없이 격리 프로젝트만 만든다.
MONITORING_SMOKE_API_IMAGE=acttub-api:monitoring-ci \
MONITORING_SMOKE_WEB_IMAGE=acttub-web:monitoring-ci deploy/monitoring/smoke.sh
```

통합 스모크는 실제 앱 배포·Prometheus scrape·관리 인증·공개 경로 차단·DB 장애/복구·root `600`
상태 읽기·네트워크 차단·과거 지표 영속·모니터링 중단 중 앱 배포·재적용/복구를 확인한다.
운영 토큰·수집망·백업 볼륨이 없는 DEV 전용 적용부터 시작해, 두 환경으로 확장하고 DEV 전용으로
복구한 뒤에도 이전 지표가 남고 운영 앱 컨테이너가 유지되는지 검사한다.
PDC의 실제 OpenSSH remote SOCKS 전달도 임시 SSH 서버에서 검사한다. Prometheus HTTP는 통과하고
다른 호스트와 포트는 거부되어야 한다. 외부 터널 상대만 대체하며 Cloud API나 Slack을 부르지 않는다.
테스트가 만든 고유 `soma520-*` 컨테이너·볼륨만 정리하며 재사용 앱 이미지 태그는 남긴다.

별도 실제 홈서버에서 node의 CPU·`MemAvailable`·데이터 filesystem 값을 `/proc/stat`,
`/proc/meminfo`, `df`와 대조하고 30일 예상 저장량·여유 공간을 확인한다. 실제 Cloud/PDC 조회,
세 계정 권한·Free 사용량·Slack 최초/반복/복구 수신도 확인해야 한다. 로컬 테스트 통과는 이 운영
검증의 완료를 의미하지 않는다.

설정 근거: [Grafana PDC 목적지 제한](https://grafana.com/docs/grafana-cloud/observe-and-act/connect-externally-hosted/private-data-source-connect/scalability-and-security/),
[PDC 0.0.64 소스](https://github.com/grafana/pdc-agent/tree/v0.0.64),
[Prometheus 저장·용량 정책](https://prometheus.io/docs/prometheus/latest/storage/),
[node exporter 호스트 경로](https://github.com/prometheus/node_exporter#docker).
