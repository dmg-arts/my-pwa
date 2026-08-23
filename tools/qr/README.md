# Regenerating the QR test vectors

`tests/unit/qr.test.mjs` pins the encoder against **python-qrcode**, an
independent implementation, by comparing a hash of the module matrix for ten
inputs at all eight masks.

The vectors are checked in, so the test suite needs nothing but Node. This
script is only for regenerating them.

```bash
python3 -m venv .venv && .venv/bin/pip install qrcode
.venv/bin/python tools/qr/reference.py /tmp/qr-reference.json
```

Then hash each matrix and paste the results into the `VECTORS` table.

**Be suspicious if a vector ever needs to change.** QR is ISO/IEC 18004, frozen
for decades. A changed vector means the encoder changed behaviour, and the
question is what broke — not what to update.

Masks are forced rather than auto-selected on both sides. Mask *selection*
legitimately differs between implementations, because the specification leaves
room over whether the format bits are present while scoring. That changes which
of eight equally valid codes you get, never whether it scans.
