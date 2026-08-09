# M5 — 전환

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M5 사이클에만 적용된다.**

> **사용자 개입 지점 ②.** 운영 반영 전에 반드시 확인을 받는다. 자동 연쇄가 여기서 멈춘다.

## 목적

Java 백엔드를 실제로 서빙에 올린다. **M4까지는 전부 가역이었고, 이 사이클의 유닛 스위치부터 실운영에 영향이 간다.**

## 산출물

### A. 배포 아티팩트

`deploy/upload-api.sh`를 jar 패키징으로 바꾼다.

현재는 파이썬 소스를 tar로 보내고 인스턴스에서 `uv sync`를 돈다. Java는 `bootJar` 산출물 하나를 올린다 — **인스턴스에서 의존성을 받는 단계가 사라져 배포가 단순해지고 빨라진다.**

`deploy/systemd/acttub-api.service`:
```
ExecStart=/usr/bin/java -jar /svc/acttub/api/acttub-api.jar
```
`EnvironmentFile=/etc/acttub/api.env`는 그대로. `Restart=always` + `RestartSec=3`도 유지.

**환경변수 이름을 바꾸지 않는다** — `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, 🔁 `OPENAI_API_KEY`·`OPENAI_CHAT_MODEL`·`OPENAI_TRANSCRIBE_MODEL`(`SOMA-302`가 들인 `acting-llm/openai_client.py`), `S3_BUCKET`, `AWS_REGION`, `ADMIN_OPS_TOKEN` 등을 Spring이 그대로 읽게 매핑한다. 이름을 바꾸면 배포 문서 전체와 두 서버의 api.env를 동시에 고쳐야 하고 롤백이 어려워진다.

### B. 인스턴스 — dev·운영 **둘 다** 업그레이드가 선행 조건

2026-08-06 실측(SSM):

| | 타입 | 메모리 | swap | available | 현재 상주 |
|---|---|---|---|---|---|
| **운영 be** `i-08a90c20095d4ecf1` | t2.micro | 954MB | **0** | **396MB** | uvicorn 226MB |
| dev `i-0f101fb852e26d081` | t2.micro | 954MB | 4GB | 405MB | uvicorn 163MB + next 83MB + caddy 27MB |
| 운영 fe `i-06eda45984a6f354e` | t2.micro | — | — | — | Next (이번 변경 없음) |

**운영 be는 dev와 같은 t2.micro이고 swap이 아예 없다.** 여유 396MB에 Spring Boot JVM(실사용 250~400MB)을 넣는 것 자체가 빠듯하고, **§전환 절차가 요구하는 병행 기동(uvicorn 226MB 유지 + JVM)은 물리적으로 불가능하다.** swap이 없으므로 초과 시 OOM killer가 즉시 작동한다.

vCPU도 1개다. JVM 기동 시 CPU 스파이크가 t2.micro의 버스트 크레딧을 소진할 수 있다.

**따라서 dev와 운영 be 둘 다 t3.small(2GB) 이상으로 올린 뒤에야 이 마일스톤을 시작할 수 있다.** 이것은 선택이 아니라 선행 조건이며, 비용이 발생하므로 **사용자 승인 대상**이다.

- 힙 상한은 `-Xmx`로 직접 준다 (컨테이너가 아니므로 `MaxRAMPercentage`는 부적합)
- 업그레이드 후에도 운영 be에 swap을 두는 것은 권하지 않는다 — JVM이 swap에 들어가면 GC가 급격히 악화된다. 메모리를 충분히 주는 쪽이 맞다

### C. 마이그레이션 처리

현재 dev는 배포 시 alembic이 자동 실행되고(`deploy.yml` `MIGRATE=1`), 운영은 수동이다.

**Flyway는 스키마를 바꾸지 않으므로**(baseline만) 이 단계에서 마이그레이션 실행이 필요 없다. `deploy/check-migration.sh`(운영 스키마 리비전 확인)를 Flyway 기준으로 갱신하거나, 스키마 변경이 없음을 근거로 해당 스텝을 조정한다.

**주의**: `apps/api`를 아직 지우지 않았으므로 alembic 리비전 정보도 DB에 남아 있다. 두 도구가 같은 DB를 보는 상태를 M6까지 유지한다 — 롤백 시 alembic이 필요하다.

### D. 🔎 Sentry 이식 (`SOMA-326`, M4에서 이월)

**M4가 이식하지 않기로 한 층이다**(`spec/M4-llm.md` §A-0). 계약 동등성 밖이라 하네스가 보지 않지만, **Java가 파이썬을 대체하는 순간 백엔드 에러 수집이 끊긴다** — 컷오버에서 가장 관측이 필요한 시점에 눈을 잃는 것이므로 여기서 닫는다.

파이썬 원본은 `observability.py`(88줄)이고 `app.py:create_app`이 부팅 시 부른다. 옮길 계약:

- **`SENTRY_DSN`이 없으면 켜지 않는다.** 로컬·테스트의 기본 상태이며, 이 가드가 없으면 테스트가 이벤트를 밖으로 쏜다
- `SENTRY_ENVIRONMENT`(기본 `local`)·`SENTRY_RELEASE`(기본 `unknown`). 릴리스는 커밋 SHA이고 `deploy/ssm-deploy.sh`가 systemd drop-in으로 넣는다 — **환경변수 이름과 주입 경로를 유지하면 배포 스크립트를 건드리지 않는다**
- **주소 스크러빙** — 경로의 UUID를 `<id>`로 바꾸고 쿼리·조각을 버린다(`observability.py:scrub_url`). `send_default_pii=False`가 쿠키·헤더·IP를 막지만 **주소는 그 대상이 아니다**. breadcrumb의 `data.url`도 같이 훑는다
- 트레이싱은 켜지 않는다(`traces_sample_rate=0.0`) — 1단계는 에러만 본다
- 프로젝트는 `acttub-api` 하나를 dev·운영이 공유하고 `environment` 태그로 나눈다. **DSN은 인스턴스 `/etc/acttub/api.env`에 있다**(런타임 주입, 빌드에 넣지 않는다)

## 전환 절차

### ⚠️ 워커 owner는 항상 정확히 하나

**두 백엔드를 같은 DB에 띄우면 워커도 둘 다 돈다.** FastAPI는 lifespan에서 `analysis_worker.start()`를 무조건 실행하고(`app.py:create_app.lifespan`), S3와 PostgresStore가 있으면 워커를 자동 생성한다(`app.py:create_app`). 둘이 같은 `external_operations` 큐를 소비하면:

- Java로 보낸 분석 요청을 **Python 워커가 완료해버려 Java 파이프라인의 결함이 관찰 기간 내내 가려진다**
- 두 구현의 실패·재시도 의미가 다르면 같은 세션을 번갈아 처리한다

→ **HTTP 전환과 워커 전환을 별개 관문으로 분리한다.** 양쪽 모두 `ANALYSIS_WORKER_ENABLED` 스위치를 갖는다(M4 산출물).

### 선행 — 인스턴스 업그레이드 (사용자 승인 필요)

dev·운영 be 둘 다 t3.small 이상. **완료 전에는 아래 절차를 시작할 수 없다**(§B).

### dev

1. dev 인스턴스 업그레이드 확인
2. Java 백엔드를 **8001 포트**로 배포. 기존 FastAPI(8000)는 그대로 둔다. **이 시점에 Java 워커는 꺼 둔다** — Python이 계속 큐 owner
3. **하네스 전량 통과 확인.** 이것이 HTTP 스위치 조건이다
4. **관문 A — HTTP 전환**: 프록시 대상을 8000 → 8001로. 워커는 여전히 Python
5. 브라우저에서 실제 플로우 확인 (사용자)
6. **관문 B — 워커 전환**: Python 워커를 끄고 Java 워커를 켠다. **소유권이 겹치는 순간이 없어야 한다.** 전환 직후 분석 1건을 완주시켜 확인
7. **최소 1주 관찰.** FastAPI 프로세스는 살려 둔다(워커는 꺼진 채)

### 운영 (사용자 확인 후에만)

dev 관찰이 끝나고 사용자가 승인하면 같은 순서. 운영은 fe/be 인스턴스가 분리되어 있고 배포가 수동이다.

**운영 재시작은 진행 중인 분석 작업을 끊을 수 있다** — 워커가 실행 중 다운로드·분석을 `join()`하므로 강제 종료 시 lease가 남아 최대 lease 만료까지 재분석이 지연된다. 한산한 시간대를 고른다.

### 롤백

프록시 대상을 8000으로 되돌리고 Python 워커를 다시 켠다(Java 워커는 끈다). FastAPI 프로세스가 살아 있으므로 **초 단위로 복구된다.** DB 스키마가 안 바뀌었으므로 데이터 롤백이 필요 없다.

**단, 롤백 시점에 사용자는 Java가 발급한 access·refresh 토큰을 들고 온다.** Python이 그 헤더·클레임·DB hash를 받아들이지 못하면 복구 직후 전 사용자가 로그아웃된다. M2에서 **Java→Python 검증과 실제 refresh 회전**을 통합 테스트로 고정했으므로(`spec/M2-foundation.md`), 전환 전에 그 테스트가 여전히 초록인지 확인한다.

**롤백 상태는 정상 완료가 아니다.** 원인을 규명하고 재전환할 때까지 열린 항목으로 추적한다.

## 완료 기준 체크리스트

### 선행
- [ ] **dev·운영 be 둘 다 t3.small 이상으로 업그레이드** (사용자 승인 후)
- [ ] 업그레이드 후 `free -m`으로 available 여유 확인 — 병행 기동에 최소 700MB 필요

### 배포
- [ ] `bootJar` 산출물이 S3에 올라가고 SSM으로 설치된다
- [ ] systemd 유닛이 `java -jar`로 기동, `Restart=always` 동작
- [ ] 환경변수 이름이 기존과 동일
- [ ] `deploy/upload-api.sh`·`ssm-deploy.sh`가 jar 경로를 다룬다
- [ ] 기동 실패가 배포 판정에 잡힌다 (`NRestarts` 확인 — `Type=simple`은 크래시루프도 active로 읽힌다)
- [ ] **Sentry 이식**(§D) — DSN 없으면 미기동, 주소 UUID 스크러빙, `environment`·`release` 태그. **DSN 없는 상태에서 테스트가 이벤트를 쏘지 않음을 단언**

### dev 전환
- [ ] dev 인스턴스 업그레이드 완료
- [ ] Java 8001, FastAPI 8000 병행 기동. **Java 워커는 꺼진 상태**
- [ ] **하네스 전량 통과**
- [ ] **관문 A** — 프록시 전환 후 브라우저 플로우 확인 (사용자)
- [ ] **관문 B** — 워커 owner를 Python → Java로 넘김. **겹치는 순간 없음**을 로그로 확인
- [ ] 워커 전환 직후 분석 1건 완주
- [ ] **Sentry에 Java 이벤트가 실제로 도착한다** — 컷오버 시점에 수집이 끊기지 않았음을 대시보드로 확인
- [ ] 업로드 → 분석 → 코치 → 리포트 전 플로우 동작
- [ ] **Java 발급 토큰을 Python이 검증**하는 M2 테스트가 여전히 통과 (롤백 안전성)
- [ ] 1주 관찰 중 오류율·응답시간이 기존과 동등

### 운영 전환 (사용자 승인 후)
- [ ] 한산한 시간대 실행
- [ ] 같은 검증 통과
- [ ] 롤백 경로가 실제로 동작함을 사전 확인

## 하지 말 것

1. **`apps/api`를 지우지 않는다.** M6의 몫이며, 롤백 경로다
2. **DB 스키마를 바꾸지 않는다**
3. **환경변수 이름을 바꾸지 않는다**
4. 관찰 기간을 건너뛰지 않는다
5. 스코프 밖 리팩터링 일체
