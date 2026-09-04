#!/usr/bin/env python3
"""Lint the generated voice clips: transcribe every clip with Whisper and flag
lines whose transcript drifts from the text that was meant to be spoken.

usage: check-voices.py <script.voice.json> [--lang he] [--model small] [--phonetic]

Prints one row per clip (similarity, speaker, expected, heard) and exits 1 when
any clip scores below the threshold.  `--phonetic` adds an English-forced
transcription, a rough phonetic reading useful for judging Hebrew vowels
("matzata" vs "matzat")."""
import argparse, json, re, sys, unicodedata
from difflib import SequenceMatcher

ap = argparse.ArgumentParser()
ap.add_argument('manifest')
ap.add_argument('--lang', default=None)
ap.add_argument('--model', default='small')
ap.add_argument('--threshold', type=float, default=0.6)
ap.add_argument('--phonetic', action='store_true')
a = ap.parse_args()

try:
    from faster_whisper import WhisperModel
except ImportError:
    sys.exit('faster-whisper is not installed: pip install faster-whisper')

clips = json.load(open(a.manifest, encoding='utf-8'))
lang = a.lang or ('he' if any(re.search(r'[֐-׿]', c.get('text', '')) for c in clips) else 'en')
model = WhisperModel(a.model, device='cpu', compute_type='int8')

def norm(s):
    s = unicodedata.normalize('NFKD', s or '')
    s = re.sub(r'[֑-ׇ]', '', s)                 # nikud
    s = re.sub(r"[^\w\s']", ' ', s).lower()
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def heb_fold(s):
    # spelling variants Whisper produces for the same sounds
    return s.replace('כ', 'ק').replace('ת', 'ט').replace('ש', 'ס').replace('ע', 'א').replace('ח', 'כ').replace('וו', 'ו').replace('יי', 'י')

bad = 0
rows = []
for c in clips:
    segs, _ = model.transcribe(c['clip'], language=lang, beam_size=5)
    heard = ' '.join(s.text.strip() for s in segs)
    exp = norm(c.get('spoken') or c.get('text'))
    got = norm(heard)
    sim = SequenceMatcher(None, heb_fold(exp) if lang == 'he' else exp, heb_fold(got) if lang == 'he' else got).ratio()
    phon = ''
    if a.phonetic and lang != 'en':
        segs2, _ = model.transcribe(c['clip'], language='en', beam_size=5)
        phon = ' '.join(s.text.strip() for s in segs2)
    rows.append((sim, c, heard, phon))
rows.sort(key=lambda r: r[0])
for sim, c, heard, phon in rows:
    flag = 'LOW ' if sim < a.threshold else 'ok  '
    if sim < a.threshold: bad += 1
    print(f"{flag}{sim:.2f}  t={c['t0']:7.2f}s  {c.get('speaker') or 'narration'}")
    print(f"      text : {c.get('text')}")
    if c.get('spoken') and c['spoken'] != c['text']: print(f"      spoken: {c['spoken']}")
    print(f"      heard: {heard}")
    if phon: print(f"      phon : {phon}")
print(f"\n{len(rows)} clips, {bad} below {a.threshold}")
sys.exit(1 if bad else 0)
