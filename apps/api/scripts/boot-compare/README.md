# 올리기 전후 비교

Spring Boot·Jackson·Java·Gradle처럼 API 전체에 닿는 것을 바꿀 때, 바꾸기 전과 뒤의 jar를 같은 조건으로 띄워
바깥에서 보이는 것을 견준다. 테스트가 보지 않는 기동 로그, 로그 필드, 지표 이름과 라벨, DB에 남는 값까지 본다.

| 파일 | 하는 일 |
|---|---|
| `snapshot.sh` | 이 체크아웃의 jar를 만들고 버리는 Postgres(`postgres:18-alpine`)에 띄워, 정해진 요청을 보내고 결과를 폴더 하나에 남긴다. |
| `toolchain-java.gradle` | jar를 만든 JDK(Gradle toolchain)의 `java` 경로를 찍는다. `snapshot.sh`가 그 `java`로 jar를 띄운다. |
| `digest.py` | `snapshot.sh`가 남긴 원본을 견줄 수 있는 요약으로 바꾼다. `snapshot.sh`가 부른다. |
| `compare.py` | 두 폴더를 견준다. 매번 달라지는 값(UUID, 토큰, 시각)을 지우고, 다른 곳을 모두 찍는다. 다르면 1로 끝난다. |

## 남기는 것

- `responses/*.txt`: 요청마다 상태줄, 보는 헤더(`content-type`, `x-acttub-trace-id` 등), 본문. 로그인 없는 요청(헬스, 404, 401, 405,
  잘못된 JSON, 검증 오류)과 개발용 로그인으로 가입·프로필을 만든 뒤의 GET 요청들, 관리 포트의 헬스.
- `startup-warn.txt`: 기동과 요청 처리 중의 WARN·ERROR(숫자는 `#`로 바꾼다).
- `log-keys.txt`, `request-log.txt`: JSON 로그(운영과 같은 logstash 형식)의 필드 이름과, 요청 로그 줄(`status`, `method`, `route`, `trace_id` 등).
- `metrics.txt`, `metrics-http.txt`: Prometheus 지표 이름과 라벨 이름, HTTP 요청 지표의 라벨 값과 개수.
- `db-schema.sql`, `db-data.sql`: 요청을 마친 DB의 스키마와 저장 값(Flyway 이력 제외).

## 돌린다

Docker가 떠 있어야 한다. 비교할 커밋(예: `origin/dev`)을 임시 worktree로 꺼내고, 이 폴더를 그 안에 복사해 전을 뜬다.
스크립트가 그 커밋에 없을 수 있어서다. 같은 포트를 쓰므로 하나씩 돌린다.

```sh
git worktree add --detach /tmp/before origin/dev
cp -R apps/api/scripts/boot-compare /tmp/before/apps/api/scripts/
/tmp/before/apps/api/scripts/boot-compare/snapshot.sh /tmp/snap-before
apps/api/scripts/boot-compare/snapshot.sh /tmp/snap-after
python3 -I apps/api/scripts/boot-compare/compare.py /tmp/snap-before /tmp/snap-after
git worktree remove --force /tmp/before
```

포트는 `APP_PORT`(기본 18080)·`MGMT_PORT`(기본 18081)로 바꾼다. 앱이 기동하다 죽으면 `<출력 폴더>/startup.log`를 본다.

jar는 그 체크아웃의 Gradle toolchain JDK로 띄운다. PATH·`JAVA_HOME`의 `java`는 toolchain과 다른 버전일 수 있어서다(예: 맥북 기본
21, API toolchain 25). 그래서 Java를 올리는 비교에서도 전은 옛 JDK, 뒤는 새 JDK로 뜬다. 다른 `java`로 띄우려면 `SNAPSHOT_JAVA`에
실행 파일 경로를 준다.

## 읽는다

`compare.py`가 찍는 차이를 하나씩 가른다. 프레임워크가 바꾼 표현일 뿐인지(예: 기동 로그 문구), 실제 응답·저장 값·
대시보드가 보는 지표가 달라지는지. 뒤의 것은 [CONTRACT.md 「계약 변경 절차」](../../CONTRACT.md#계약-변경-절차)에 해당한다.
`api-docs.txt`는 키를 정렬해 견준다. 스펙 바이트 비교는 `OpenApiSnapshotIT`가 한다.
