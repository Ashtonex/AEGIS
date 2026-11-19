"""Pytest plugin: refuse every non-loopback network connection and log the attempt."""
import os, socket, ipaddress
_LOG = os.environ.get("NETGUARD_LOG", "netguard.log")
_orig_connect = socket.socket.connect
_orig_connect_ex = socket.socket.connect_ex
_orig_gai = socket.getaddrinfo
_LOCAL_NAMES = {"localhost", "127.0.0.1", "::1", ""}

def _record(what):
    try:
        with open(_LOG, "a", encoding="utf-8") as fh:
            fh.write(what + "\n")
    except Exception:
        pass

def _is_local(host):
    if host is None:
        return True
    host = host.decode() if isinstance(host, bytes) else str(host)
    if host in _LOCAL_NAMES:
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False

def _guard_addr(address):
    if isinstance(address, tuple) and address:
        if not _is_local(address[0]):
            _record(f"BLOCKED connect {address[0]}:{address[1] if len(address)>1 else ''}")
            raise ConnectionRefusedError(f"netguard: non-loopback connect refused ({address[0]})")

def connect(self, address):
    _guard_addr(address)
    return _orig_connect(self, address)

def connect_ex(self, address):
    _guard_addr(address)
    return _orig_connect_ex(self, address)

def getaddrinfo(host, *a, **k):
    if not _is_local(host):
        _record(f"BLOCKED dns {host}")
        raise socket.gaierror(socket.EAI_NONAME, f"netguard: DNS refused for {host}")
    return _orig_gai(host, *a, **k)

socket.socket.connect = connect
socket.socket.connect_ex = connect_ex
socket.getaddrinfo = getaddrinfo
