"""실호출 없이 실행기의 누락/거짓 성공 방지를 검사한다."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("evaluate_coach", Path(__file__).with_name("evaluate-coach.py"))
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


class EvaluationRunnerTest(unittest.TestCase):
    def test_default_covers_blank_video_route(self):
        cases = evaluation.selected_cases("")
        self.assertEqual(len(cases), 7)
        self.assertEqual(sum(1 + len(case.get("followups", [])) for case in cases), 15)
        for case in cases:
            self.assertEqual(case["branch"], "그 외")
            for field in ("situation", "character", "goal", "detail"):
                self.assertEqual(case[field], "")
        self.assertTrue(any(case.get("start") and case.get("followups") for case in cases))

    def test_invalid_selection_fails_before_any_call(self):
        for selection in ("typo", "video_blank_start,", "video_blank_start,video_blank_start"):
            with self.assertRaises(ValueError):
                evaluation.selected_cases(selection)

    def test_missing_keys_and_runtime_are_blockers(self):
        with patch.object(evaluation.shutil, "which", return_value=None):
            blockers = evaluation.preflight("video", None, {})
        for expected in ("OPENAI_API_KEY", "GEMINI_API_KEY", "JDK 21", "연기 영상"):
            self.assertTrue(any(expected in item for item in blockers))

    def test_skipped_or_partial_results_are_not_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.assertTrue(evaluation.verify_results(directory, {"case": 2}))
            output = {"id": "case", "contract_checks": "passed", "semantic_review": "pending",
                      "steps": [{}], "calls": [{}]}
            path = directory / "case.json"
            path.write_text(json.dumps(output))
            self.assertTrue(evaluation.verify_results(directory, {"case": 2}))
            output["steps"].append({})
            path.write_text(json.dumps(output))
            self.assertEqual(evaluation.verify_results(directory, {"case": 2}), [])
            output["contract_checks"] = "failed"
            path.write_text(json.dumps(output))
            self.assertTrue(evaluation.verify_results(directory, {"case": 2}))


if __name__ == "__main__":
    unittest.main()
