"""Reference QR matrices for cross-checking js/qr.js. Dev only."""
import json, sys
import qrcode
from qrcode.constants import ERROR_CORRECT_M
from qrcode.util import QRData, MODE_8BIT_BYTE

CASES = [
    "A", "hello world", "https://example.org/",
    "https://dmg-arts.github.io/my-pwa/#/join?c=724504040762-rrq3q51dip6rib0g8lof5pq5r6da2g03&f=1Te9Pc7JgOSUluq3tc0FCK4IqbKm1MTIM&n=Det+025",
    "Det 025 — Wilkes & Misericordia", "x" * 100, "y" * 300, "z" * 600,
    "0123456789" * 12, "~!@#$%^&*()_+`-={}|[]\\:\";'<>?,./",
]

out = []
for text in CASES:
    for mask in range(8):
        qr = qrcode.QRCode(error_correction=ERROR_CORRECT_M, border=0, mask_pattern=mask)
        qr.add_data(QRData(text.encode("utf-8"), mode=MODE_8BIT_BYTE, check_data=False))
        qr.make(fit=True)
        out.append({
            "text": text, "mask": mask, "version": qr.version,
            "size": len(qr.get_matrix()),
            "modules": [[bool(v) for v in row] for row in qr.get_matrix()],
        })

json.dump(out, open(sys.argv[1], "w"))
print(f"wrote {len(out)} reference matrices ({len(CASES)} inputs x 8 masks)")
