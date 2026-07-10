import os

import pytest

from acting_summary.config import load_settings
from acting_summary.schema import SceneSummary, SubText
from acting_summary.summarizer import summarize

pytestmark = pytest.mark.gemini


def test_real_gemini_summarize():
    sample = os.environ.get("SAMPLE_VIDEO")
    if not sample or not os.path.exists(sample):
        pytest.skip("SAMPLE_VIDEO env(영상 경로) 미설정")
    settings = load_settings()
    from google import genai

    client = genai.Client(api_key=settings.api_key)
    out = summarize(
        sample,
        SubText(
            situation="테스트 상황",
            character="테스트 인물",
            subtext="테스트 서브텍스트",
        ),
        client=client,
        model=settings.model,
    )
    assert isinstance(out, SceneSummary)
    assert out.summary
