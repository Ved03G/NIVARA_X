"""
Latency benchmark for PrivacyShield.
Measures per-step timings and outputs a summary.

Usage:
    python benchmarks/latency.py
"""
import time
import json
import statistics
import httpx

SERVER = "http://localhost:8000"

SAMPLE_REQUEST = {
    "task": "Fill in the email and submit the form",
    "elements": [
        {"id": "el_0001", "role": "textbox", "type": "email", "text": "[EMAIL_1]", "disabled": False, "visible": True},
        {"id": "el_0002", "role": "button", "text": "Submit", "disabled": False, "visible": True},
    ],
    "redaction_contract": [
        {
            "token": "[EMAIL_1]",
            "category": "EMAIL",
            "element_id": "el_0001",
            "server_may": ["identify", "reason", "reference"],
            "server_may_not": ["recover_value"],
        }
    ],
    "page_url": "https://example.com",
    "timestamp": int(time.time() * 1000),
}


def run_benchmark(n: int = 5) -> dict:
    latencies = []
    for i in range(n):
        start = time.perf_counter()
        resp = httpx.post(f"{SERVER}/api/agent/context", json=SAMPLE_REQUEST, timeout=60)
        elapsed = (time.perf_counter() - start) * 1000
        resp.raise_for_status()
        latencies.append(elapsed)
        print(f"  Run {i+1}: {elapsed:.0f}ms | actions={len(resp.json().get('actions', []))}")

    return {
        "runs": n,
        "mean_ms": statistics.mean(latencies),
        "median_ms": statistics.median(latencies),
        "min_ms": min(latencies),
        "max_ms": max(latencies),
        "stdev_ms": statistics.stdev(latencies) if n > 1 else 0,
    }


if __name__ == "__main__":
    print(f"PrivacyShield Latency Benchmark")
    print(f"Target: {SERVER}")
    print(f"{'─'*40}")

    # Health check
    try:
        h = httpx.get(f"{SERVER}/health", timeout=5)
        h.raise_for_status()
        print(f"Server: OK ({h.json()})")
    except Exception as e:
        print(f"ERROR: Server not reachable — {e}")
        raise SystemExit(1)

    print(f"{'─'*40}")
    print("Running 5 benchmark requests...")
    results = run_benchmark(5)
    print(f"{'─'*40}")
    print(json.dumps(results, indent=2))
