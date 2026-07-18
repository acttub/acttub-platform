"""수동 확인용 Gradio UI.

영상 + 서브텍스트(상황·인물설정·서브텍스트)를 올리고 "요약 생성"을 누르면
summarizer가 실제 Gemini를 호출해 SceneSummary(JSON)를 보여준다.

주의: "요약 생성" 클릭 시점에 실제 Gemini API가 호출된다(비용 발생 가능).
"""

import gradio as gr
from google import genai

from acting_summary.config import load_settings
from acting_summary.schema import SubText
from acting_summary.summarizer import summarize

_settings = load_settings()
_client = genai.Client(api_key=_settings.api_key)


def run(video, situation, character, subtext):
    if not video:
        return {"error": "영상을 먼저 올려줘"}
    result = summarize(
        video,
        SubText(situation=situation, character=character, subtext=subtext),
        client=_client,
        model=_settings.model,
    )
    return result.model_dump()


def build_demo():
    with gr.Blocks(title="acting-summary") as demo:
        gr.Markdown(
            f"# acting-summary\n영상 + 서브텍스트 → Gemini 통합 요약 "
            f"(model: `{_settings.model}`)"
        )
        with gr.Row():
            with gr.Column():
                video = gr.Video(label="영상")
                situation = gr.Textbox(label="상황", lines=2)
                character = gr.Textbox(label="인물설정", lines=2)
                subtext = gr.Textbox(label="서브텍스트", lines=2)
                btn = gr.Button("요약 생성", variant="primary")
            with gr.Column():
                out = gr.JSON(label="SceneSummary")
        btn.click(run, [video, situation, character, subtext], out)
    return demo


if __name__ == "__main__":
    build_demo().launch()
