# Performance profile

```bash
python3 serve.py --port 8123 --no-open &
node tools/bench/profile.mjs
```

Measures the two things this project actually needs to know:

1. **Does it work on a cadet's cheap phone?** Payload, cold start, and the heavy
   screens re-run under CPU throttling that stands in for a low-end Android.
2. **Does it stay usable as feedback accumulates?** Analysis reads every
   response across every form, so its cost is measured at rising volumes to see
   where the curve bends.

Absolute numbers are one machine's and mean little on their own. **The shape is
the point** — how cost grows with volume, and how much slack there is against
the budgets in `BUDGET`.

The compute benchmarks call the real analysis entry points on synthetic
answers, with storage deliberately excluded: that is the part which runs on the
phone in the reader's hand, and the part that grows with the detachment.

A run adds no state to the repo and needs no Google account.
