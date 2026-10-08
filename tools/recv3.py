# -*- coding: utf-8 -*-
# 水声管线 · 电脑端：收两个文件 -> 解码 -> 体检 -> 挑响窗 -> 峰对齐-12dB -> 混音
# 用法: python recv2.py   （放哪都行，工作目录固定在 ~/voice_work）
import os, sys, subprocess, json, wave, struct, math, socket, time, threading, shutil, glob
from http.server import HTTPServer, BaseHTTPRequestHandler

WORK = os.path.join(os.path.expanduser("~"), "voice_work")
os.makedirs(WORK, exist_ok=True)
os.chdir(WORK)

def find_ff(tool):
    p = shutil.which(tool)
    if p:
        return p
    la = os.environ.get("LOCALAPPDATA", "")
    cand = [os.path.join(la, "Microsoft", "WinGet", "Links", tool + ".exe")]
    pkgs = os.path.join(la, "Microsoft", "WinGet", "Packages")
    if os.path.isdir(pkgs):
        cand += glob.glob(os.path.join(pkgs, "*", "**", "bin", tool + ".exe"), recursive=True)
    for c in cand:
        if c and os.path.exists(c):
            return c
    return None

FF = find_ff("ffmpeg")
FP = find_ff("ffprobe")
if not FF or not FP:
    print("[X] 没找到 ffmpeg/ffprobe。跑: winget install --id Gyan.FFmpeg -e")
    print("    装完把所有 PowerShell 窗口全部关掉，重开一个新窗口再试")
    sys.exit(1)
print("[0] ffmpeg 就位: " + FF)

def run(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True)
    except FileNotFoundError:
        return -1, "", "[X] 找不到命令: %s" % cmd[0]
    return r.returncode, r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace")

ip = "127.0.0.1"
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("223.5.5.5", 53))
    ip = s.getsockname()[0]; s.close()
except Exception:
    pass

NEEDED = {"water.m4a", "voice.mp3"}
got = set()

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        name = os.path.basename(self.path)
        n = int(self.headers.get("Content-Length", 0) or 0)
        left = n
        with open(os.path.join(WORK, name), "wb") as f:
            while left > 0:
                chunk = self.rfile.read(min(65536, left))
                if not chunk: break
                f.write(chunk); left -= len(chunk)
        got.add(name)
        print("[收到] %s (%d bytes)" % (name, n), flush=True)
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
    def log_message(self, *a):
        pass

srv = HTTPServer(("0.0.0.0", 8766), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
print()
print("=" * 50)
print("  本机内网 IP: %s    <- 把这行发给江予朔" % ip)
print("  监听 8766，等两个文件: water.m4a / voice.mp3")
print("  若弹防火墙提示: 勾「专用网络」并点允许")
print("=" * 50)

t0 = time.time()
while not NEEDED.issubset(got):
    time.sleep(1)
    if time.time() - t0 > 1800:
        print("[X] 等了 30 分钟没等到文件，退出"); sys.exit(1)

print("[1] 文件齐了，开始干活")

def probe(path):
    code, out, err = run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "json", path])
    try: return float(json.loads(out)["format"]["duration"])
    except Exception: return -1.0

def vol(path):
    code, out, err = run([FF, "-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"])
    peak = mean = None
    for line in err.splitlines():
        if "max_volume:" in line:
            try: peak = float(line.split("max_volume:")[1].replace("dB", "").strip())
            except Exception: pass
        if "mean_volume:" in line:
            try: mean = float(line.split("mean_volume:")[1].replace("dB", "").strip())
            except Exception: pass
    return peak, mean

print("[2] 解码 water.m4a -> water.wav")
code, out, err = run([FF, "-y", "-i", "water.m4a", "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", "water.wav"])
if code != 0:
    print("[X] 解码失败:"); print(err[-600:]); sys.exit(1)

wdur = probe("water.wav"); wpeak, wmean = vol("water.wav")
vdur = probe("voice.mp3"); vpeak, vmean = vol("voice.mp3")
print()
print("---- 体检 ----")
print("水声: %.1f 秒, 峰值 %s dB, 平均 %s dB" % (wdur, wpeak, wmean))
print("人声: %.1f 秒, 峰值 %s dB, 平均 %s dB" % (vdur, vpeak, vmean))
if None in (wpeak, wmean, vpeak, vmean) or min(wdur, vdur) <= 0:
    print("[X] 体检数据不全，停"); sys.exit(1)

print("[3] 挑最响的一段窗")
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
    print("    [!] 水声全长 %.1f s 不够垫 %.1f s，整条用，中途会断（v1 先听效果）" % (wdur, END))

wcut = "water_cut.wav"
with wave.open(wcut, "wb") as o:
    o.setnchannels(1); o.setsampwidth(2); o.setframerate(fr)
    o.writeframes(struct.pack("<%dh" % len(cut), *cut))

cpeak, _ = vol(wcut)
gain = vpeak - 12.0 - cpeak
print("[4] 峰对齐: 水声压到 %.1f dB (人声峰 %.1f - 12), gain %+.1f dB" % (vpeak - 12.0, vpeak, gain))

fc = ("[1:a]volume=%.2fdB,afade=t=in:st=0:d=0.5,afade=t=out:st=%.2f:d=1.4[w];"
      "[0:a]apad=pad_dur=1.0[v];"
      "[v][w]amix=inputs=2:duration=first:normalize=0[a]") % (gain, max(0.0, END - 1.4))
code, out, err = run([FF, "-y", "-i", "voice.mp3", "-i", wcut,
                      "-filter_complex", fc, "-map", "[a]",
                      "-c:a", "libmp3lame", "-q:a", "2", "shui_v1.mp3"])
if code != 0:
    print("[X] 混音失败:"); print(err[-600:]); sys.exit(1)

print("[5] 完成 -> %s\\shui_v1.mp3" % WORK)
print("    人声 %.1f 秒 + 1.0 秒尾巴 | 0.5 秒淡入, 1.4 秒淡出, amix normalize=0" % vdur)
print()
print(">>> 听 %s\\shui_v1.mp3 ，然后把整屏报告发回给江予朔 <<<" % WORK)
try:
    os.startfile(WORK)
except Exception:
    pass
