#!/bin/bash
# dev 부하 테스트(k6-load.js)를 돌리고, 운영이 느려지거나 호스트 CPU가 차면 멈춘다. 설명은 같은 폴더의 README.md.
# 서버의 ~/soma701/ 에 이 폴더의 파일을 두고 돌린다. 결과: ~/soma701/<시각>/{k6.log,summary.json,guard.log}
# 시험할 때: K6_ENV="-e ACCOUNTS=6 -e STAGES=3:30s" HEALTH_MAX=1.0 CPU_MAX=90 ~/soma701/run.sh
set -u
D="$HOME/soma701"
OUT="$D/$(date +%Y%m%d-%H%M%S)"
NAME=k6-soma701
HEALTH_MAX="${HEALTH_MAX:-1.0}"   # 운영 api /health 응답 초. 평소 0.001초
CPU_MAX="${CPU_MAX:-90}"          # 호스트 CPU 사용률 %
mkdir -p "$OUT" && chmod 777 "$OUT"   # k6 이미지는 root가 아닌 사용자로 쓴다
# 한 번만 돈다 — 예약 줄을 지운다.
crontab -l 2>/dev/null | grep -v 'soma701/run.sh' | crontab -

log() { echo "$(date +%T) $*" >> "$OUT/guard.log"; }
cpu_busy() {  # 5초 동안의 호스트 CPU 사용률(%)
  read -r _ a b c d e f g _ < /proc/stat; local t1=$((a+b+c+d+e+f+g)) i1=$((d+e))
  sleep 5
  read -r _ a b c d e f g _ < /proc/stat; local t2=$((a+b+c+d+e+f+g)) i2=$((d+e))
  echo $(( 100 * ((t2-t1) - (i2-i1)) / (t2-t1) ))
}

docker rm -f "$NAME" >/dev/null 2>&1
docker run -d --name "$NAME" --network acttub-dev_edge \
  -v "$D/k6-load.js:/k6-load.js:ro" -v "$OUT:/out" -e BASE_URL=http://web:3000 ${K6_ENV:-} \
  grafana/k6:2.3.0 run --summary-export=/out/summary.json /k6-load.js > /dev/null || { log "k6 시작 실패"; exit 1; }
log "시작 HEALTH_MAX=$HEALTH_MAX CPU_MAX=$CPU_MAX K6_ENV=${K6_ENV:-}"

strikes=0
while [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = true ]; do
  api=$(docker ps -q --filter label=com.docker.compose.project=acttub-prod --filter label=com.docker.compose.service=api | head -1)
  health=$(docker exec "$api" curl -s -o /dev/null -w '%{time_total}' --max-time 5 http://localhost:8080/health || echo 5)
  cpu=$(cpu_busy)
  if awk -v h="$health" -v m="$HEALTH_MAX" 'BEGIN{exit !(h>m)}' || [ "$cpu" -gt "$CPU_MAX" ]; then
    strikes=$((strikes+1))
  else
    strikes=0
  fi
  log "운영 health ${health}s, CPU ${cpu}%, 연속 초과 $strikes"
  if [ "$strikes" -ge 2 ]; then
    log "멈춤: 연속 2번 기준 초과"
    docker stop -t 10 "$NAME" > /dev/null
    break
  fi
  sleep 25
done

docker logs "$NAME" > "$OUT/k6.log" 2>&1
log "끝 exit=$(docker inspect -f '{{.State.ExitCode}}' "$NAME")"
docker rm "$NAME" > /dev/null
