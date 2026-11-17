'''Validate delivered GIFs and write a compact local QA report.'''
from hashlib import sha256
from pathlib import Path
import json
from PIL import Image, ImageChops

root = Path(__file__).resolve().parents[2]
output = root / 'output' / 'gifs'
report = []
for source in sorted(output.glob('*.gif')):
    with Image.open(source) as animation:
        size, loop = list(animation.size), animation.info.get('loop')
        duration, previous, changes = 0, None, 0
        for index in range(animation.n_frames):
            animation.seek(index)
            duration += animation.info.get('duration', 0)
            frame = animation.convert('RGB').resize((160, 113))
            if previous is not None and ImageChops.difference(frame, previous).getbbox():
                changes += 1
            previous = frame
        assert animation.n_frames > 20 and loop == 0 and changes > 20, source
        assert size == ([960, 675] if 'compact' in source.name else [1280, 900]), source
        report.append(dict(file=source.name, size=size, frames=animation.n_frames,
                           durationSeconds=round(duration / 1000, 2), loop=loop,
                           changedTransitions=changes, bytes=source.stat().st_size,
                           sha256=sha256(source.read_bytes()).hexdigest()))
assert len(report) == 6, 'Expected five animations and one compact overview'
(output / 'qa-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + chr(10))
print(json.dumps(report, ensure_ascii=False, indent=2))
