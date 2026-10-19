// QuizScreen 테스트가 바꿔 끼우는 모듈들. 상대 대사 재생기·줄 녹음기·브라우저 STT·진행 저장 API·목소리 준비를 대신하고,
// 화면이 넘긴 인자를 quiz 에 모은다. 진행 상태는 진짜 상태머신으로 굴린다.
import { createElement, useState } from "react";

import { advance, begin, createRehearsal, pause, resume } from "../../src/lib/reading/rehearsal/machine.ts";

export const quiz = {};

export function resetQuiz() {
  Object.assign(quiz, {
    engine: "device",
    runner: { calls: [], voiceFailed: false, preparing: false, cfg: null, opts: null },
    rec: { enabled: null, recording: false, pending: 0, notice: null, notes: [], calls: [] },
    stt: { available: true, sessions: [] },
    saved: [],
  });
}
resetQuiz();

export function useRehearsalRunner(cfg, opts) {
  quiz.runner.cfg = cfg;
  quiz.runner.opts = opts;
  const [state, setState] = useState(() => createRehearsal(cfg));
  const { calls } = quiz.runner;
  return {
    state,
    voiceFailed: quiz.runner.voiceFailed,
    preparing: quiz.runner.preparing,
    start: async () => {
      calls.push("start");
      setState((s) => begin(s));
    },
    next: () => {
      calls.push("next");
      setState((s) => advance(s));
    },
    togglePause: () => {
      calls.push("togglePause");
      setState((s) => (s.status === "paused" ? resume(s) : pause(s)));
    },
    stop: () => calls.push("stop"),
  };
}

export function useLineRecorder(args) {
  quiz.rec.enabled = args.enabled;
  return {
    recording: quiz.rec.recording,
    pending: quiz.rec.pending,
    notice: quiz.rec.notice,
    noteTranscript: (...note) => quiz.rec.notes.push(note),
    restart: () => quiz.rec.calls.push("restart"),
    finish: () => quiz.rec.calls.push("finish"),
  };
}

export const sttAvailable = () => quiz.stt.available;
export function startAutoRecognition(cb) {
  const session = { cb, calls: [] };
  quiz.stt.sessions.push(session);
  return { finish: () => session.calls.push("finish"), abort: () => session.calls.push("abort") };
}

export async function saveProgress(sessionId, body) {
  quiz.saved.push({ sessionId, body });
  return { progress_seq: body.progress_seq, current_line_id: body.current_line_id, elapsed_seconds: body.elapsed_seconds, status: body.complete ? "completed" : "in_progress" };
}
const unused = (name) => () => {
  throw new Error(`QuizScreen 이 ${name} 를 부르지 않는다`);
};
export const createSession = unused("createSession");
export const listSessions = unused("listSessions");
export const getSession = unused("getSession");
export const deleteSession = unused("deleteSession");

export const getEngine = () => quiz.engine;

export function VoiceSetup({ onChange }) {
  return createElement("button", { type: "button", onClick: () => onChange({ ready: true, partnerVoice: "device" }) }, "기기 음성으로 하기");
}

export const AppRail = () => null;
export const deviceStyles = (roles) => Object.fromEntries(roles.map((role) => [role, { pitch: 1 }]));
