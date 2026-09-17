"""Missing mandatory series are incidents even while the exporter stays up."""
import itertools
import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
KINDS = ("analyze", "coach_start", "coach_reply", "report")


def idle_series():
    # The public metric contract, independently specified from the alert queries.
    series = {'up{job="api",environment="dev"}': "1+0x10"}

    def add(name, **labels):
        selector = name + '{environment="dev"' + ''.join(
            ',' + key + '="' + value + '"' for key, value in labels.items()) + '}'
        series[selector] = "0+0x10"

    for kind in KINDS:
        for event in ("accepted", "attempts", "requeues"):
            add("acttub_external_operations_" + event + "_total", kind=kind)
        for dependency in ("storage", "observation", "speech", "model"):
            add("acttub_external_operations_external_calls_total", kind=kind, dependency=dependency)
        add("acttub_external_operations_terminal_total", kind=kind, outcome="succeeded", classification="none")
        for classification in ("expected", "external", "unexpected", "unclassified"):
            add("acttub_external_operations_terminal_total", kind=kind, outcome="failed", classification=classification)
        for family in ("current", "unmeasured"):
            for state, waiting in (("pending", "initial"), ("pending", "retry"), ("running", "none")):
                add("acttub_external_operations_" + family, kind=kind, state=state, waiting=waiting)
        for waiting in ("initial", "retry"):
            add("acttub_external_operations_oldest_wait_seconds", kind=kind, waiting=waiting)
            add("acttub_external_operations_wait_seconds_bucket", kind=kind, waiting=waiting, le="+Inf")
        for family in ("oldest_running_age_seconds", "oldest_unfinished_age_seconds"):
            add("acttub_external_operations_" + family, kind=kind)
        for outcome in ("succeeded", "failed", "requeued"):
            add("acttub_external_operations_execution_seconds_bucket", kind=kind, outcome=outcome, le="+Inf")
        for outcome in ("succeeded", "failed"):
            add("acttub_external_operations_elapsed_seconds_bucket", kind=kind, outcome=outcome, le="+Inf")
    add("acttub_external_operations_snapshot_success")
    add("acttub_external_operations_snapshot_timestamp_seconds")
    for family in ("process_start_time_seconds", "jvm_memory_used_bytes", "hikaricp_connections"):
        add(family)
    for status, latency in itertools.product(("1xx", "2xx", "3xx", "4xx", "5xx", "other"), ("ordinary", "long_running")):
        add("acttub_http_requests_total", status_class=status, latency_class=latency)
    for feature, route in (("coach", "/v2/coach/start"), ("coach", "/v2/coach/reply"),
                           ("coach", "/v2/coach/confirm"), ("report", "/v2/reports")):
        for suffix in ("count", "sum", "max"):
            add("acttub_http_active_seconds_" + suffix, feature=feature, route=route)
    return series


class MetricPresenceTest(unittest.TestCase):
    def evaluate(self, rule, series, expected):
        rules = {r["key"]: r for r in json.loads((ROOT / "rules.json").read_text())}
        expression = rules[rule]["expr"].replace("$env", "dev")
        case = {"evaluation_interval": "1m", "tests": [{
            "interval": "1m",
            "input_series": [{"series": key, "values": value} for key, value in series.items()],
            "promql_expr_test": [{"expr": "(" + expression + ") > bool 0", "eval_time": "3m",
                                  "exp_samples": [{"labels": "{}", "value": expected}]}],
        }]}
        tool = os.environ.get("PROMTOOL", str(ROOT / ".validation/tools/promtool"))
        result = subprocess.run([tool, "test", "rules", "/dev/stdin"], input=json.dumps(case),
                                text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_one_missing_operation_kind_is_detected_even_when_other_kinds_remain(self):
        for missing in (
            'accepted_total{environment="dev",kind="coach_reply"}',
            'attempts_total{environment="dev",kind="coach_reply"}',
            'requeues_total{environment="dev",kind="coach_reply"}',
            'external_calls_total{environment="dev",kind="analyze",dependency="speech"}',
            'terminal_total{environment="dev",kind="report",outcome="failed",classification="external"}',
            'terminal_total{environment="dev",kind="report",outcome="succeeded",classification="none"}',
        ):
            with self.subTest(missing=missing):
                series = idle_series()
                del series["acttub_external_operations_" + missing]
                self.evaluate("operation-metric", series, 1)

    def test_initialized_idle_operation_counters_are_present_without_any_execution(self):
        self.evaluate("operation-metric", idle_series(), 0)

    def test_missing_state_and_timing_series_cannot_hide_behind_other_kinds(self):
        for missing in (
            'current{environment="dev",kind="analyze",state="pending",waiting="retry"}',
            'unmeasured{environment="dev",kind="report",state="running",waiting="none"}',
            'oldest_wait_seconds{environment="dev",kind="analyze",waiting="initial"}',
            'oldest_running_age_seconds{environment="dev",kind="coach_reply"}',
            'oldest_unfinished_age_seconds{environment="dev",kind="analyze"}',
            'wait_seconds_bucket{environment="dev",kind="analyze",waiting="retry",le="+Inf"}',
            'execution_seconds_bucket{environment="dev",kind="coach_start",outcome="failed",le="+Inf"}',
            'elapsed_seconds_bucket{environment="dev",kind="report",outcome="succeeded",le="+Inf"}',
            'snapshot_success{environment="dev"}',
            'snapshot_timestamp_seconds{environment="dev"}',
        ):
            with self.subTest(missing=missing):
                series = idle_series()
                del series["acttub_external_operations_" + missing]
                self.evaluate("operation-metric", series, 1)

    def test_http_counter_classes_and_active_routes_are_mandatory_even_when_idle(self):
        self.evaluate("api-metric", idle_series(), 0)
        for missing in (
            'acttub_http_requests_total{environment="dev",status_class="5xx",latency_class="ordinary"}',
            'acttub_http_active_seconds_count{environment="dev",feature="coach",route="/v2/coach/start"}',
            'acttub_http_active_seconds_sum{environment="dev",feature="report",route="/v2/reports"}',
            'acttub_http_active_seconds_max{environment="dev",feature="coach",route="/v2/coach/confirm"}',
        ):
            with self.subTest(missing=missing):
                series = idle_series()
                del series[missing]
                self.evaluate("api-metric", series, 1)


if __name__ == "__main__":
    unittest.main()
