#!/bin/bash
# 초당 100건 10분 안에서 dev DB 설정 하나를 150초마다 기본값, 시험값, 기본값, 시험값으로 바꾼다. 끝나면 기본값으로 되돌린다.
# 사용: ab-guc.sh <설정 이름> <시험값>   예) ab-guc.sh synchronous_commit off / ab-guc.sh wal_sync_method open_datasync
# 설정은 다시 띄우지 않고 바뀌는 것(pg_settings.context 가 sighup 또는 user)만 된다.
# 기록: ~/soma701/ab-<설정>-<시각>/{marks.txt,disk.txt,db-activity.txt,run.out}. 결과 읽는 법은 같은 폴더의 README.md.
G="$1"; V="$2"
X=~/soma701/ab-$G-$(date +%Y%m%d-%H%M%S); mkdir -p $X
psqlc() { docker exec acttub-dev-db-1 psql -U acttub -d acttub -Atc "$1"; }
elapsed() { docker logs --tail 3 k6-soma701 2>&1 | grep -o '[0-9]*m[0-9.]*s/10m40s' | tail -1 | awk -F'[ms/]' '{print int($1*60+$2)}'; }
setm() { if [ "$1" = default ]; then psqlc "ALTER SYSTEM RESET $G" >/dev/null; else psqlc "ALTER SYSTEM SET $G='$1'" >/dev/null; fi; psqlc "select pg_reload_conf()" >/dev/null; sleep 1; echo "flip $(date +%s) e=$2 $(psqlc "show $G")" >> $X/marks.txt; }
echo "start $(date +%s) $(psqlc "show $G")" > $X/marks.txt
K6_ENV="-e STAGES=10:30s,100:10m" nohup ~/soma701/run.sh > $X/run.out 2>&1 < /dev/null &
sleep 5
( while [ "$(docker inspect -f '{{.State.Running}}' k6-soma701 2>/dev/null)" = true ]; do echo "$(date +%s) $(awk '$3=="nvme0n1"{print $8,$11,$19,$20}' /proc/diskstats)"; sleep 1; done ) > $X/disk.txt 2>&1 &
( docker exec -i acttub-dev-db-1 psql -U acttub -d acttub -q -f - < ~/soma701/sampler.sql ) > $X/db-activity.txt 2>&1 &
step=0
while [ "$(docker inspect -f '{{.State.Running}}' k6-soma701 2>/dev/null)" = true ]; do
  e=$(elapsed); e=${e:-0}
  if [ $step = 0 ] && [ "$e" -ge 190 ]; then setm "$V" $e; step=1
  elif [ $step = 1 ] && [ "$e" -ge 340 ]; then setm default $e; step=2
  elif [ $step = 2 ] && [ "$e" -ge 490 ]; then setm "$V" $e; step=3
  fi
  sleep 1
done
psqlc "ALTER SYSTEM RESET $G" >/dev/null; psqlc "select pg_reload_conf()" >/dev/null; sleep 1
echo "end $(date +%s) $(psqlc "show $G")" >> $X/marks.txt
docker exec acttub-dev-db-1 pkill -f "psql -U acttub -d acttub -q -f -" 2>/dev/null
echo done >> $X/marks.txt
