"""analyze.py 의 계산을 합성 로그로 확인한다.

    python3 -m unittest discover -s apps/api/scripts/load-test -v
"""
import io
import json
import unittest
from contextlib import redirect_stdout

import analyze

BASE = 1_700_000_000  # 2023-11-14T22:13:20Z


def line(epoch, took_ms, status=200, nanos=123456789):
    from datetime import datetime, timezone
    stamp = datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    return json.dumps({"@timestamp": f"{stamp}.{nanos:09d}Z", "message": "request", "method": "GET",
                       "route": "/v2/me", "status": status, "took_ms": took_ms})


class ParseTest(unittest.TestCase):
    def test_timestamp_keeps_nanoseconds(self):
        self.assertAlmostEqual(analyze.parse_timestamp("2023-11-14T22:13:20.123456789Z"), BASE + 0.123456789, places=6)
        self.assertEqual(analyze.parse_timestamp("2023-11-14T22:13:20Z"), BASE)

    def test_skips_lines_that_are_not_request_json(self):
        rows = analyze.read_requests(["not json", json.dumps({"message": "other"}), line(BASE, 5)])
        self.assertEqual(len(rows), 1)


class SummarizeTest(unittest.TestCase):
    def test_numbers_for_one_window(self):
        lines = [line(BASE + 0, ms) for ms in range(1, 101)]          # 1..100ms, 100건
        lines += [line(BASE + 1, 400) for _ in range(15)]              # 한 초에 300ms 넘는 요청 15건: 느린 초
        lines += [line(BASE + 2, 400) for _ in range(14)]              # 14건: 느린 초 아님
        lines += [line(BASE + 3, 1500, status=503)]                    # 1초 넘음, 2xx 아님
        lines += [line(BASE + 10, 9999)]                               # 구간 밖(끝은 뺀다)
        s = analyze.summarize(analyze.read_requests(lines), BASE, BASE + 10)
        self.assertEqual(s["count"], 130)
        self.assertEqual(s["per_second"], 13.0)
        # 정렬하면 1..100, 400×29, 1500. int(130*p)번째: 65 → 66ms, 123 → 400ms, 128 → 400ms
        self.assertEqual((s["p50"], s["p95"], s["p99"]), (66, 400, 400))
        self.assertEqual(s["max"], 1500)
        self.assertEqual(s["over_1s"], 1)
        self.assertEqual(s["slow_seconds"], 1)
        self.assertEqual(s["non_2xx"], 1)

    def test_percentile_index_past_end_takes_last(self):
        self.assertEqual(analyze.percentile([7], 0.99), 7)
        self.assertEqual(analyze.percentile([1, 2], 0.5), 2)

    def test_empty_window(self):
        s = analyze.summarize([], BASE, BASE + 10)
        self.assertEqual((s["count"], s["p95"], s["slow_seconds"]), (0, None, 0))


class MarksTest(unittest.TestCase):
    MARKS = [
        f"start {BASE} on",
        f"flip {BASE + 400} e=190 off",
        f"flip {BASE + 550} e=340 on",
        f"flip {BASE + 700} e=490 off",
        f"end {BASE + 900} on",
        "done",
    ]

    def test_windows_between_flips_trim_four_seconds(self):
        self.assertEqual(analyze.windows_from_marks(self.MARKS), [
            ("on", BASE + 254, BASE + 396),
            ("off", BASE + 404, BASE + 546),
            ("on", BASE + 554, BASE + 696),
            ("off", BASE + 704, BASE + 846),
        ])

    def test_last_window_stops_at_end_mark(self):
        marks = self.MARKS[:4] + [f"end {BASE + 800} on"]
        self.assertEqual(analyze.windows_from_marks(marks)[-1], ("off", BASE + 704, BASE + 796))

    def test_cli_prints_one_row_per_window(self):
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            log, marks = os.path.join(d, "api.log"), os.path.join(d, "marks.txt")
            with open(log, "w") as f:
                f.write("\n".join(line(BASE + t, 10) for t in range(254, 846)))
            with open(marks, "w") as f:
                f.write("\n".join(self.MARKS))
            out = io.StringIO()
            with redirect_stdout(out):
                analyze.main([log, "--marks", marks, "--window", f"all:{BASE + 254}:{BASE + 846}"])
        rows = [r.split("\t") for r in out.getvalue().splitlines()]
        self.assertEqual([r[0] for r in rows[1:]], ["all", "on", "off", "on", "off"])
        self.assertEqual(rows[1][2], "592")
        self.assertEqual(rows[2][2], "142")


if __name__ == "__main__":
    unittest.main()
