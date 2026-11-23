# 홈서버 모니터링 수집

앱 배포 정본은 [DEPLOY-HOME.md](../../docs/deploy/DEPLOY-HOME.md)다. 이 디렉터리는 별도 Compose 프로젝트의
Prometheus·PDC·호스트·DB health·백업 수집과 앱 로그 전송(Alloy)을 담당한다. Cloud 선언 설정은 [cloud](cloud/)에 있고, 적용·확인
절차는 [MONITORING-CLOUD.md](../../docs/deploy/MONITORING-CLOUD.md)다.
앱 배포 스크립트와 Actions의 앱 파일 전송에는 이 프로젝트를 넣지 않는다.

## 배경과 범위

dev·운영의 요청량·오류·응답시간, 분석·코치·리포트 실행, 호스트·DB·백업 상태를 한곳에서 보고 Slack으로 알리려고
둔다. Sentry와 Langfuse는 상세 조사용이다. 반복 보고 억제와 수신 누락이 있어 실제 실행량·실패율을 대신하지 않고,
Langfuse 수치는 완전한 비용 정산 자료가 아니다.

- 홈서버 Prometheus가 지표를 수집·저장하고, Grafana Cloud가 PDC(Private Data source Connect, 사설 데이터 소스
  연결)로 그것을 직접 조회해 대시보드·규칙 평가·통지를 맡는다.
- 감시를 홈서버에만 두면 전원·회선 장애 때 알림도 함께 멈춘다. 그래서 규칙 평가와 통지는 Cloud가 하고,
  Cloud 외부 점검이 두 환경의 공개 접근을 따로 확인한다.
- 추가 월 비용 없이 Grafana Cloud Free로 운영한다. 사람 계정과 권한은 [MONITORING-CLOUD.md](../../docs/deploy/MONITORING-CLOUD.md#처음-한-번-사람이-준비하는-것)를
  따른다.
- 화면은 Cloud 계정 로그인으로 연다. 초기의 Tailscale 전용 화면 접근 결정은 이 방식으로 대체했고, Tailscale은
  서버 관리·배포에 유지한다. PDC는 브라우저 접속을 Tailscale로 제한하는 기능이 아니다.
- 선언 설정으로 교체할 수 있는 관측 구성이라 별도 ADR을 두지 않는다. 설계 이유는 이 절에 둔다. 로그를 서버 밖에
  저장하는 것([ADR-038](../../docs/ADR.md#adr-038-앱-로그는-서버-밖-grafana-cloud-loki에-저장한다))과 Docker 소켓 프록시
  예외([ADR-039](../../docs/ADR.md#adr-039-docker-소켓은-읽기-호출만-통과시키는-프록시-하나만-쥐고-alloy는-그-프록시로만-읽는다))만 ADR로 둔다.
- 앱 로그는 지표와 달리 Grafana Cloud Loki에 저장한다. 구성은 [로그 전송](#로그-전송)이다.

알아 둘 한계:

- 홈서버·회선·PDC가 끊긴 동안에는 Cloud에서 로컬의 과거 지표도 조회할 수 없고 서비스 지표 평가도 실패한다.
  그래서 데이터 소스 연결 오류와 외부 접속 점검을 따로 감시한다.
- Cloud·Slack의 가용성은 각 제공자에 의존한다.

하지 않는 것:

- 홈서버 Grafana·별도 Alertmanager 운영, 로컬 지표 전체의 Cloud Metrics 복제(`remote_write`)
- `api`·`web`·`proxy` 밖의 컨테이너 로그 전송(`db`는 느린 쿼리 로그를 켠 뒤에 더한다), 커널·`docker.service` 밖의
  호스트 저널(sshd 접속 기록, 이 서버의 다른 서비스) 전송, 로그 기반 알림
- 새 분산 추적·Sentry 트레이싱 활성화
- AI 비용 정산 완성, Langfuse 토큰 누락 보정, 사용자 수·전환·재방문 분석을 Grafana로 옮기는 것
- 전체 컨테이너 수집을 위한 cAdvisor. Docker socket은 읽기 호출만 통과시키는 `socket-proxy`에만 둔다(ADR-039)
- 공개 관리 포트와 DB 공개 연결
- 관측 지표를 정확한 정산 원장으로 쓰는 것, 사용자·프롬프트·영상 원문 수집
- 디스크 손실에 대비한 지표의 별도 재해 복구 백업과 호스트 고가용성 구성
- Cloud·Slack 자체 장애의 독립 감시, 유료 플랜·유료 사용자 추가
- 운영 데이터 변경이나 운영 서버 전원 차단을 기본 검증 절차로 쓰는 것

설계 근거: [PDC 공식 안내](https://grafana.com/blog/unify-and-query-private-network-data-in-grafana-cloud-private-data-source-connect-is-now-ga/),
[PDC 문서](https://grafana.com/docs/grafana-cloud/observe-and-act/connect-externally-hosted/private-data-source-connect/).
요금·점검 수·데이터 없음 처리의 근거는 [MONITORING-CLOUD.md](../../docs/deploy/MONITORING-CLOUD.md)에 있다.

## 구성

| 서비스 | 접근 범위 |
|---|---|
| Prometheus | 전용 조회망·수집기망·선택한 환경의 수집망 |
| PDC | 전용 조회망만. OpenSSH 모드로 전달 목적지 `prometheus:9090`만 허용 |
| node exporter | 수집기망, `/proc`·`/sys`·호스트 루트 읽기 전용 |
| DB health·백업 exporter | 각각 환경별 수집망·수집기망, 또는 수집기망만 |
| Alloy(`logs`를 켰을 때만) | Cloud로 나가는 전용 로그망과 내부 `docker-api` 망. 소켓 없음, 이미지의 비root 사용자(473)에 호스트 `systemd-journal` 그룹만 더해 `/var/log/journal` 읽기 전용, 자체 HTTP는 컨테이너 안 `127.0.0.1:12345` |
| socket-proxy(`logs`를 켰을 때만) | 내부 `docker-api` 망만. Docker 소켓 읽기 전용 bind, `alloy`에서 온 허용 목록의 읽기 호출만 통과 |

모든 이미지는 [compose.yml](compose.yml)·[compose.logs.yml](compose.logs.yml)에 버전과 SHA-256 digest를 함께 고정했다.
Prometheus는 **30초**마다 수집하고(`manage.py`가 렌더하는 `scrape_interval`) `metrics` 볼륨에 **30일**
보관한다(`compose.yml`의 `retention.time`, `check`가 대조한다). 다른 문서는 이 두 값을 여기서 가리킨다.
`retention_size`는 필수이며 실측하지 않은 기본 용량을 운영값으로 넣지 않는다. 용량 상한이 먼저 적용되면
보관 기간 이전 기록도 정리될 수 있고, WAL·index·compaction 임시 공간까지 제한하는 디스크 할당량은 아니다.

`config.environments`는 `dev`·`prod` 중 하나 이상을 포함하는 객체다. 빈 객체나 다른 환경 이름은
거부한다. DEV만 시작하려면 `config.example.json`을 복사한 설정에서 `environments.prod` 항목을
제거한다. 이 경우 운영 토큰·수집 대상·DB probe·수집망·백업 볼륨을 요구하거나 생성하지 않는다.
공유 호스트 지표는 선택한 환경 수와 관계없이 한 번만 수집한다.

앱의 `api`만 자기 프로젝트의 `default`와 `scrape`에 참가한다. 선택한 환경의 앱이 만든
`acttub-<env>_scrape`를 모니터링이 외부 네트워크로 참조한다.
API 별칭은 각각 `acttub-dev-api`·`acttub-prod-api`이다. DB·백업은 기본망, 웹은 `front`, 터널은 `edge` 망에 있다(앞단 proxy의
망 별칭, [`deploy/home/compose.yml`](../home/compose.yml)).
일반 앱 기동에 모니터링 네트워크나 토큰을 요구하지 않는다. 환경 전체를 철거할 때는 먼저
모니터링을 내려 수집망에서 분리한다. 모니터링을 내릴 때 `down -v`를 사용하지 않는다.

PDC는 OpenSSH의 `PermitRemoteOpen=prometheus:9090`를 사용하며 Go SSH 모드는 명시적으로 끈다.
조회망은 PDC의 Cloud HTTPS/SSH 발신을 위해 외부 통신이 가능하다. 앱 기본망·수집망에는
연결하지 않는다. 이는 모든 인터넷 발신을 차단하는 방화벽이 아니라 **Cloud에서 전달되는 요청의
목적지 제한**과 Docker 네트워크 분리다. Cloud 데이터 소스 URL은 `http://prometheus:9090`이다.
Prometheus 관리 변경 API·reload HTTP는 켜지 않으며 어떤 서비스도 호스트 포트를 공개하지 않는다.

## 최초 준비

1. 선택한 환경의 앱 `.env`에 서로 다른 난수 `MONITORING_TOKEN`과 `MONITORING_ENVIRONMENT=dev` 또는
   `prod`를 공급하고 기존 앱 배포를 실행한다. 수집기는 이 토큰을 Bearer로 보내 API 관리 포트의 경로를
   읽는다(포트는 앱 `compose.yml`, 경로와 접근 규칙은 [CONTRACT §6-4](../../apps/api/CONTRACT.md#6-4-관리용-모니터링-경로)).
   토큰이 없으면 관리 접근만 거부한다.
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
수용하며, 소스·별도 보호한 시크릿을 준비해 새 볼륨에서 수집을 재개한다. API 쪽 계측을 되돌릴 때는
[DEPLOY-HOME §4](../../docs/deploy/DEPLOY-HOME.md#4-코드-배포-복구)의 앱 복구 절차를 쓴다.

DEV 수집을 유지하며 운영을 추가할 때는 운영 앱의 토큰·수집망·기존 백업 상태 볼륨을 먼저 준비하고,
설정에 `environments.prod`를 추가한 새 릴리스를 렌더링·검사·적용한다. 같은 `project`와
`--state-dir`을 유지해야 기존 `metrics` 볼륨과 DEV 기록이 이어진다. 도구는 프로젝트명 변경을
거부하며, 환경을 추가하거나 이전 DEV 전용 릴리스로 복구해도 지표 볼륨을 삭제하지 않는다.
DEV 전용으로 복구하면 새 운영 수집은 중단되지만 기존 운영 지표는 보관 정책에 따라 남는다.

`verify`는 선택한 환경의 scrape·DB probe·백업 상태 읽기와 목적지 일치를 검사한다. 최신 백업의 경과
시간·미해결 실패는 아래 지표로 따로 판정한다. PDC 실제 연결, Cloud 조회/권한, Slack 알림은
[Cloud 쪽 실제 검증](../../docs/deploy/MONITORING-CLOUD.md#실제-stack-인수-검증-기록)으로 확인해야 한다.
컨테이너가 실행 중이라는 사실만으로 이를 통과시키지 않는다.

## 로그 전송

`monitoring.json`에 `logs`가 있을 때만 `render`가 릴리스에 [compose.logs.yml](compose.logs.yml)과 렌더한
[config.alloy](config.alloy)를 넣는다. Alloy 컨테이너 하나가 `socket-proxy`를 거쳐 Docker API로
같은 호스트의 컨테이너 로그를 읽고, 호스트 저널에서 커널과 `docker.service` 줄을 읽는다. 프록시는 Alloy가 쓰는 읽기 호출만 통과시키고 쓰기 호출은 모두 거절한다(ADR-039).
허용 목록을 바꾸면 `manage.py`의 `SOCKET_PROXY_COMMAND`도 같이 바꾼다. 둘이 다르면 `validate`가 멈춘다.

```json
"logs": {"loki_url": "https://logs-prod-<번호>.grafana.net/loki/api/v1/push", "loki_user": "<숫자 User>", "environments": ["dev", "prod"], "journal_gid": 999}
```

- `loki_url`·`loki_user`는 Cloud Portal의 stack → Loki 카드 → **Details**에 있는 URL과 User다. URL은 지역마다
  모양이 달라 직접 만들지 않고 복사한다. `https`만 받는다.
- 토큰은 `secrets/loki-token`(권한 `600`)에 둔다. `logs:write` 범위의 access policy token이다. 릴리스의
  `alloy/loki-token`을 Alloy가 `password_file`로 읽으므로 명령 인자·컨테이너 환경변수·`docker compose config`에 남지 않는다.
- `environments`는 `config.environments` 안에서 고른다. 로그 한도에 걸리면 여기서 `dev`만 뺀다. 지표 수집은 그대로다.
- `journal_gid`는 호스트 `getent group systemd-journal`의 숫자다. 저널 파일은 `root:systemd-journal` `0640`이라 Alloy가
  이 그룹으로만 읽는다. 값이 틀리면 Alloy는 오류 없이 저널 줄을 하나도 읽지 못한다.

보내는 것:

- 대상은 선택한 환경의 Compose 프로젝트에서 서비스가 `api`·`web`·`proxy`인 컨테이너다. 무중단 배포로 잠시 둘이 된
  같은 서비스도 함께 읽는다. 다른 서비스·프로젝트·모니터링 자신의 로그는 읽지 않는다.
- 호스트 저널은 커널(`_TRANSPORT=kernel`)과 Docker 데몬(`_SYSTEMD_UNIT=docker.service`)뿐이다. 둘을 읽는 단계의 조건
  (`matches`)으로 고르므로 sshd·cron·이 서버의 다른 서비스 줄은 Alloy 밖으로 나가지 않는다. 처음 켜면 최근 7시간부터 읽는다.
- 표시(label)는 `environment`(`dev`·`prod`, 지표의 같은 이름 label과 같은 값)와 `service`뿐이다. 호스트 저널은 dev·운영이
  나뉘지 않아 호스트 지표처럼 `environment="shared"`이고 `service`는 `kernel`·`docker.service`다. Cloud가 `service`로
  `service_name`을 더한다. 요청 ID·사용자 ID처럼 값이 많은 것은 label로 만들지 않고 줄 안에서 찾는다.
- 줄 형식은 [홈서버 배포 「로그」](../../docs/deploy/DEPLOY-HOME.md#로그)가 정한다(nginx·api 모두 한 줄 JSON). 그 전의
  일반 글자 줄도 같은 규칙으로 다룬다. `trace_id`·`user_id`는 줄 안의 값으로만 남는다.
- 버리는 줄: 경로가 `/health`·`/actuator`인 요청 줄(nginx `path`, api `route`, 일반 글자 `GET /health …`). 외부 점검이
  1분마다 부른다.
- 지우는 것: 일반 글자 요청 줄과 nginx error 줄(`request`·`upstream`·`referrer`)의 쿼리 문자열. 검색어와 콜백 키가 실린다.
  JSON 요청 줄의 `path`에는 nginx가 쿼리를 싣지 않는다.
- 가리는 값: `Bearer` 뒤 값, JWT 모양 값, 주소나 줄 안 `이름=값`의 `token`·`code`·`state`·`key`·`secret`·`password`·서명 값과 S3
  서명(`X-Amz-*`), JSON의 `password`·`token`·`secret`·`authorization`·`cookie` 같은 키 값은 `[REDACTED]`로,
  이메일은 `[EMAIL]`로 바꾼다. 64KiB가 넘는 줄은 자른다. 이 규칙은 정해진 모양만 잡으므로 로그에 개인정보를 쓰지 않는
  것이 먼저다.
- 읽은 위치(컨테이너·저널)는 `alloy-data` 볼륨에 남아 Alloy를 다시 띄워도 이어 읽는다. 처음 켜면 이미 떠 있는 컨테이너의 남은 로그
  파일(앱은 20MB씩 5개)을 처음부터 보낸다.
- Cloud가 끊기면 보내지 못한 묶음은 메모리 큐(기본 10MiB)에 쌓이고 큐가 차면 읽기를 멈춘다. 묶음마다 최대 10번,
  간격을 늘려 최대 5분까지 재시도한 뒤 버린다. 메모리 상한은 256MiB이고 Alloy가 그 90%를 Go 메모리 목표로 쓴다.

끄기: `logs`를 뺀 설정으로 새 릴리스를 렌더·적용한다. `apply`가 고아 컨테이너를 지우므로 Alloy와 socket-proxy가 멈춘다. `logs`가
없던 이전 릴리스로 `rollback`해도 같다. 위치 볼륨은 지우지 않으므로 다시 켜면 이어 읽는다.
`--without-pdc` 적용은 Cloud에 연결하지 않으므로 Alloy와 socket-proxy도 띄우지 않는다.

### dev에 처음 켜는 순서

서버에서 사람이(또는 승인받은 작업자가) 한다. 이 순서는 저장소 작업이 실행하지 않는다.

1. Cloud Portal에서 stack의 Loki URL·User를 확인하고, `logs:write`만 가진 access policy와 만료 기한 있는 토큰을 만든다.
   토큰은 홈서버 `secrets/loki-token`에 `600`으로 둔다.
2. `monitoring.json`에 `logs`를 넣는다. 처음에는 `"environments": ["dev"]`로 시작한다.
3. 새 버전으로 `render` → `check`(고정 Alloy가 설정을 `validate`한다) → `apply`한다.
4. `docker compose ... ps alloy socket-proxy`가 둘 다 running이고, `docker logs <프로젝트>-alloy-1`에 오류가 반복되지 않고,
   `docker logs <프로젝트>-socket-proxy-1`에 `blocked request`가 없는지 본다. 있으면 Alloy가 허용 목록 밖의 호출을 한 것이다.
5. Grafana Explore에서 Loki 데이터 소스로 `{environment="dev", service="api"}`를 조회해 최근 줄이 들어오는지,
   `/health` 줄이 없고 가린 값이 `[REDACTED]`인지 본다.
6. 하루 뒤 Cloud의 로그 사용량(하루 GB × 31이 50GB 안인지)과 `docker stats`의 Alloy 메모리를 잰다. 괜찮으면
   `environments`에 `prod`를 더해 같은 순서로 적용한다.

### 이미 켠 서버에 호스트 저널 더하기

SOMA-1095 구성(Alloy가 root, `alloy` 볼륨)으로 켠 서버에 이 버전을 반영할 때 사람이 한다.

1. `getent group systemd-journal`의 숫자를 `monitoring.json`의 `logs.journal_gid`에 넣고 새 버전으로 `render` → `check` → `apply`한다.
2. 위치 볼륨이 `alloy-data`로 바뀌어 Alloy가 컨테이너 로그를 처음부터 다시 읽는다. 같은 시각·같은 줄은 Loki가 한 번만 두지만
   다시 보낸 양은 그날 사용량에 더해진다.
3. `docker exec <프로젝트>-alloy-1 id`가 `uid=473`이고 그룹에 위 숫자가 있는지 본다.
4. Grafana Explore에서 `{environment="shared"}`의 `service` 값이 `kernel`·`docker.service` 둘뿐인지 본다. 대상 밖 단위가 없는지
   `{environment="shared"} |~ "sshd|CRON|hermes|langfuse"`가 비어 있는지로 확인한다.
5. 하루 뒤 서버에서 `sudo journalctl -k --since yesterday --until today | wc -c`와
   `sudo journalctl -u docker.service --since yesterday --until today | wc -c`로 하루 양을 재고 Cloud 사용량 증가와 맞춘다.
6. 새 Alloy가 잘 돌면 옛 위치 볼륨 `<프로젝트>_alloy`를 `docker volume rm`으로 지운다. 지우면 되돌릴 수 없으므로 4번 확인 뒤에 한다.

## 지표 계약

| job | environment | 의미 |
|---|---|---|
| `api` | dev/prod | 환경별 인증된 API metrics. scrape 설정이 환경 label을 소유 |
| `db-health` | `up`에는 없음, payload에는 dev/prod | 공유 HTTP exporter가 환경별 관리 DB health를 검사 |
| `backup` | `up`에는 없음, payload에는 선택한 dev/prod | 공유 exporter가 선택한 환경의 읽기 전용 상태 볼륨을 검사 |
| `node` | shared | 호스트 CPU·MemAvailable·지정한 데이터 마운트의 filesystem·장치별 디스크 I/O(diskstats) |
| `prometheus` | shared | 수집기 자체 상태와 수집량 |

API가 노출한 중복 `environment`는 scrape label로 치환하고 `exported_environment`는 제거한다.
DB와 백업 exporter의 `up=0`은 수집기 자체 단절이다. DB probe 실패는 HTTP exporter가 살아 있어도
`acttub_db_probe_success{environment="dev|prod"}=0`이다. probe는 DNS·본문 읽기까지 포함한 환경당
실행 상한([exporter.py](exporter.py))을 써서 두 환경을 합쳐도 scrape timeout(`manage.py`) 안에 끝나고,
리다이렉트·환경변수 HTTP proxy를 사용하지 않으며, 200 응답의 JSON `status=UP`만 성공이다.
DB 점검 컨테이너의 CPU 상한은 짧은 프로세스 초기화가 실행 상한을 다 쓰지 않도록 여유를 둔다(값과 홈서버
실측 이유는 [compose.yml](compose.yml)의 주석).
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
경과 시간은 성공 시각으로 Cloud 규칙이 따로 평가한다(기준은 [DEPLOY-HOME §5](../../docs/deploy/DEPLOY-HOME.md#5-자동-백업과-복원-검증)).
오류 원문·객체 주소·해시·토큰은 지표/label/로그에 넣지 않는다.

## 자동 검증과 남은 운영 검증

```bash
python3 -m unittest discover -s deploy/monitoring/tests -v
deploy/home/deploy-test.sh

# 앱 스모크의 이미지 빌드·검사(1·2 단계)만 돌리고 재사용 태그를 만든다. CI 의 smoke-monitoring 잡과 같다.
SMOKE_BUILD_ONLY=1 SMOKE_EXPORT_API_IMAGE=acttub-api:monitoring-ci \
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

별도 실제 홈서버에서 node의 CPU·`MemAvailable`·데이터 filesystem·디스크 쓰기 값을 `/proc/stat`,
`/proc/meminfo`, `df`, `/proc/diskstats`와 대조하고 30일 예상 저장량·여유 공간을 확인한다. 실제 Cloud/PDC 조회,
세 계정 권한·Free 사용량·Slack 최초/반복/복구 수신도 확인해야 한다. 로컬 테스트 통과는 이 운영
검증의 완료를 의미하지 않는다.

설정 근거: [Grafana PDC 목적지 제한](https://grafana.com/docs/grafana-cloud/observe-and-act/connect-externally-hosted/private-data-source-connect/scalability-and-security/),
[PDC 0.0.64 소스](https://github.com/grafana/pdc-agent/tree/v0.0.64),
[Prometheus 저장·용량 정책](https://prometheus.io/docs/prometheus/latest/storage/),
[node exporter 호스트 경로](https://github.com/prometheus/node_exporter#docker).
