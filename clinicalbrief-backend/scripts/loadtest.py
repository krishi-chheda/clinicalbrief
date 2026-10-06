"""Ramped load test against a running ClinicalBrief API (read-only requests only).

    py -3.12 scripts/loadtest.py https://clinicalbrief.onrender.com
    py -3.12 scripts/loadtest.py https://clinicalbrief.onrender.com --stages 1,10,25 --seconds 10

Without a token it measures the two paths that never touch the database: GET / and the auth gate (a request with an
invalid token, rejected with 401). To include a real database read, put your own access token in the environment
(never in a file or a chat): set CLINICALBRIEF_TOKEN and it adds GET /api/v1/patients?limit=20. Read-only throughout.
"""
import argparse
import asyncio
import os
import time

import httpx


def pct(values, p):
    """Nearest-rank percentile."""
    if not values:
        return 0.0
    s = sorted(values)
    return s[max(0, min(len(s) - 1, round(p / 100 * len(s) + 0.5) - 1))]


async def stage(client, targets, users, seconds):
    lat, codes, errors = {n: [] for n, *_ in targets}, {}, 0
    deadline = time.perf_counter() + seconds

    async def user(i):
        nonlocal errors
        k = i
        while time.perf_counter() < deadline:
            name, path, headers = targets[k % len(targets)]
            k += 1
            t0 = time.perf_counter()
            try:
                r = await client.get(path, headers=headers)
                codes[r.status_code] = codes.get(r.status_code, 0) + 1
                lat[name].append((time.perf_counter() - t0) * 1000)
            except httpx.HTTPError:
                errors += 1

    t0 = time.perf_counter()
    await asyncio.gather(*(user(i) for i in range(users)))
    return lat, codes, errors, time.perf_counter() - t0


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base_url")
    ap.add_argument("--stages", default="1,5,10,25,50", help="concurrent users per stage")
    ap.add_argument("--seconds", type=float, default=15)
    args = ap.parse_args()

    targets = [("health  GET /", "/", {}),
               ("authgate 401", "/api/v1/patients", {"Authorization": "Bearer invalid.token.value"})]
    token = os.environ.get("CLINICALBRIEF_TOKEN")
    if token:
        targets.append(("patients (db)", "/api/v1/patients?limit=20", {"Authorization": f"Bearer {token}"}))

    limits = httpx.Limits(max_connections=200, max_keepalive_connections=200)
    async with httpx.AsyncClient(base_url=args.base_url.rstrip("/"), timeout=30, limits=limits) as client:
        t0 = time.perf_counter()
        r = await client.get("/", timeout=120)  # free plan may be asleep: wake it before measuring
        print(f"warm-up: {r.status_code} in {time.perf_counter() - t0:.1f}s\n")
        print(f"{'users':>5}  {'endpoint':<14} {'reqs':>6} {'p50 ms':>7} {'p95 ms':>7} {'max ms':>7}   {'total req/s':>11}  status codes")
        for users in map(int, args.stages.split(",")):
            lat, codes, errors, took = await stage(client, targets, users, args.seconds)
            total = sum(len(v) for v in lat.values()) + errors
            for j, (name, v) in enumerate(lat.items()):
                head = f"{users:>5}" if j == 0 else " " * 5
                tail = f"   {total / took:>11.1f}  {dict(sorted(codes.items()))}" + (f" errors={errors}" if errors else "") if j == 0 else ""
                print(f"{head}  {name:<14} {len(v):>6} {pct(v, 50):>7.0f} {pct(v, 95):>7.0f} {max(v, default=0):>7.0f}{tail}")


if __name__ == "__main__":
    asyncio.run(main())
