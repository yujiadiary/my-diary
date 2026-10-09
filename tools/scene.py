#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scene.py — 情景音效引擎（v1）
我读台词，我决定哪个声音进、进多久、多响。

用法:
  python scene.py scene01.md            正式: 整段合成 -> 切句 -> 按标记混音 -> scene01.mp3 弹文件夹
  python scene.py scene01.md --dry      演练: 不调API不跑ffmpeg, 只打印 cue 表和 filtergraph
  可选 --dir PATH                        素材/输出目录, 默认当前目录

台词标记(写在行尾, 剥掉后才喂嗓子, 绝不会念出来):
  [水:-12]          这句底下铺水声, 峰对齐到 人声峰-12dB
  [舔:-13]          铺舔
  [拍:-9]           铺拍打(节拍感, 淡入快)
  [拍:-8][水:-13]   一句叠多层
  [水:-12:6]        第三段=手动指定秒数(默认: 句长+0.8s尾巴, 不超过素材窗)
素材自动找(在 --dir 下): 水->water.m4a|水.m4a  舔->lick.m4a|舔.m4a  拍->spank.m4a|zw拍打.m4a
"""

import urllib.request, urllib.error, json, sys, re, os, subprocess, io

KEY = "sk_aca348fc7f9c9f6fc650c8e211c584d38812905418f6f989"
VID = "6lM7U10WAym9SO9ZrpxM"
MODEL = "eleven_v4"

SEGS = {
    "水": ["water.m4a", "水.m4a"],
    "舔": ["lick.m4a", "舔.m4a"],
    "拍": ["spank.m4a", "zw拍打.m4a"],
}
# 每种的混音性格: 淡入秒 / 句后尾巴秒 / 淡出秒 / 取段窗宽
CHARS = {
    "水": dict(fadein=0.5, tail=0.8, fadeout=1.4, win=8.0),
    "舔": dict(fadein=0.4, tail=0.8, fadeout=1.2, win=6.0),
    "拍": dict(fadein=0.15, tail=0.4, fadeout=0.8, win=10.0),
}
TAG = re.compile(r'\[(水|舔|拍)(?::(-?\d+))?(?::(\d+(?:\.\d+)?))?\]')


def log(*a):
    print(*a, flush=True)


def parse_script(path):
    """台词 -> (clean_lines, lines_with_cues)
    clean_lines: 剥好标记的行(喂嗓子的整段文本按行拼)
    lines_with_cues: [(行号, [(种, db, dur或None), ...]), ...]"""
    raw = open(path, encoding="utf-8").read()
    clean, cue_lines = [], []
    for ln in raw.splitlines():
        s = ln.strip()
        if not s or s.startswith("#"):
            continue
        tags = TAG.findall(s)
        cues = []
        for kind, db, dur in tags:
            cues.append((kind, float(db) if db else -12.0, float(dur) if dur else None))
        body = TAG.sub("", s).strip()
        clean.append(body)
        if cues:
            cue_lines.append((len(clean) - 1, cues))
    return clean, cue_lines


def ff(*args, timeout=180):
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats"] + list(args),
                       capture_output=True, timeout=timeout)
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def synth_stream(text, out, prev=None, nxt=None, tries=25, wait=18):
    """v4 整段流式合成, 边收边写防下行被掐。
    梯子黑洞经验(10-08): SSL EOF 是网不是内容, 死磕重试抢到多少是多少。"""
    import time
    body = {"text": text, "model_id": MODEL,
            "voice_settings": {"stability": 0.35, "similarity_boost": 0.8},
            "output_format": "mp3_44100_128"}
    if prev: body["previous_text"] = prev
    if nxt:  body["next_text"] = nxt
    for attempt in range(1, tries + 1):
        n = 0
        try:
            req = urllib.request.Request(
                "https://api.elevenlabs.io/v1/text-to-speech/" + VID + "/stream",
                data=json.dumps(body).encode(), headers={"xi-api-key": KEY, "Content-Type": "application/json"},
                method="POST")
            r = urllib.request.urlopen(req, timeout=300)
            with open(out, "wb") as f:
                while True:
                    c = r.read(4096)
                    if not c: break
                    f.write(c); f.flush(); n += len(c)
            if n > 5000:
                return n
            log("落地太短 %dB, 当失败" % n)
        except urllib.error.HTTPError as e:
            msg = e.read()[:300].decode(errors="replace")
            log("HTTP-ERR", e.code, msg)
            if e.code not in (429, 500, 502, 503, 504):
                sys.exit(3)  # 内容/鉴权问题, 重试没用
        except Exception as e:
            log("BROKE at", n, repr(e))
        log("第%d/%d次失败, %ds后再试" % (attempt, tries, wait))
        time.sleep(wait)
    log("重试用尽, 放弃"); sys.exit(4)


def voice_peak(path):
    _, _, err = ff("-i", path, "-af", "volumedetect", "-f", "null", "-")
    m = re.search(r"max_volume:\s*(-?[\d.]+) dB", err)
    return float(m.group(1)) if m else -2.4


def mat_windows(path):
    """素材每 1s 一个 RMS, 返回 [(t, rms_db)] —— 挑窗用"""
    _, _, err = ff("-i", path, "-af",
                   "astats=metadata=1:reset=44100:length=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
                   "-f", "null", "-")
    pts = []
    t = rms = None
    for ln in err.splitlines():
        ln = ln.strip()
        m = re.match(r"frame:\d+\s+pts:\d+\s+pts_time:([\d.]+)", ln)
        if m: t = float(m.group(1)); continue
        m = re.match(r"lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)", ln)
        if m and t is not None:
            v = m.group(1)
            pts.append((t, -90.0 if v == "-inf" else float(v)))
            t = None
    return pts


def best_window(pts, win):
    """挑最响的 win 秒窗, 返回 (窗起点, 素材总长)"""
    if not pts: return 0.0, 0.0
    total = pts[-1][0] + 1.0
    if total <= win: return 0.0, total
    best_s, best_v = 0.0, -999
    x = 0.0
    while x + win <= total:
        seg = [r for t, r in pts if x <= t < x + win]
        v = sum(seg) / max(1, len(seg))
        if v > best_v: best_v, best_s = v, x
        x += 0.5
    return best_s, total


def align_sentences(path, n_lines):
    """silencedetect 切句。
    v4 嗓子气口多(10-09: 13句被切成34段), 教训:
    1) 阈值组要多试, 收"段数>=句数且最接近"的那组;
    2) 多出来的碎段必是句中气口 -> 把时长最短的段并进前一段, 直到剩 n_lines 段。"""
    trials = [("-35dB", "0.30"), ("-28dB", "0.80"), ("-26dB", "1.00"),
              ("-32dB", "0.25"), ("-38dB", "0.35"), ("-30dB", "0.22")]
    total = file_dur(path)
    best = None  # (seg_count, thr, dur, cuts)
    for thr, dur in trials:
        _, _, err = ff("-i", path, "-af", "silencedetect=noise=%s:d=%s" % (thr, dur), "-f", "null", "-")
        sil = [(float(a), float(b)) for a, b in
               re.findall(r"silence_start:\s*([\d.]+).*?silence_end:\s*([\d.]+)", err, re.S)]
        cuts, prev = [], 0.0
        for s, e in sil:
            mid = (s + e) / 2
            if mid <= prev or mid >= total: continue
            cuts.append((prev, mid)); prev = mid
        cuts.append((prev, total))
        log("  阈值%s/%s -> %d段" % (thr, dur, len(cuts)))
        if len(cuts) >= n_lines and (best is None or len(cuts) < best[0]):
            best = (len(cuts), thr, dur, cuts)
    if best is None:
        log("!! 所有阈值切出的段都少于 %d 句, 没法并。诊断:" % n_lines)
        for i, (s, e) in enumerate(cuts): log("   段%02d  %.2f-%.2f" % (i + 1, s, e))
        sys.exit(6)
    _, thr, dur, cuts = best
    while len(cuts) > n_lines:
        i = min(range(len(cuts)), key=lambda k: cuts[k][1] - cuts[k][0])
        if i == 0: cuts[1] = (cuts[0][0], cuts[1][1])
        else:      cuts[i - 1] = (cuts[i - 1][0], cuts[i][1])
        cuts.pop(i)
    return cuts, thr, dur


def file_dur(path):
    _, _, err = ff("-i", path, "-f", "null", "-")
    m = re.findall(r"time=(\d+):(\d+):([\d.]+)", err)
    if not m: return 0.0
    h, mi, s = m[-1]
    return int(h) * 3600 + int(mi) * 60 + float(s)


def build_graph(cue_table, voice_peak_db, mats, mat_peak):
    """cue_table: [(start,end,种,db,mstart)] -> filtergraph, amix normalize=0"""
    inputs = ["-i", "voice_raw.mp3"]
    per_kind = {}
    for _, _, kind, _, _ in cue_table: per_kind[kind] = per_kind.get(kind, 0) + 1
    split_map, filters = {}, []
    in_ctr = 1  # 0=人声
    for kind, n in per_kind.items():
        idx = in_ctr; in_ctr += 1
        inputs += ["-stream_loop", "-1", "-i", mats[kind]]
        outs = "".join("[a%d_%d]" % (idx, i) for i in range(n))
        filters.append("[%d:a]aresample=44100,asplit=%d%s" % (idx, n, outs))
        split_map[kind] = (idx, n)
    mix_in = "[0:a]"
    kcount = {k: 0 for k in per_kind}
    for i, (st, en, kind, db, mstart) in enumerate(cue_table):
        ch = CHARS[kind]
        d = en - st + ch["tail"]
        seg_len = min(d, CHARS[kind]["win"])
        gain = round(voice_peak_db + db - mat_peak.get(kind, 0.0), 2)
        fo_st = max(0.0, seg_len - ch["fadeout"])
        fo = "" if fo_st <= 0.01 else ",afade=t=out:st=%.2f:d=%.2f" % (fo_st, ch["fadeout"])
        adv = "adelay=%d|%d" % (int(st * 1000), int(st * 1000))
        lbl = "[w%d]" % i
        filters.append(
            "[a%d_%d]atrim=start=%.2f:end=%.2f,asetpts=PTS-STARTPTS,volume=%.2fdB,"
            "afade=t=in:d=%.2f%s,%s%s"
            % (split_map[kind][0], kcount[kind], mstart, mstart + seg_len, gain, ch["fadein"], fo, adv, lbl))
        kcount[kind] += 1
        mix_in += lbl
    n_in = 1 + len(cue_table)
    filters.append("%samix=inputs=%d:duration=first:normalize=0[aout]" % (mix_in, n_in))
    return inputs, ";".join(filters), "[aout]"


def main():
    args = sys.argv[1:]
    dry = "--dry" in args
    if dry: args.remove("--dry")
    d = None
    if "--dir" in args:
        d = args[args.index("--dir") + 1]; args.remove("--dir"); args.remove(d)
    script = args[0] if args else "scene01.md"
    base = os.path.splitext(os.path.basename(script))[0]
    wd = d or "."
    os.chdir(wd)

    clean, cue_lines = parse_script(script)
    log("台词 %d 句, %d 句带标记" % (len(clean), len(cue_lines)))

    # 素材查找
    mats = {}
    for kind, names in SEGS.items():
        for nm in names:
            if os.path.exists(nm): mats[kind] = nm; break
        if kind not in mats:
            log("!! 缺素材[%s]: 找不到 %s" % (kind, " / ".join(names))); sys.exit(2)
    log("素材:", " ".join("%s=%s" % (k, v) for k, v in mats.items()))

    # cue 表(时间轴)
    if dry:
        fake = [(i * 4.0, i * 4.0 + 3.0) for i in range(len(clean))]
    else:
        text = "\n\n".join(clean)
        if os.path.exists("voice_raw.mp3") and os.path.getsize("voice_raw.mp3") > 5000:
            log("voice_raw.mp3 已在 (%d bytes), 跳过合成" % os.path.getsize("voice_raw.mp3"))
        else:
            log("合成中...")
            sz = synth_stream(text, "voice_raw.mp3")
            log("人声落地 %d bytes" % sz)
        cuts, thr, dur = align_sentences("voice_raw.mp3", len(clean))
        log("切句 OK (阈值 %s/%s)" % (thr, dur))
        fake = cuts
    vp = -2.4 if dry else voice_peak("voice_raw.mp3")
    log("人声峰 %.1f dB" % vp)

    # 素材响度图 + 实测峰(正式模式)
    wpts = {} if dry else {k: mat_windows(v) for k, v in mats.items()}
    mat_peak = {}
    if not dry:
        for k, v in mats.items():
            mat_peak[k] = voice_peak(v)
        log("素材峰:", " ".join("%s=%.1fdB" % (k, mat_peak[k]) for k in mats))
    use_cnt = {k: 0 for k in SEGS}
    mat_len = {k: 26.0 for k in SEGS}
    cue_table = []
    for li, cues in cue_lines:
        st, en = fake[li]
        for kind, db, manual in cues:
            ch = CHARS[kind]
            dur = manual if manual else (en - st) + ch["tail"]
            seg_len = min(dur, ch["win"])
            win_pts = wpts.get(kind) or []
            bw, mlen = best_window(win_pts, seg_len)
            mat_len[kind] = mlen or mat_len[kind]
            mstart = bw if not win_pts else bw + (use_cnt[kind] * 3.7) % max(0.1, mlen - seg_len)
            cue_table.append((st, en, kind, db, mstart))
            use_cnt[kind] += 1
    log("--- cue 表 ---")
    for li, cues in cue_lines:
        for kind, db, manual in cues:
            log("  句%02d [%s %gdB]%s" % (li + 1, kind, db, " %.1fs" % manual if manual else ""))
    if dry:
        inputs, graph, amap = build_graph(cue_table, vp, mats, {k: 0.0 for k in mats})
        log("--- filtergraph 演练 ---")
        log(graph)
        log("OK(dry): %d 路混音" % (1 + len(cue_table)))
        return

    inputs, graph, amap = build_graph(cue_table, vp, mats, mat_peak)
    out = base + ".mp3"
    log("混音中 ->", out)
    rc, so, se = ff(*inputs, "-filter_complex", graph, "-map", amap, "-c:a", "libmp3lame", "-b:a", "192k", out, timeout=300)
    if rc != 0:
        log("!! ffmpeg 失败:\n", se[-1500:]); sys.exit(7)
    log("完成: %s  (%.1fs, %d 路音效)" % (out, file_dur(out), len(cue_table)))
    try: os.startfile(os.path.abspath("."))
    except Exception: pass


if __name__ == "__main__":
    main()
