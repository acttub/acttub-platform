"""수동 확인용 Gradio UI.

코치 대화가 끝난 세션 JSON(CoachSession)을 올리고 "리포트 생성"을 누르면
engine이 실제 Gemini를 호출해 ActingReport를 보여준다.
같은 user_id로 두 번째 생성하면 comparison("저번엔 이랬는데")이 채워진다.

주의: "리포트 생성" 클릭 시점에 실제 Gemini API가 호출된다(비용 발생 가능).
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import gradio as gr
from google import genai

from acting_report import engine
from acting_report.config import load_settings
from acting_report.schema import ReportRecord
from acting_report.session_schema import CoachSession
from acting_report.store import FileReportStore

settings = load_settings()
client = genai.Client(api_key=settings.api_key)
store = FileReportStore(settings.store_path)


def _report_md(report, count):
    lines = [
        f"## {report.headline}",
        "",
        f"**가장 큰 문제** `{report.biggest_problem.start}-{report.biggest_problem.end}"
        f" · {report.biggest_problem.dimension}`",
        "",
        report.biggest_problem.description,
        "",
        f"**근거** — {report.evidence}",
        "",
        f"**스스로 찾아낸 것** — {report.self_discovery}",
        "",
        f"**잘한 점** — {report.encouragement}",
        "",
        f"**다음 연습에서** — {report.next_step}",
    ]
    if report.comparison:
        lines += ["", f"**저번과 비교** — {report.comparison}"]
    lines += ["", f"_({count}번째 리포트)_"]
    return "\n".join(lines)


def _load_session(session_file, summary_file):
    data = json.loads(Path(session_file).read_text(encoding="utf-8"))
    if "summary" not in data or data["summary"] is None:
        if not summary_file:
            raise ValueError(
                "세션 JSON에 summary(관찰 요약)가 없어. "
                "acting-summary가 만든 요약 JSON을 아래 칸에 같이 올려줘."
            )
        data["summary"] = json.loads(Path(summary_file).read_text(encoding="utf-8"))
    return CoachSession.model_validate(data)


def make_report(user_id, session_file, summary_file):
    if not user_id.strip():
        return "user_id를 먼저 넣어줘", None, None
    if not session_file:
        return "세션 JSON을 먼저 올려줘", None, None
    try:
        session = _load_session(session_file, summary_file)
    except ValueError as exc:
        return f"⚠️ {exc}", None, None
    except Exception as exc:  # noqa: BLE001
        return f"⚠️ 세션 JSON 형식이 안 맞아: {exc}", None, None
    previous = store.list(user_id)
    report = engine.generate_report(
        session, previous, client=client, model=settings.model
    )
    record = ReportRecord(
        created_at=datetime.now(timezone.utc).isoformat(),
        session_id=session.session_id,
        report=report,
        turns=session.turns,
    )
    store.add(user_id, record)
    history = [r.model_dump() for r in store.list(user_id)]
    return _report_md(report, len(history)), report.model_dump(), history


def load_history(user_id):
    if not user_id.strip():
        return []
    return [r.model_dump() for r in store.list(user_id)]


def build_demo():
    with gr.Blocks(title="acting-report") as demo:
        gr.Markdown(
            f"# acting-report\n코치 대화 세션 → 종합 진단 리포트 "
            f"(model: `{settings.model}`)\n\n"
            f"⚠️ 리포트 생성 클릭 시 실제 Gemini 호출 (비용 발생)"
        )
        with gr.Row():
            with gr.Column():
                user_id = gr.Textbox(label="user_id", value="demo")
                session_file = gr.File(
                    label="코치 세션 JSON (CoachSession)", file_types=[".json"]
                )
                summary_file = gr.File(
                    label="요약 JSON (세션에 summary 없을 때만)",
                    file_types=[".json"],
                )
                btn = gr.Button("리포트 생성", variant="primary")
                hist_btn = gr.Button("히스토리만 보기")
            with gr.Column():
                report_md = gr.Markdown(label="리포트")
                report_json = gr.JSON(label="ActingReport (raw)")
                history = gr.JSON(label="히스토리 (이전 리포트들)")
        btn.click(
            make_report,
            [user_id, session_file, summary_file],
            [report_md, report_json, history],
        )
        hist_btn.click(load_history, user_id, history)
    return demo


if __name__ == "__main__":
    build_demo().launch()
