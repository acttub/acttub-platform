import hashlib

from acting_report.prompt import REPORT_ANALYSIS_PROMPT, REPORT_EXPRESSION_PROMPT


def test_canonical_report_prompt_hashes_are_unchanged():
    assert hashlib.sha256(REPORT_ANALYSIS_PROMPT.encode()).hexdigest() == (
        "92ad143112723bc151752e1f1872b195358d267b0ece9efe3bc109341d40a12d"
    )
    assert hashlib.sha256(REPORT_EXPRESSION_PROMPT.encode()).hexdigest() == (
        "7ad3325affe8bca2171d5742a0e6a8f45df2609a338e383cd63f13ad10030a63"
    )
