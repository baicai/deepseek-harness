#!/usr/bin/env python3
"""Static, nonexecuting inventory of the *exact* vendor installer extraction.

Produces path/technology/host indicators only; does not print tokens, credentials,
URL paths, mouse IDs, audio, executable code, or original installer bytes.
"""
from __future__ import annotations
import collections
import hashlib
import json
import os
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1]).resolve()
report = pathlib.Path(sys.argv[2]).resolve()
report.parent.mkdir(parents=True, exist_ok=True)
extensions = {'.js', '.cjs', '.mjs', '.ts', '.tsx', '.json', '.yml', '.yaml', '.html', '.css', '.txt', '.xml', '.config', '.asar'}
terms = [
    'sensevoice', 'funasr', 'paraformer', 'whisper', 'sherpa', 'kaldi', 'onnxruntime',
    'onnx', 'vosk', 'pocketsphinx', 'wenet', 'sphinx', 'openai', 'qwen',
    'baidu', 'aliyun', 'dashscope', 'xfyun', 'iflytek', 'tencentcloud',
    'asr', 'speechrecognition', 'speech-to-text', 'speech_to_text',
    'transcrib', 'recogniz', 'speechsdk', 'websocket', 'umouse',
    'umouseSdk', 'keyEvent', 'startRecord', 'stopRecord', 'speech/down',
]
lower_terms = [(term, term.lower().encode('utf8')) for term in terms]
terms_seen = collections.Counter()
term_examples = collections.defaultdict(list)
names_seen = []
hosts = collections.Counter()
deps = []
assets = []
size_total = 0
scanned = 0
all_files = []
for path in root.rglob('*'):
    if path.is_file():
        all_files.append(path)
print('static scan file count:', len(all_files))
for path in sorted(all_files):
    rel = path.relative_to(root).as_posix()
    try:
        size = path.stat().st_size
    except OSError:
        continue
    if size > 0 and (path.suffix.lower() in {'.exe','.dll','.node','.onnx','.model','.bin','.wasm','.tflite','.gguf'}):
        if any(w in rel.lower() for w in ['speech','voice','audio','model','runtime','onnx','asr','engine','umouse']):
            assets.append((rel[:230], size))
    if any(term.lower() in rel.lower() for term in ['speech','voice','asr','recogniz','whisper','sensevoice','audio','umouse','mouse','onnx','model']):
        if len(names_seen) < 180: names_seen.append((rel[:230],size))
    if path.name == 'package.json' and len(deps) < 30 and size < 100_000:
        try:
            obj = json.loads(path.read_text('utf8'))
            if isinstance(obj, dict):
                pairs = {k:str(v)[:100] for field in ['dependencies','optionalDependencies'] for k,v in obj.get(field,{}).items() if any(t in k.lower() for t in ['speech','voice','asr','audio','onnx','whisper','native','electron','axios','grpc','websocket','umouse','mouse'])}
                deps.append((rel, obj.get('name'), obj.get('version'), pairs))
        except Exception: pass
    if path.suffix.lower() not in extensions or size < 5 or size > 90*1024*1024:
        continue
    if size_total > 1100*1024*1024: break
    try: data = path.read_bytes()
    except OSError: continue
    size_total += len(data)
    scanned += 1
    lowered = data.lower()
    for term, needle in lower_terms:
        count = lowered.count(needle)
        if count:
            terms_seen[term] += min(count, 1000)
            if len(term_examples[term]) < 8:
                term_examples[term].append(rel[:230])
    for match in re.finditer(rb'https?://([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?=[/:?#\s\x22\x27]|$)', data):
        host = match.group(1).decode('ascii','ignore').lower()
        if len(host)<120: hosts[host]+=1

def section(label, rows):
    lines.append('\n## '+label)
    if not rows: lines.append('(not observed)'); return
    lines.extend(rows)

lines = [
 '# Maohao 4.1.10 official client — static indicator report',
 'Input: only official user-supplied URL, scanned without launching installer or app',
 'Extraction: static file structure (Inno/DMG); Qt native binaries separately scanned',
 f'Files discovered: {len(all_files)}; text/asar files scanned: {scanned}; bytes scanned: {size_total}',
 'Interpretation: matching terms and hostnames do not prove actual runtime use; encryption/packing can obscure indicators.',
]
section('Audio/ASR engine and API keyword counts',
        [f'- {t}: {n}; files: {", ".join(term_examples[t][:4])}' for t,n in terms_seen.most_common()])
section('Possible voice/mouse/model filenames',
        [f'- {name} ({size} bytes)' for name,size in names_seen[:120]])
section('Possible voice/model native binaries and model assets',
        [f'- {name} ({size} bytes)' for name,size in assets[:100]])
section('Electron package metadata and relevant module dependencies',
        [f'- {path} name={name!r}, version={ver!r}; relevant_deps={json.dumps(pairs, ensure_ascii=False)}'
         for path,name,ver,pairs in deps[:30]])
section('Hostname indicators only (not URLs or API credentials)',
        [f'- {host}: {num}' for host,num in hosts.most_common(100)])
# Native application code is Mach-O / Qt, not Electron; no app.asar is expected.
# Inspect only the main app executable and specific nonframework app binaries, as raw
# bytes. Never print strings containing URL paths, tokens, user data, or whole binaries.
native_files = []
for path in sorted(all_files):
    rel = path.relative_to(root).as_posix()
    is_main_app = '/Contents/MacOS/' in rel and rel.count('.app/') == 1
    is_specific_audio_binary = (path.suffix.lower() in {'.dylib','.rcc','.dat','.onnx','.model'}
        and any(x in path.name.lower() for x in ['umouse','speech','voice','asr','audio','model'])
        and 'Chromium Embedded Framework' not in rel)
    if is_main_app or is_specific_audio_binary:
        try:
            if 0 < path.stat().st_size <= 160 * 1024 * 1024: native_files.append(path)
        except OSError: pass
native_report = []
for path in native_files[:20]:
    rel = path.relative_to(root).as_posix()
    try: blob = path.read_bytes()
    except OSError: continue
    needles = ['asr', 'speech', 'voice', 'transcrib', 'recogniz', 'whisper', 'funasr',
               'sensevoice', 'onnx', 'baidu', 'aliyun', 'xfyun', 'tencent', 'websocket',
               'dictation', 'audio', 'record', 'qtwebsockets', 'http']
    counts = {k: blob.lower().count(k.encode('ascii')) for k in needles}
    counts = {k:v for k,v in counts.items() if v}
    # Count only domains, not endpoint paths or credentials.
    domains = collections.Counter(m.group(1).decode('ascii','ignore').lower()
        for m in re.finditer(rb'https?://([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?=[/:?#\s\x22\x27]|$)', blob))
    # Extract standalone technology-looking ASCII identifiers without surrounding code.
    ascii_runs = re.findall(rb'[\x20-\x7e]{7,150}', blob)
    relevant = []
    for item in ascii_runs:
        candidate = item.decode('ascii','ignore')
        if any(re.search(r'(?i)(^|[^a-z])(asr|speech|voice|transcrib|recogniz|whisper|sensevoice|funasr|websocket)([^a-z]|$)', word)
               for word in re.findall(r'[A-Za-z0-9_.-]{5,90}', candidate)):
            for word in re.findall(r'[A-Za-z_][A-Za-z0-9_.-]{5,85}', candidate):
                if re.search(r'(?i)(asr|speech|voice|transcrib|recogniz|whisper|sensevoice|funasr|websocket)',word):
                    if word not in relevant: relevant.append(word)
                    if len(relevant) >= 50: break
        if len(relevant) >= 50: break
    native_report.append(
        f'- {rel[:180]} ({len(blob)} bytes)\n'
        f'  technology keyword matches: {json.dumps(counts,sort_keys=True)}\n'
        f'  hostname indicators: {json.dumps(dict(domains.most_common(24)))}\n'
        f'  selected identifier indicators: {json.dumps(relevant[:30],ensure_ascii=False)}'
    )
section('Native Mach-O application binary indicators (no raw strings, no secrets)',
        native_report)
report.write_text('\n'.join(lines)+'\n',encoding='utf8')
print('\n'.join(lines[:80])[:23000])
print('REPORT:',report)
