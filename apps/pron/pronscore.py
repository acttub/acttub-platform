"""한국어 낭독 발음 채점 — 대본과 녹음을 받아 어느 어절의 어느 소리가 무엇처럼 들렸는지 짚는다.

방법(CTC-GOP):
  1) 대본 → 표준 발음(연음·비음화·유음화·경음화·격음화·구개음화·ㅎ 약화 규칙) → 음소열(MFA 표기)
  2) 음소 인식 모델 slplab/wav2vec2-xls-r-300m_phone-mfa_korean (Apache-2.0)로 녹음의 음소 확률을 구한다
  3) 음소마다 "대본대로" vs "그 음소를 다른 음소로 바꾼 것" 중 어느 쪽이 녹음 전체를 더 잘 설명하는지 CTC 확률로 비교
     lpr = log P(대본) − max log P(바꾼 것). 음수일수록 다른 소리로 들린 것
  4) 짚는 규칙: lpr < THRESHOLD, 모음↔모음·자음↔자음으로 바뀐 것만, 같은 계열(ㄱ/ㅋ/ㄲ 등)과 자연스러운 변이는 제외
"""
import os
import re
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path

import soundfile as sf
import torch
import torch.nn.functional as F
import torchaudio
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

MODEL = os.environ.get("PRON_MODEL", "slplab/wav2vec2-xls-r-300m_phone-mfa_korean")
MODEL_VERSION = MODEL.rsplit("/", 1)[-1] + "+ctc-gop-1"
THRESHOLD = -3.0   # 낮출수록(-4, -5) 덜 짚고 더 확실한 것만

# ── 표준 발음 → 음소 ────────────────────────────────────────────────────────
ONSET = {"ㄱ": "G", "ㄲ": "GG", "ㄴ": "N", "ㄷ": "D", "ㄸ": "DD", "ㄹ": "R", "ㅁ": "M", "ㅂ": "B", "ㅃ": "BB", "ㅅ": "S",
         "ㅆ": "SS", "ㅇ": None, "ㅈ": "J", "ㅉ": "JJ", "ㅊ": "CHh", "ㅋ": "Kh", "ㅌ": "Th", "ㅍ": "Ph", "ㅎ": "H"}
VOWEL = {"ㅏ": "A", "ㅐ": "E", "ㅑ": "iA", "ㅒ": "iE", "ㅓ": "EO", "ㅔ": "E", "ㅕ": "iEO", "ㅖ": "iE", "ㅗ": "O", "ㅘ": "oA",
         "ㅙ": "oE", "ㅚ": "oE", "ㅛ": "iO", "ㅜ": "U", "ㅝ": "uEO", "ㅞ": "oE", "ㅟ": "uI", "ㅠ": "iU", "ㅡ": "EU", "ㅢ": "euI", "ㅣ": "I"}
CODA = {"ㄱ": "k", "ㄲ": "k", "ㅋ": "k", "ㄳ": "k", "ㄺ": "k", "ㄴ": "N", "ㄵ": "N", "ㄶ": "N", "ㄷ": "t", "ㅅ": "t", "ㅆ": "t",
        "ㅈ": "t", "ㅊ": "t", "ㅌ": "t", "ㅎ": "t", "ㄹ": "L", "ㄼ": "L", "ㄽ": "L", "ㄾ": "L", "ㅀ": "L", "ㅁ": "M", "ㄻ": "M",
        "ㅂ": "p", "ㅍ": "p", "ㅄ": "p", "ㄿ": "p", "ㅇ": "NG"}
L_ONSET = list("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ")
L_VOWEL = list("ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ")
L_CODA = [""] + list("ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ")


def jamo(ch):
    code = ord(ch) - 0xAC00
    return L_ONSET[code // 588], L_VOWEL[(code % 588) // 28], L_CODA[code % 28]


# ── 표준 발음 규칙(핵심만) — 어절 안에서 받침과 다음 첫소리 사이에 적용한다 ──
DOUBLE = {"ㄳ": ("ㄱ", "ㅅ"), "ㄵ": ("ㄴ", "ㅈ"), "ㄶ": ("ㄴ", "ㅎ"), "ㄺ": ("ㄹ", "ㄱ"), "ㄻ": ("ㄹ", "ㅁ"), "ㄼ": ("ㄹ", "ㅂ"),
          "ㄽ": ("ㄹ", "ㅅ"), "ㄾ": ("ㄹ", "ㅌ"), "ㄿ": ("ㄹ", "ㅍ"), "ㅀ": ("ㄹ", "ㅎ"), "ㅄ": ("ㅂ", "ㅅ")}
NEUTRAL = {"ㄱ": "ㄱ", "ㄲ": "ㄱ", "ㅋ": "ㄱ", "ㄷ": "ㄷ", "ㅅ": "ㄷ", "ㅆ": "ㄷ", "ㅈ": "ㄷ", "ㅊ": "ㄷ", "ㅌ": "ㄷ", "ㅎ": "ㄷ",
           "ㅂ": "ㅂ", "ㅍ": "ㅂ", "ㄴ": "ㄴ", "ㄹ": "ㄹ", "ㅁ": "ㅁ", "ㅇ": "ㅇ"}
TENSE = {"ㄱ": "ㄲ", "ㄷ": "ㄸ", "ㅂ": "ㅃ", "ㅅ": "ㅆ", "ㅈ": "ㅉ"}
ASPIRATE = {"ㄱ": "ㅋ", "ㄷ": "ㅌ", "ㅂ": "ㅍ", "ㅈ": "ㅊ"}


def pronounce_word(word):
    """[(첫소리, 모음, 받침)] — 발음대로. 받침은 대표음(ㄱㄴㄷㄹㅁㅂㅇ) 또는 ''."""
    syl = [list(jamo(c)) for c in word if "가" <= c <= "힣"]
    for i in range(len(syl) - 1):
        cur, nxt = syl[i], syl[i + 1]
        coda, onset = cur[2], nxt[0]
        if not coda:
            continue
        if onset == "ㅇ":  # 연음 (ㅎ 받침은 떨어진다)
            if coda in DOUBLE:
                first, second = DOUBLE[coda]
                cur[2] = first
                nxt[0] = "" if second == "ㅎ" else second
            elif coda == "ㅎ":
                cur[2] = ""
            elif coda == "ㅇ":
                pass
            else:
                cur[2] = ""
                nxt[0] = coda
            if nxt[0] in ("ㄷ", "ㅌ") and nxt[1] == "ㅣ":  # 구개음화
                nxt[0] = "ㅈ" if nxt[0] == "ㄷ" else "ㅊ"
            continue
        if coda == "ㅎ" or (coda in DOUBLE and DOUBLE[coda][1] == "ㅎ"):  # ㅎ + ㄱㄷㅈ → 거센소리
            keep = DOUBLE[coda][0] if coda in DOUBLE else ""
            if onset in ASPIRATE:
                cur[2] = keep; nxt[0] = ASPIRATE[onset]; continue
            if onset == "ㄴ":
                cur[2] = keep or "ㄴ"; continue
            cur[2] = keep; continue
        if onset == "ㅎ" and coda in ("ㄴ", "ㄹ", "ㅁ", "ㅇ"):  # 울림소리 뒤 ㅎ은 실제 말에서 떨어진다(말해→마래)
            nxt[0] = "" if coda == "ㅇ" else coda
            cur[2] = "" if coda != "ㅇ" else "ㅇ"
            continue
        base = DOUBLE[coda][0] if coda in DOUBLE else coda
        if coda in ("ㄺ",): base = "ㄱ"
        if coda in ("ㄻ",): base = "ㅁ"
        if coda in ("ㄿ",): base = "ㅂ"
        rep = NEUTRAL.get(base, base)
        if onset == "ㅎ" and rep in ASPIRATE:  # 받침 + ㅎ → 거센소리
            cur[2] = ""; nxt[0] = ASPIRATE[rep]; continue
        if rep in ("ㄱ", "ㄷ", "ㅂ") and onset in ("ㄴ", "ㅁ"):  # 비음화
            rep = {"ㄱ": "ㅇ", "ㄷ": "ㄴ", "ㅂ": "ㅁ"}[rep]
        elif rep in ("ㄱ", "ㄷ", "ㅂ") and onset == "ㄹ":
            rep = {"ㄱ": "ㅇ", "ㄷ": "ㄴ", "ㅂ": "ㅁ"}[rep]; nxt[0] = "ㄴ"
        elif rep in ("ㅁ", "ㅇ") and onset == "ㄹ":
            nxt[0] = "ㄴ"
        elif (rep == "ㄴ" and onset == "ㄹ") or (rep == "ㄹ" and onset == "ㄴ"):  # 유음화
            rep = "ㄹ"; nxt[0] = "ㄹ"
        elif rep in ("ㄱ", "ㄷ", "ㅂ") and onset in TENSE:  # 경음화
            nxt[0] = TENSE[onset]
        cur[2] = rep
    for s in syl:
        if s[2]:
            base = DOUBLE[s[2]][0] if s[2] in DOUBLE else s[2]
            if s[2] in ("ㄺ",): base = "ㄱ"
            if s[2] in ("ㄻ",): base = "ㅁ"
            if s[2] in ("ㄿ",): base = "ㅂ"
            s[2] = NEUTRAL.get(base, base)
        if s[0] in ("ㄷ", "ㅌ") and s[1] == "ㅣ":
            pass
    return syl


def phonemes(text):
    """[(어절, [음소...]), ...] — 표준 발음 기준."""
    words = []
    for word in text.split():
        ph = []
        for o, v, c in pronounce_word(word):
            if o and ONSET.get(o): ph.append(ONSET[o])
            ph.append(VOWEL[v])
            if c: ph.append({"ㄱ": "k", "ㄴ": "N", "ㄷ": "t", "ㄹ": "L", "ㅁ": "M", "ㅂ": "p", "ㅇ": "NG"}[c])
        if ph:
            words.append((word, ph))
    return words


# ── 모델 ─────────────────────────────────────────────────────────────────────
@lru_cache(maxsize=1)
def model():
    proc = Wav2Vec2Processor.from_pretrained(MODEL)
    m = Wav2Vec2ForCTC.from_pretrained(MODEL).eval()
    return proc, m


def load(path):
    """16kHz 모노 파형. m4a 등 soundfile 이 못 읽는 형식은 ffmpeg 로 wav 로 바꿔 읽는다."""
    try:
        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    except Exception:
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(path), "-ac", "1", "-ar", "16000", tmp.name],
                           check=True, timeout=60)
            data, sr = sf.read(tmp.name, dtype="float32", always_2d=True)
    wav = torch.from_numpy(data.mean(1))
    if sr != 16000:
        wav = torchaudio.functional.resample(wav, sr, 16000)
    return wav


# ── 규칙 ─────────────────────────────────────────────────────────────────────
FAMILY = {}
for _fam in (("G", "Kh", "GG", "k"), ("D", "Th", "DD", "t"), ("B", "Ph", "BB", "p"), ("J", "CHh", "JJ"), ("S", "SS"), ("L", "R"), ("E", "iE")):
    for _x in _fam:
        FAMILY[_x] = _fam[0]
fam = lambda p: FAMILY.get(p, p)
VOWELS = set("A E EO EU I O U iA iE iEO iO iU oA oE uEO uI euI".split())
SONOR = VOWELS | {"N", "M", "L", "NG"}
# 정답 낭독에서만 나오던 자연스러운 변이 — 짚지 않는다
TOLERATED = {("R", "H"), ("L", "H"), ("iEO", "iO"), ("GG", "DD"), ("EU", "E")}
# ㅘ·ㅙ·ㅝ·ㅟ·ㅢ 는 표준 발음 낭독(맥 합성 음성 40줄 + Zeroth 공개 낭독 37줄)에서도 12~33% 를 짚었다. ㅢ→ㅣ(희망→히망),
# ㅙ→ㅔ 처럼 표준 발음이 원래 그렇게 나는 경우도 있다. 이 모델로는 가를 수 없어 짚지 않는다.
DIPHTHONGS = {"oA", "oE", "uEO", "uI", "euI"}
JAMO = {"G": "ㄱ", "GG": "ㄲ", "Kh": "ㅋ", "k": "ㄱ", "N": "ㄴ", "D": "ㄷ", "DD": "ㄸ", "Th": "ㅌ", "t": "ㄷ", "R": "ㄹ", "L": "ㄹ",
        "M": "ㅁ", "B": "ㅂ", "BB": "ㅃ", "Ph": "ㅍ", "p": "ㅂ", "S": "ㅅ", "SS": "ㅆ", "J": "ㅈ", "JJ": "ㅉ", "CHh": "ㅊ", "H": "ㅎ",
        "NG": "ㅇ", "A": "ㅏ", "E": "ㅔ", "EO": "ㅓ", "EU": "ㅡ", "I": "ㅣ", "O": "ㅗ", "U": "ㅜ", "iA": "ㅑ", "iE": "ㅖ",
        "iEO": "ㅕ", "iO": "ㅛ", "iU": "ㅠ", "oA": "ㅘ", "oE": "ㅙ", "uEO": "ㅝ", "uI": "ㅟ", "euI": "ㅢ"}


def flagged(p, threshold=THRESHOLD):
    if p["weak"] or p["lpr"] >= threshold:
        return False
    if (p["ph"], p["alt"]) in TOLERATED or p["ph"] in DIPHTHONGS:
        return False
    return (p["ph"] in VOWELS) == (p["alt"] in VOWELS)


# ── 채점 ─────────────────────────────────────────────────────────────────────
# 줄 녹음은 대사를 못 하고 기다린 소리까지 담길 수 있다(앱이 말이 끝날 때까지 녹음한다). 소리 없는 앞뒤를 잘라 내고,
# 그래도 길면 채점하지 않는다 — GOP 는 녹음 길이 × 음소 수 × 바꿔 볼 소리 수만큼 정렬을 돌려 긴 녹음에서 몇 분씩 걸린다.
MAX_SECONDS = float(os.environ.get("PRON_MAX_SECONDS", "30"))
_HOP = 320  # 20ms
_PAD_SECONDS = 0.3


class TooLong(ValueError):
    """잘라 낸 뒤에도 MAX_SECONDS 보다 긴 녹음."""


def voiced(wav, sr=16000):
    """소리 있는 구간만 남긴다(앞뒤 0.3초 여유). (잘라 낸 파형, 앞에서 뺀 표본 수). 소리를 못 찾으면 그대로 둔다.

    문턱은 녹음의 바닥 소음(20ms 구간 에너지의 하위 10%)보다 약 10dB 위, 최소 -46dBFS 다."""
    n = len(wav) // _HOP
    if n < 3:
        return wav, 0
    energy = wav[: n * _HOP].reshape(n, _HOP).pow(2).mean(1).sqrt()
    threshold = max(torch.quantile(energy, 0.1).item() * 3.0, 0.005)
    loud = (energy > threshold).nonzero().flatten()
    if len(loud) == 0:
        return wav, 0
    pad = int(_PAD_SECONDS * sr)
    start = max(0, int(loud[0]) * _HOP - pad)
    end = min(len(wav), (int(loud[-1]) + 1) * _HOP + pad)
    return wav[start:end], start


def log_probs(path_or_wav):
    proc, m = model()
    wav = path_or_wav if isinstance(path_or_wav, torch.Tensor) else load(path_or_wav)
    with torch.no_grad():
        inputs = proc(wav.numpy(), sampling_rate=16000, return_tensors="pt")
        return torch.log_softmax(m(inputs.input_values).logits[0], -1)


def gop(path, text, logp=None):
    """음소마다 lpr(대본 vs 가장 그럴듯한 다른 음소). logp 를 주면 녹음을 다시 돌리지 않는다."""
    proc, m = model()
    vocab = proc.tokenizer.get_vocab()
    inv = {v: k for k, v in vocab.items()}
    blank = proc.tokenizer.pad_token_id
    phones = [k for k in vocab if k not in ("[PAD]", "[UNK]", "|") and not k.startswith(("{", "<"))]
    words = phonemes(text)
    seq, owner = [], []
    for wi, (_, ph) in enumerate(words):
        if wi:
            seq.append(vocab["|"]); owner.append(None)
        for p in ph:
            seq.append(vocab[p]); owner.append(wi)
    if not seq:
        return {"words": [], "phones": []}
    if logp is None:
        logp = log_probs(path)
    T = logp.shape[0]
    variants, meta = [seq], [None]
    for j, tok in enumerate(seq):
        if owner[j] is None:
            continue
        p = inv[tok]
        for q in phones:
            if q == p or fam(q) == fam(p):
                continue
            v = seq.copy(); v[j] = vocab[q]
            variants.append(v); meta.append((j, q))
    lens = torch.tensor([len(v) for v in variants])
    tgt = torch.full((len(variants), int(lens.max())), blank, dtype=torch.long)
    for i, v in enumerate(variants):
        tgt[i, :len(v)] = torch.tensor(v)
    with torch.no_grad():
        nll = F.ctc_loss(logp.unsqueeze(1).expand(T, len(variants), logp.shape[-1]), tgt,
                         torch.full((len(variants),), T, dtype=torch.long), lens, blank=blank, reduction="none", zero_infinity=True)
    base = -float(nll[0])
    best = {}
    for i in range(1, len(variants)):
        j, q = meta[i]
        s = -float(nll[i])
        if s > best.get(j, (-1e9, ""))[0]:
            best[j] = (s, q)
    out = []
    for j, tok in enumerate(seq):
        if owner[j] is None:
            continue
        p = inv[tok]
        weak = p == "H" and j > 0 and seq[j - 1] != vocab["|"] and inv[seq[j - 1]] in SONOR
        out.append({"w": owner[j], "ph": p, "lpr": round(base - best[j][0], 2), "alt": best[j][1], "weak": weak})
    return {"words": [w for w, _ in words], "phones": out}


def score(path, text, threshold=THRESHOLD):
    """어절마다 짚은 소리. [{word, phones:[{expected, heard, lpr}]}] + 전체 음소 표."""
    g = gop(path, text)
    notes = {}
    for p in g["phones"]:
        if flagged(p, threshold):
            notes.setdefault(p["w"], []).append({"expected": JAMO.get(p["ph"], p["ph"]), "heard": JAMO.get(p["alt"], p["alt"]), "lpr": p["lpr"]})
    clean = lambda w: "".join(ch for ch in w if "가" <= ch <= "힣" or ch.isalnum())
    return {
        "notes": [{"index": wi, "word": clean(g["words"][wi]), "phones": ph} for wi, ph in sorted(notes.items())],
        "words": [clean(w) for w in g["words"]],
        "phones": [{**p, "ph_jamo": JAMO.get(p["ph"], p["ph"]), "alt_jamo": JAMO.get(p["alt"], p["alt"])} for p in g["phones"]],
    }


# ── 대본 정리: 지문 괄호를 지우고 숫자를 한글 읽기로 바꾼다(SOMA-606 실험의 rescore.py) ─────────────
SINO = "영일이삼사오육칠팔구"
NATIVE = {1: "한", 2: "두", 3: "세", 4: "네", 5: "다섯", 6: "여섯", 7: "일곱", 8: "여덟", 9: "아홉", 10: "열", 11: "열한", 12: "열두",
          13: "열세", 14: "열네", 15: "열다섯", 16: "열여섯", 17: "열일곱", 18: "열여덟", 19: "열아홉", 20: "스무"}
COUNTERS = ("개", "명", "시", "살", "마리", "번째", "잔", "병", "가지", "달", "군데", "장", "권", "대")


def _sino_small(n):
    s = ""
    for v, u in ((1000, "천"), (100, "백"), (10, "십")):
        q, n = divmod(n, v)
        if q:
            s += ("" if q == 1 else SINO[q]) + u
    if n:
        s += SINO[n]
    return s


def sino(n):
    if n == 0:
        return "영"
    out = ""
    for unit_val, unit in ((10 ** 8, "억"), (10 ** 4, "만")):
        if n >= unit_val:
            q, n = divmod(n, unit_val)
            out += _sino_small(q) + unit
    return out + _sino_small(n)


def num2kor(text):
    """60개→육십개가 아니라 1~20 뒤에 개·명·시 같은 단위가 오면 고유어(6시→여섯시), 나머지는 한자어(600억→육백억)."""
    def rep(m):
        n = int(m.group(1).replace(",", ""))
        after = text[m.end():m.end() + 2]
        if 0 < n <= 20 and after.startswith(COUNTERS):
            return NATIVE[n]
        return sino(n)
    return re.sub(r"(\d[\d,]*)", rep, text)


def strip_directions(text):
    return re.sub(r"\([^)]*\)", " ", text)


def normalize(text):
    return re.sub(r"\s+", " ", num2kor(strip_directions(text))).strip()


def number_words(text):
    """숫자가 든 어절의 자리 — 읽는 법이 갈려(육십/예순) 짚지 않는다. phonemes() 가 버리는 어절은 세지 않는다."""
    words = [w for w in strip_directions(text).split() if re.search(r"[가-힣0-9]", w)]
    return {i for i, w in enumerate(words) if re.search(r"\d", w)}


# ── 음소 시간 정렬(align.py): 음소마다 음절 자리와 시작·끝 시각 ─────────────────────────────────
FRAME_SECONDS = 0.02


def _align(logp, seq, blank):
    ali, _ = torchaudio.functional.forced_align(logp.unsqueeze(0), torch.tensor([seq]), blank=blank)
    ali = ali[0].tolist()
    spans = [[None, None] for _ in seq]
    ti, prev = -1, blank
    for f, lab in enumerate(ali):
        if lab != blank and (lab != prev or prev == blank):
            ti += 1
        if lab != blank and ti < len(seq):
            if spans[ti][0] is None:
                spans[ti][0] = f
            spans[ti][1] = f
        prev = lab
    return spans


def _edit_distance(a, b):
    """음소 가족(fam) 단위 편집 거리."""
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (fam(a[i - 1]) != fam(b[j - 1])))
            prev = cur
    return d[len(b)]


def script_match(logp, text):
    """모델이 녹음에서 바로 알아들은 음소열(CTC 최댓값 경로)이 대본 음소열과 얼마나 같은지(0~1).

    앱 받아쓰기가 잘리거나 숫자로 적혀도 대본대로 읽었는지를 녹음으로 다시 보는 데 쓴다(api PronunciationRules)."""
    proc, _ = model()
    vocab = proc.tokenizer.get_vocab()
    inv = {v: k for k, v in vocab.items()}
    skip = {proc.tokenizer.pad_token_id, vocab["|"]}
    expected = [p for _, ph in phonemes(text) for p in ph]
    if not expected:
        return None
    heard, last = [], None
    for t in logp.argmax(-1).tolist():
        if t != last and t not in skip and not inv.get(t, "[").startswith(("[", "{", "<")):
            heard.append(inv[t])
        last = t
    return round(max(0.0, 1 - _edit_distance(expected, heard) / len(expected)), 3)


def score_line(path, script_text, threshold=THRESHOLD):
    """한 줄 녹음을 채점한다. 어절마다 음소의 lpr·바뀐 소리·음절 자리·시각(ms)·짚음 여부를 돌려준다."""
    text = normalize(script_text)
    numw = number_words(script_text)
    proc, m = model()
    vocab = proc.tokenizer.get_vocab()
    blank = proc.tokenizer.pad_token_id
    wav, offset = voiced(load(path))
    if len(wav) / 16000 > MAX_SECONDS:
        raise TooLong(f"{len(wav) / 16000:.1f}s > {MAX_SECONDS:.0f}s")
    offset_ms = int(offset * 1000 / 16000)
    logp = log_probs(wav)
    g = gop(path, text, logp)
    words = phonemes(text)
    seq, owner, syl = [], [], []
    for wi, (w, ph) in enumerate(words):
        if wi:
            seq.append(vocab["|"]); owner.append(None); syl.append(None)
        si = 0
        for o, v, c in pronounce_word(w):
            n = (1 if (o and ONSET.get(o)) else 0) + 1 + (1 if c else 0)
            syl.extend([si] * n)
            si += 1
        for p in ph:
            seq.append(vocab[p]); owner.append(wi)
    spans = [[None, None] for _ in seq]
    if seq:
        try:
            spans = _align(logp, seq, blank)
        except Exception:  # 녹음이 음소열보다 짧으면 정렬이 안 된다 — 시각만 비운다
            pass
    out_words = [{"index": i, "word": w, "number": i in numw, "phones": []} for i, w in enumerate(g["words"])]
    k = 0
    for j, o in enumerate(owner):
        if o is None:
            continue
        p = g["phones"][k]; k += 1
        s0, s1 = spans[j]
        out_words[o]["phones"].append({
            "expected": JAMO.get(p["ph"], p["ph"]), "heard": JAMO.get(p["alt"], p["alt"]), "lpr": p["lpr"],
            "vowel": p["ph"] in VOWELS, "syllable": syl[j],
            "start_ms": None if s0 is None else offset_ms + int(s0 * FRAME_SECONDS * 1000),
            "end_ms": None if s0 is None else offset_ms + int(((s1 if s1 is not None else s0) + 1) * FRAME_SECONDS * 1000),
            "flagged": flagged(p, threshold) and o not in numw,
        })
    return {"scored_text": text, "threshold": threshold, "words": out_words, "script_match": script_match(logp, text)}
