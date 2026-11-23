# dev 부하 테스트

dev API에 운영과 비슷한 요청 구성으로 초당 일정한 건수를 보내고, API 안에서 잰 응답 시간을 단계·구간별로 본다.
뒤의 변경(Spring Boot·Java·커넥션 풀·힙·GC·DB 설정)을 견줄 기준선을 만드는 데 쓴다.

| 파일 | 하는 일 |
|---|---|
| `k6-load.js` | k6 시나리오. 테스트 계정 `k6-load-<n>`을 준비하고(로그인·약관 동의·대본·회차·녹음) 정해진 비율로 요청을 보낸다. |
| `run.sh` | 홈서버에서 k6 컨테이너를 띄우고, 운영을 지키는 감시를 돌린다. |
| `ab-guc.sh` | 초당 100건 10분 안에서 dev DB 설정 하나를 150초마다 기본값·시험값으로 번갈아 바꾼다. |
| `sampler.sql` | `ab-guc.sh`가 dev DB의 대기 이벤트를 0.2초마다 남길 때 쓴다. |
| `analyze.py` | dev API 요청 로그를 구간별 숫자로 바꾼다(표준 라이브러리만). |

## 어디서 도는가

홈서버에서 `grafana/k6` 컨테이너가 `acttub-dev_edge` 네트워크로 dev의 proxy 입구(`http://web:3000`)에 보낸다.
Cloudflare를 거치지 않는다. dev와 운영이 같은 호스트에 있으므로 `run.sh`가 25초마다 운영을 본다:
운영 API `/health`가 1초를 넘거나 호스트 CPU가 90%를 넘는 일이 두 번 연속이면 k6를 멈춘다(`HEALTH_MAX`, `CPU_MAX`로 바꾼다).

테스트 계정은 dev 전용 `development` 로그인 제공자로 만든다. 계정마다 분당 60회 한도가 있어 초당 100건을 계정 150개에 나눈다.

## 서버에 올린다

스크립트는 서버의 `~deploy/soma701/`에서 돈다(경로가 스크립트에 박혀 있다).

```sh
scp apps/api/scripts/load-test/{k6-load.js,run.sh,ab-guc.sh,sampler.sql} deploy@insung-server:soma701/
```

## 돌리기 전에 본다

- 도는 배포가 없어야 한다. 겹치면 측정이 무효다.

  ```sh
  gh run list -L 10 --json status -q '[.[] | select(.status!="completed")] | length'   # 0이어야 한다
  ```

- 앞 실행이 끝나고 1분은 기다린다. 준비 단계가 계정마다 약 40번 불러서, 바로 다시 돌리면 계정당 분당 60회 한도(429)에 걸린다.

## 돌린다

```sh
# 짧은 시험 (계정 6개, 초당 3건, 30초)
ssh deploy@insung-server 'K6_ENV="-e ACCOUNTS=6 -e STAGES=3:30s" ~/soma701/run.sh'

# 본 실행 (계정 150개 준비 약 5분 + 초당 10·25·50·100건 1분씩)
ssh deploy@insung-server 'nohup ~/soma701/run.sh > /dev/null 2>&1 < /dev/null &'

# 설정을 바꿔 견준다 (초당 100건 10분, 150초마다 기본값·시험값·기본값·시험값, 끝나면 기본값으로 되돌림)
ssh deploy@insung-server 'nohup ~/soma701/ab-guc.sh synchronous_commit off > /dev/null 2>&1 < /dev/null &'
```

- `run.sh`의 결과는 `~/soma701/<시각>/{k6.log,summary.json,guard.log}`에 생긴다.
- `ab-guc.sh`의 기록은 `~/soma701/ab-<설정>-<시각>/`에 생긴다. `marks.txt`(전환 시각), `disk.txt`(디스크 확정 횟수·시간),
  `db-activity.txt`(DB 대기 이벤트), `run.out`이다. 다시 띄우지 않고 바뀌는 설정(`pg_settings.context`가 `sighup`·`user`)만 된다.
- 단계는 `-e STAGES=<초당 건수>:<길이>,…`로 바꾼다(예: `10:30s,100:2m`).
- 목소리 합성(`POST /v2/reading/voice`)은 기본으로 뺀다. 무료 계정은 계정 첫 리딩 밖에서 이 요청이 503이고 Sentry에 보고된다.
  Pro 계정으로 돌릴 때만 `-e WITH_VOICE=1`을 준다.

## 결과를 읽는다

k6의 요약(`summary.json`)은 프록시와 네트워크를 포함한 시간이다. 단계별 숫자는 dev API의 요청 로그로 계산한다.
`"message":"request"` 줄에 `@timestamp`, `took_ms`, `status`, `method`, `route`가 있다.

```sh
ssh deploy@insung-server "docker logs --since <시작> --until <끝> <dev api 컨테이너> 2>&1 | grep '\"message\":\"request\"'" > api-requests.log

# ab-guc.sh 실행: marks.txt 로 구간을 만든다(전환 앞뒤 4초는 뺀다)
python3 apps/api/scripts/load-test/analyze.py api-requests.log --marks marks.txt
# 구간을 직접 준다(이름:시작 epoch 초:끝 epoch 초)
python3 apps/api/scripts/load-test/analyze.py api-requests.log --window "초당 100건:<시작 epoch>:<끝 epoch>"
```

구간마다 건수, 초당 건수, p50·p95·p99·최대(ms), 1초 넘은 요청 수, 한꺼번에 느려진 초의 수, 2xx가 아닌 응답 수를 낸다.

- 백분위는 정렬한 값의 `int(n*p)`번째(범위를 넘으면 마지막) 값이다.
- "한꺼번에 느려진 초"는 한 초에 `took_ms`가 300을 넘는 요청이 15건 이상인 초다. DB의 COMMIT이 디스크 확정을 기다리느라
  커넥션 풀이 모두 묶일 때 이렇게 보인다.
- p95·p99는 실행마다 크게 흔들린다. 2~3분 구간 하나로 판정하지 않는다. 같은 실행 안에서 번갈아 바꾸며(`ab-guc.sh`)
  느려진 초의 수를 5분 넘게 센다.

## 테스트

```sh
python3 -m unittest discover -s apps/api/scripts/load-test -v
```

CI 잡은 이 테스트를 돌리지 않는다. `analyze.py`를 고치면 위 명령을 직접 돌린다.
