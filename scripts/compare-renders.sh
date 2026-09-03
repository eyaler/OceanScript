#!/bin/sh
# Compares the video streams of two renders frame by frame (PSNR per frame),
# then lists the time ranges where frames differ.
A="$1"; B="$2"; FPS="${3:-24}"
FF=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
$FF -hide_banner -loglevel error -i "$A" -i "$B" -lavfi "[0:v][1:v]psnr=stats_file=/tmp/psnr.txt" -f null - 
python3 - "$FPS" <<'PY'
import sys, re
fps=float(sys.argv[1]); rows=[]
for line in open('/tmp/psnr.txt'):
    m=re.search(r'n:(\d+).*?psnr_avg:(\S+)', line)
    if m: rows.append((int(m.group(1)), float('inf') if m.group(2)=='inf' else float(m.group(2))))
ident=[n for n,p in rows if p==float('inf')]
diff=[n for n,p in rows if p!=float('inf')]
print(f"frames compared: {len(rows)}; bit-identical: {len(ident)}; differing: {len(diff)}")
# group differing frames into ranges
ranges=[]
for n in diff:
    if ranges and n==ranges[-1][1]+1: ranges[-1][1]=n
    else: ranges.append([n,n])
for a,b in ranges:
    ps=[p for n,p in rows if a<=n<=b]
    print(f"  {a/fps:7.2f}s - {(b+1)/fps:7.2f}s  ({b-a+1} frames, min psnr {min(ps):.1f} dB)")
PY
