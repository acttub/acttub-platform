"""The token-expiry rule fires only once its fixed instant has passed."""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
INSTANT = int(datetime.datetime(2027, 2, 7, tzinfo=datetime.timezone.utc).timestamp())  # 14 days before 2027-02-21


class TokenExpiryTest(unittest.TestCase):
    def setUp(self):
        self.rule = next(r for r in json.loads((ROOT / "rules.json").read_text()) if r["key"] == "grafana-token")

    def test_rule_instant_is_fourteen_days_before_expiry(self):
        self.assertEqual(int(re.search(r"time\(\) - (\d+)", self.rule["expr"]).group(1)), INSTANT)
        self.assertIn("2027-02-21", self.rule["condition"])

    def test_silent_before_the_instant_and_firing_after(self):
        # promtool steps from epoch 0 each minute, so 2027 takes minutes: shift the instant to 10m, keep the shape.
        expr = self.rule["expr"].replace(str(INSTANT), "600")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "rules.yml").write_text(json.dumps({"groups": [{"name": "g", "interval": "1m", "rules": [
                {"alert": "grafana-token", "expr": f"({expr}) {self.rule['op']} {self.rule['threshold']}", "for": self.rule["for"]}]}]}))
            (path / "tests.yml").write_text(json.dumps({"rule_files": ["rules.yml"], "evaluation_interval": "1m", "tests": [{
                "interval": "1m", "input_series": [],
                "alert_rule_test": [
                    {"eval_time": "9m", "alertname": "grafana-token", "exp_alerts": []},
                    {"eval_time": "10m", "alertname": "grafana-token", "exp_alerts": [{"exp_labels": {}, "exp_annotations": {}}]},
                    {"eval_time": "20m", "alertname": "grafana-token", "exp_alerts": [{"exp_labels": {}, "exp_annotations": {}}]},
                ]}]}))
            tool = os.environ.get("PROMTOOL", str(ROOT / ".validation/tools/promtool"))
            result = subprocess.run([tool, "test", "rules", "tests.yml"], cwd=path, text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
