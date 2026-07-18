from pathlib import Path

import gradio as gr
from google import genai

from acting_agent import engine
from acting_agent.clip import build_clip_html
from acting_agent.config import load_settings
from acting_agent.store import InMemorySessionStore
from acting_agent.summary_schema import SceneSummary
from acting_agent.transcript import save_transcript

TRANSCRIPT_DIR = Path(__file__).parent / "transcripts"

settings = load_settings()
client = genai.Client(api_key=settings.api_key)
store = InMemorySessionStore()


def start_chat(summary_file, video_path):
    summary = SceneSummary.model_validate_json(
        Path(summary_file).read_text(encoding="utf-8")
    )
    sid = "ui"
    _, reply = engine.start(
        sid, summary, client=client, model=settings.model, store=store
    )
    clip_html = ""
    if video_path:
        clip_html = build_clip_html(f"/gradio_api/file={video_path}")
    return (
        sid,
        [{"role": "assistant", "content": reply.utterance}],
        clip_html,
        gr.update(visible=False),
        gr.update(visible=True),
    )


def respond(sid, history, message):
    session = store.get(sid)
    reply = engine.reply(
        session,
        message,
        client=client,
        model=settings.model,
        max_questions=settings.max_questions,
    )
    store.save(session)
    history = history + [
        {"role": "user", "content": message},
        {"role": "assistant", "content": reply.utterance},
    ]
    transcript = None
    if session.status == "closed":
        transcript = str(save_transcript(session, TRANSCRIPT_DIR))
    return history, "", transcript


with gr.Blocks() as demo:
    sid = gr.State("")
    with gr.Column() as upload_screen:
        video = gr.Video(label="연기 영상")
        file = gr.File(label="요약 JSON", file_types=[".json"])
        start_btn = gr.Button("코칭 시작", variant="primary")
    with gr.Column(visible=False) as chat_screen:
        focus_panel = gr.HTML()
        chat = gr.Chatbot()
        msg = gr.Textbox(label="답변 (타이핑)")
        transcript = gr.File(label="대화 내역 JSON (세션 종료 시)", interactive=False)
    start_btn.click(
        start_chat,
        [file, video],
        [sid, chat, focus_panel, upload_screen, chat_screen],
        api_name="start_chat",
    )
    msg.submit(respond, [sid, chat, msg], [chat, msg, transcript])

if __name__ == "__main__":
    demo.launch()
