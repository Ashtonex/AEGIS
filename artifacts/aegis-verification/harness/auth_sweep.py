"""HTTP boundary sweep: every route that declares an auth dependency is called
(a) with no Authorization header, (b) with a non-JWT bearer, (c) with an
alg=none token claiming SUPERADMIN. Expect 401/403 (never 2xx, never 5xx).
Redis lookups are short-circuited to fail fast (as on a Redis outage)."""
import json, re, sys, time, base64
import netguard  # noqa
sys.path.insert(0, ".")
import core.cache as cache
for name in ("incr_with_ttl_sync", "get_int_sync", "cache_get_json_sync", "cache_set_json_sync"):
    setattr(cache, name, lambda *a, **k: None)
import core.security as sec
for name in ("incr_with_ttl_sync", "get_int_sync", "cache_get_json_sync", "cache_set_json_sync"):
    setattr(sec, name, lambda *a, **k: None)
sec.AUTH_FAILURES_PER_MINUTE = 10**9
import main
from fastapi.testclient import TestClient

rows = json.load(open(sys.argv[1]))
client = TestClient(main.app, base_url="http://localhost", raise_server_exceptions=False)
Z = "00000000-0000-0000-0000-000000000000"
def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
none_tok = b64({"alg": "none", "typ": "JWT"}) + "." + b64({"sub": Z, "exp": int(time.time()) + 3600,
            "app_metadata": {"role": "SUPERADMIN", "org_id": Z}}) + "."
variants = {"anon": {}, "garbage": {"Authorization": "Bearer not-a-jwt"}, "alg_none": {"Authorization": "Bearer " + none_tok}}
out = {"tested": 0, "bad": [], "codes": {}}
t0 = time.time()
for r in rows:
    if not r["auth_dep"] or r["kind"] != "http":
        continue
    path = re.sub(r"\{[^}]+\}", Z, r["path"])
    for vname, hdrs in variants.items():
        resp = client.request(r["method"], path, headers=hdrs, json={} if r["method"] in ("POST", "PUT", "PATCH") else None)
        key = f"{vname}:{resp.status_code}"
        out["codes"][key] = out["codes"].get(key, 0) + 1
        if resp.status_code not in (401, 403):
            out["bad"].append({"variant": vname, "method": r["method"], "path": r["path"], "status": resp.status_code, "body": resp.text[:200]})
    out["tested"] += 1
out["seconds"] = round(time.time() - t0, 1)
json.dump(out, open(sys.argv[2], "w"), indent=1)
print("routes", out["tested"], "codes", out["codes"], "unexpected", len(out["bad"]), "secs", out["seconds"])
