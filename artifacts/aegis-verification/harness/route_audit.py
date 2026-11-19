"""Static + HTTP audit of every mounted route's authentication boundary.

Runs in-process (TestClient). Network guarded by netguard (imported first).
Outputs JSON lines to stdout-specified file.
"""
import json, sys, time, re
import netguard  # noqa: F401  block non-loopback network
import jwt
from fastapi.routing import APIRoute, APIWebSocketRoute
from fastapi.dependencies.models import Dependant

sys.path.insert(0, ".")
import main as app_main  # imperium-api/main.py
from core import security

app = app_main.app if hasattr(app_main, "app") else app_main.create_app()
AUTH_CALLS = {security.verify_token, security.get_current_user, security.verify_jwt}

def walk(dep: Dependant, seen=None):
    seen = seen or set()
    for sub in dep.dependencies:
        if sub.call is not None:
            yield sub.call
        yield from walk(sub, seen)

def route_auth(route):
    calls = list(walk(route.dependant))
    names = {getattr(c, "__qualname__", repr(c)) for c in calls}
    has = any(c in AUTH_CALLS for c in calls)
    return has, sorted(names)

from fastapi.routing import _IncludedRouter
from fastapi.dependencies.utils import get_dependant, get_parameterless_sub_dependant

def flatten(routes, depth=0):
    for r in routes:
        if isinstance(r, _IncludedRouter):
            for c in r.effective_candidates():
                if isinstance(c, _IncludedRouter):
                    yield from flatten([c], depth+1)
                else:
                    yield c
        else:
            yield r

class Eff:
    pass

def ctx_dependant(c):
    d = getattr(c, "dependant", None) or getattr(c.original_route, "dependant", None)
    if d is None:
        d = get_dependant(path=c.path, call=c.endpoint)
        for dep in reversed(c.dependencies or []):
            d.dependencies.insert(0, get_parameterless_sub_dependant(depends=dep, path=c.path))
    return d

rows = []
for r in flatten(app.routes):
    if type(r).__name__ == "_EffectiveRouteContext":
        dep = ctx_dependant(r)
        calls = list(walk(dep))
        has = any(c in AUTH_CALLS for c in calls)
        names = sorted({getattr(c, "__qualname__", repr(c)) for c in calls})
        kind = "ws" if "WebSocket" in type(r.original_route).__name__ else "http"
        for m in sorted((r.methods or {"WS"}) - {"HEAD", "OPTIONS"}):
            rows.append({"kind": kind, "method": m, "path": r.path, "auth_dep": has,
                         "endpoint": (lambda e: f"{e.__module__}.{e.__name__}")(r.endpoint or r.original_route.endpoint),
                         "deps": [n for n in names if any(k in n.lower() for k in ("permission","user","token","verify","checker","require"))]})
        continue
    if isinstance(r, APIRoute):
        has, names = route_auth(r)
        for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
            rows.append({"kind": "http", "method": m, "path": r.path, "auth_dep": has,
                         "endpoint": f"{r.endpoint.__module__}.{r.endpoint.__name__}",
                         "deps": [n for n in names if "permission" in n or "user" in n.lower() or "token" in n.lower() or "verify" in n.lower()]})
    elif isinstance(r, APIWebSocketRoute):
        has, names = route_auth(r)
        rows.append({"kind": "ws", "method": "WS", "path": r.path, "auth_dep": has,
                     "endpoint": f"{r.endpoint.__module__}.{r.endpoint.__name__}", "deps": []})

json.dump(rows, open(sys.argv[1], "w"), indent=1)
print("routes", len(rows), "no_auth_dep", sum(1 for x in rows if not x["auth_dep"]))
