"""Render a film from final2.py on several processes: each renders a slice of the frames to its own
video-only segment (same encoder settings), the segments are joined without re-encoding, and the mix is
added with the same loudness normalisation as final2.main().

Usage: FILM=showcase python scripts/video/render_parallel.py [workers]
"""
import os
import subprocess
import sys
import time
from multiprocessing import get_context

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def segment(args):
    k, a, b, path = args
    import numpy as np

    import final2 as f
    cmd = [f.FFMPEG, '-hide_banner', '-loglevel', 'error', '-y',
           '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{f.W}x{f.H}', '-r', str(f.FPS), '-i', '-',
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-tune', 'film', path]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(a, b):
        p.stdin.write(np.clip(f.frame_at(i / f.FPS), 0, 255).astype(np.uint8).tobytes())
        if (i - a) % 300 == 0:
            print(f'segment {k}: frame {i - a}/{b - a}', flush=True)
    p.stdin.close()
    p.wait()
    print(f'segment {k} done ({p.returncode})', flush=True)
    return p.returncode


def main():
    import final2 as f
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    work = os.path.join(f.VID, 'work', f'segments_{f.NAME}')
    os.makedirs(work, exist_ok=True)
    audio = os.path.join(f.VID, 'audio', f'mix{f.SUFFIX}.wav')
    f.sound(audio)
    n = int(round(f.TOTAL * f.FPS))
    cuts = [round(n * j / workers) for j in range(workers + 1)]
    jobs = [(j, cuts[j], cuts[j + 1], os.path.join(work, f'seg{j:02d}.mp4')) for j in range(workers)]
    t0 = time.time()
    with get_context('spawn').Pool(workers) as pool:
        codes = pool.map(segment, jobs)
    assert all(c == 0 for c in codes), codes
    print(f'frames done in {time.time() - t0:.0f} s', flush=True)
    lst = os.path.join(work, 'list.txt')
    with open(lst, 'w', encoding='utf-8', newline='\n') as fh:
        for j in jobs:
            fh.write(f"file '{j[3].replace(os.sep, '/')}'\n")
    out = os.path.join(f.VID, f'astracad-spatial-{f.NAME}.mp4')
    cmd = [f.FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-i', audio,
           '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
           '-af', 'loudnorm=I=-14:TP=-1.0:LRA=9', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
           '-movflags', '+faststart', '-shortest', out]
    r = subprocess.run(cmd)
    print('wrote', out, r.returncode, 'total', f.TOTAL, flush=True)


if __name__ == '__main__':
    main()
