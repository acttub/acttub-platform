"""snapshot.sh 가 떠 둔 원본(startup.log, prometheus.raw, responses/)을 견줄 수 있는 요약으로 바꾼다.

    python3 -I digest.py <떠 둔 폴더>

표준 라이브러리만 쓴다. 매번 달라지는 값(UUID, 토큰, 시각, 소요 시간)은 compare.py 가 지운다.
"""
import json
import re
import sys
from pathlib import Path

out = Path(sys.argv[1])
lines = (out / "startup.log").read_text(errors="replace").splitlines()
startup_n = int((out / "startup-lines.txt").read_text().strip())

keys, warn, requests = set(), [], []
for i, line in enumerate(lines):
    try:
        event = json.loads(line)
    except ValueError:
        if line.strip():
            warn.append(f"{'기동' if i < startup_n else '요청'} JSON 아닌 줄 :: {line[:300]}")
        continue
    keys.update(event.keys())
    if "took_ms" in event and "status" in event:
        requests.append({k: event.get(k) for k in sorted(event) if k not in ("@timestamp", "took_ms", "thread_name")})
    if event.get("level") in ("WARN", "ERROR"):
        message = re.sub(r"[0-9a-f-]{36}|\d+", "#", str(event.get("message")))[:300]
        when = "기동" if i < startup_n else "요청"
        warn.append(f"{when} {event.get('level')} {event.get('logger_name')} :: {message}")

(out / "log-keys.txt").write_text("\n".join(sorted(keys)) + "\n")
(out / "startup-warn.txt").write_text("\n".join(warn) + "\n")
(out / "request-log.txt").write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in requests))

# 지표: 이름과 라벨 이름. HTTP 요청 지표는 라벨 값과 개수까지 남긴다(대시보드가 uri·status 로 가른다).
families, http = {}, []
for line in (out / "prometheus.raw").read_text().splitlines():
    if not line or line.startswith("#"):
        continue
    m = re.match(r"([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(\S+)", line)
    if not m:
        continue
    name, labels = m.group(1), m.group(3) or ""
    families.setdefault(name, set()).add(",".join(sorted(set(re.findall(r'([a-zA-Z_][a-zA-Z0-9_]*)="', labels)))))
    if name in ("http_server_requests_seconds_count", "acttub_http_requests_total"):
        pairs = sorted(p for p in re.findall(r'[a-zA-Z_][a-zA-Z0-9_]*="[^"]*"', labels)
                       if not p.startswith(("environment=", "service=")))
        http.append(f"{name}{{{','.join(pairs)}}} {m.group(4)}")
(out / "metrics.txt").write_text("".join(f"{n} {{{l}}}\n" for n in sorted(families) for l in sorted(families[n])))
(out / "metrics-http.txt").write_text("\n".join(sorted(http)) + "\n")
