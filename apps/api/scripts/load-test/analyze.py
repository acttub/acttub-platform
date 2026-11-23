#!/usr/bin/env python3
"""dev API 요청 로그를 구간별로 나눠 지연 숫자를 낸다. 설명은 같은 폴더의 README.md.

입력 로그는 한 줄에 JSON 하나다(`docker logs <dev api 컨테이너> | grep '"message":"request"'`).
쓰는 필드: `@timestamp`(UTC), `took_ms`, `status`.

구간은 둘 중 하나로 준다.
  --window 이름:시작epoch:끝epoch   (여러 번 줄 수 있다. 시작은 포함, 끝은 뺀다)
  --marks marks.txt                 (ab-guc.sh 의 기록. 전환 사이를 구간으로 삼고 전환 앞뒤 4초는 뺀다)

    python3 analyze.py api-requests.log --marks marks.txt
"""
import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone

SLOW_MS = 300          # 이보다 오래 걸린 요청을
SLOW_PER_SECOND = 15   # 한 초에 이만큼 넘게 받으면 "한꺼번에 느려진 초"다
TRIM_SECONDS = 4       # 설정 전환 앞뒤로 빼는 시간


def parse_timestamp(value):
    """'2026-11-23T05:35:20.123456789Z' 같은 UTC 시각을 epoch 초(float)로 바꾼다. 나노초까지 읽는다."""
    value = value.removesuffix("Z").removesuffix("+00:00")
    whole, _, fraction = value.partition(".")
    seconds = datetime.strptime(whole, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    return seconds + (int(fraction) / 10 ** len(fraction) if fraction else 0.0)


def read_requests(lines):
    """(epoch 초, took_ms, status) 목록. JSON이 아니거나 took_ms가 없는 줄은 건너뛴다."""
    requests = []
    for line in lines:
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if not isinstance(row, dict) or "took_ms" not in row or "@timestamp" not in row:
            continue
        requests.append((parse_timestamp(row["@timestamp"]), int(row["took_ms"]), int(row.get("status", 0))))
    return requests


def percentile(sorted_values, p):
    """정렬한 값의 int(n*p)번째 값. 범위를 넘으면 마지막 값."""
    return sorted_values[min(int(len(sorted_values) * p), len(sorted_values) - 1)]


def summarize(requests, start, end):
    inside = [(t, ms, status) for t, ms, status in requests if start <= t < end]
    took = sorted(ms for _, ms, _ in inside)
    slow_by_second = Counter(int(t) for t, ms, _ in inside if ms > SLOW_MS)
    n = len(took)
    return {
        "count": n,
        "per_second": n / (end - start) if end > start else 0.0,
        "p50": percentile(took, 0.50) if n else None,
        "p95": percentile(took, 0.95) if n else None,
        "p99": percentile(took, 0.99) if n else None,
        "max": took[-1] if n else None,
        "over_1s": sum(1 for ms in took if ms > 1000),
        "slow_seconds": sum(1 for c in slow_by_second.values() if c >= SLOW_PER_SECOND),
        "non_2xx": sum(1 for _, _, status in inside if not 200 <= status < 300),
    }


def windows_from_marks(lines):
    """ab-guc.sh 의 marks.txt 에서 (이름, 시작, 끝) 목록을 만든다.

    marks.txt 의 줄: `start <epoch> <값>`, `flip <epoch> e=<경과초> <값>`, `end <epoch> <값>`, `done`.
    전환과 전환 사이를 한 구간으로 삼는다. 첫 구간은 첫 전환보다 전환 간격만큼 앞에서, 마지막 구간은 마지막 전환에서
    전환 간격만큼(넘으면 end까지) 잡는다. 앞쪽의 계정 준비와 낮은 속도 단계를 빼기 위해서다.
    각 구간의 앞뒤 TRIM_SECONDS초는 뺀다.
    """
    start_value, flips, end_epoch = None, [], None
    for line in lines:
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "start":
            start_value = parts[2] if len(parts) > 2 else "?"
        elif parts[0] == "flip":
            flips.append((int(parts[1]), parts[3] if len(parts) > 3 else "?"))
        elif parts[0] == "end":
            end_epoch = int(parts[1])
    if not flips:
        raise ValueError("marks.txt 에 flip 줄이 없다")
    gaps = [b[0] - a[0] for a, b in zip(flips, flips[1:])]
    span = sorted(gaps)[len(gaps) // 2] if gaps else 150
    last_end = flips[-1][0] + span
    if end_epoch is not None:
        last_end = min(last_end, end_epoch)
    edges = [flips[0][0] - span] + [t for t, _ in flips] + [last_end]
    names = [start_value] + [value for _, value in flips]
    return [(name, a + TRIM_SECONDS, b - TRIM_SECONDS) for name, a, b in zip(names, edges, edges[1:])]


def parse_window(text):
    name, start, end = text.rsplit(":", 2)
    return name, float(start), float(end)


def fmt(value):
    return "-" if value is None else str(value)


def main(argv=None):
    parser = argparse.ArgumentParser(description="dev API 요청 로그의 구간별 지연")
    parser.add_argument("log", help="요청 로그 파일(한 줄에 JSON 하나). - 이면 표준 입력")
    parser.add_argument("--window", action="append", type=parse_window, default=[], metavar="이름:시작:끝")
    parser.add_argument("--marks", help="ab-guc.sh 의 marks.txt")
    args = parser.parse_args(argv)

    windows = list(args.window)
    if args.marks:
        with open(args.marks, encoding="utf-8") as f:
            windows += windows_from_marks(f)
    if not windows:
        parser.error("--window 나 --marks 중 하나는 있어야 한다")

    if args.log == "-":
        requests = read_requests(sys.stdin)
    else:
        with open(args.log, encoding="utf-8") as f:
            requests = read_requests(f)

    header = ["구간", "길이(초)", "건수", "초당", "p50", "p95", "p99", "최대", "1초 넘음", "느린 초", "2xx 아님"]
    print("\t".join(header))
    for name, start, end in windows:
        s = summarize(requests, start, end)
        print("\t".join([
            name, f"{end - start:g}", str(s["count"]), f"{s['per_second']:.1f}",
            fmt(s["p50"]), fmt(s["p95"]), fmt(s["p99"]), fmt(s["max"]),
            str(s["over_1s"]), str(s["slow_seconds"]), str(s["non_2xx"]),
        ]))


if __name__ == "__main__":
    main()
