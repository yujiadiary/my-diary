# -*- coding: utf-8 -*-
# 用法: python shui_mix.py -16     数字 = 水声音量dB，越小越轻，越大越浪，默认 -12
#      python shui_mix.py -8 voice.mp3   （第二个参数可换人声文件，默认 voice.mp3）
import os, sys, subprocess, wave, struct, math, json

FF = "ffmpeg"; FP = "ffprobe"
WORK = os.path.join(os.path.expanduser("~"), "voice_work")
os.chdir(WORK)

db = float(sys.argv[1]) if len(sys.argv) > 1 else -12.0
voice = sys.argv[2] if len(sys.argv) > 2 else "voice.mp3"
out = "shui_%+.0f.mp3" % db   # 产出 shui_-16.mp3 / shui_-8.mp3 ...

def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, p.stdout, p.stderr

def probe(path):
    code, o, err = run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "json", path])
    try: return float(json.loads(o)["format"]["duration"])
    except Exception: return -1.0

def vol(path):
    code, o, err = run([FF, "-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"])
    peak = mean = None
    for line in err.splitlines():
        if "max_volume:" in line:
            try: peak = float(line.split("max_volume:")[1].replace("dB", "").strip())
            except Exception: pass
        if "mean_volume:" in line:
            try: mean = float(line.split("mean_volume:")[1].replace("dB", "").strip())
            except Exception: pass
    return peak, mean

if not os.path.exists("water.m4a") or not os.path.exists(voice):
    print("[X] 找不到 water.m4a 或 %s —— 文件得躺在 %s" % (voice, WORK)); sys.exit(1)

print("[1] 解码水声")
code, o, err = run([FF, "-y", "-i", "water.m4a", "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", "water.wav"])
if code != 0:
    print("[X] 解码失败:"); print(err[-600:]); sys.exit(1)

wdur = probe("water.wav"); wpeak, wmean = vol("water.wav")
vdur = probe(voice);       vpeak, vmean = vol(voice)
print("    水声 %.1fs 峰 %s dB | 人声 %.1fs 峰 %s dB" % (wdur, wpeak, vdur, vpeak))
if None in (wpeak, vpeak) or min(wdur, vdur) <= 0:
    print("[X] 体检数据不全，停"); sys.exit(1)

print("[2] 挑最响的一段窗")
wf = wave.open("water.wav", "rb")
fr, nch, sw, nf = wf.getframerate(), wf.getnchannels(), wf.getsampwidth(), wf.getnframes()
raw = wf.readframes(nf); wf.close()
if sw != 2 or nch != 1:
    print("[X] wav 不是 16bit 单声道，停"); sys.exit(1)
x = struct.unpack("<%dh" % (len(raw) // 2), raw)
win = int(fr * 0.5)
nw = len(x) // win
rms = []
for i in range(nw):
    seg = x[i * win:(i + 1) * win]
    rms.append(math.sqrt(sum(v * v for v in seg) / len(seg)))

pad = 1.0
END = vdur + pad
need_w = int(END / 0.5 + 0.999)
if nw >= need_w:
    cur = sum(rms[:need_w]); best = cur; bi = 0
    for i in range(1, nw - need_w + 1):
        cur += rms[i + need_w - 1] - rms[i - 1]
        if cur > best: best = cur; bi = i
    st = bi * 0.5
    cut = x[bi * win:(bi + need_w) * win]
    print("    选中 %.1f s ~ %.1f s" % (st, st + need_w * 0.5))
else:
    cut = x
    print("    [!] 水声全长 %.1f s 不够垫 %.1f s，整条用" % (wdur, END))

with wave.open("water_cut.wav", "wb") as o2:
    o2.setnchannels(1); o2.setsampwidth(2); o2.setframerate(fr)
    o2.writeframes(struct.pack("<%dh" % len(cut), *cut))

cpeak, _ = vol("water_cut.wav")
gain = vpeak - db - cpeak   # 目标: 水声峰 = 人声峰 + db（db=-16 更轻 / -8 更浪）
print("[3] 水声峰压到 %.1f dB (人声峰 %.1f %+.0f) gain %+.1f dB" % (vpeak + db, vpeak, db, gain))

fc = ("[1:a]volume=%.2fdB,afade=t=in:st=0:d=0.5,afade=t=out:st=%.2f:d=1.4[w];"
      "[0:a]apad=pad_dur=1.0[v];"
      "[v][w]amix=inputs=2:duration=first:normalize=0[a]") % (gain, max(0.0, END - 1.4))
code, o, err = run([FF, "-y", "-i", voice, "-i", "water_cut.wav",
                    "-filter_complex", fc, "-map", "[a]",
                    "-c:a", "libmp3lame", "-q:a", "2", out])
if code != 0:
    print("[X] 混音失败:"); print(err[-600:]); sys.exit(1)

print("[4] 完成 -> %s\\%s" % (WORK, out))
try:
    os.startfile(WORK)
except Exception:
    pass
