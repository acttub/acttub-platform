package com.acttub.actingapi.feature.reading.adapter;

import java.nio.file.Path;

import com.acttub.actingapi.feature.reading.app.RetranscribeAudio;
import com.acttub.actingapi.integration.media.AudioPeak;
import com.acttub.actingapi.integration.observation.SpeechAnalysis;
import com.acttub.actingapi.integration.observation.SpeechAnalyzer;

/**
 * 소리 재기는 ffmpeg, 받아쓰기는 코칭이 쓰는 받아쓰기 모델(ko-KR, 들은 그대로)이다. 받아쓰기는 녹음에서 16kHz 모노 WAV 를
 * 뽑아 보낸다. 리딩 녹음은 코칭 회차가 아니라 LLM 기록(회차 id)에 남기지 않는다.
 */
class MediaRetranscribeAudio implements RetranscribeAudio {
    private final AudioPeak peak;
    private final SpeechAnalyzer speech;

    MediaRetranscribeAudio(AudioPeak peak, SpeechAnalyzer speech) {
        this.peak = peak;
        this.speech = speech;
    }

    @Override
    public double peakDb(Path audio) {
        return peak.peakDb(audio);
    }

    @Override
    public String transcribe(Path audio) {
        SpeechAnalysis analysis = speech.analyze(audio, null, null);
        return analysis == null || analysis.transcript() == null ? "" : analysis.transcript();
    }
}
