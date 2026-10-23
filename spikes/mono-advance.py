# Spike: the real advance width of a monospace font, in em, straight from its hmtx table.
#   python3 spikes/mono-advance.py <font file>...
import struct, sys
from collections import Counter

for p in sys.argv[1:]:
    d = open(p, 'rb').read()
    off = struct.unpack('>I', d[12:16])[0] if d[:4] == b'ttcf' else 0
    n = struct.unpack('>H', d[off + 4:off + 6])[0]
    t = {}
    for i in range(n):
        tag, _, o, _l = struct.unpack('>4sIII', d[off + 12 + 16 * i:off + 28 + 16 * i])
        t[tag] = o
    upm = struct.unpack('>H', d[t[b'head'] + 18:t[b'head'] + 20])[0]
    nh = struct.unpack('>H', d[t[b'hhea'] + 34:t[b'hhea'] + 36])[0]
    adv = [struct.unpack('>H', d[t[b'hmtx'] + 4 * i:t[b'hmtx'] + 4 * i + 2])[0] for i in range(min(nh, 200))]
    a = Counter(x for x in adv if x).most_common(1)[0][0]
    print(f'{p.split("/")[-1]:44} upm={upm} advance={a} -> {a / upm:.4f}em = {12 * a / upm:.3f}px at 12px')
