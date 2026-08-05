"""Dev-machine networking workarounds.

Some local Windows dev environments have no working IPv6 route, so any
outbound call whose DNS resolution returns an AAAA record first (e.g. Supabase's
dual-stack REST/Auth host) hangs or fails with socket.gaierror instead of
falling back to IPv4. See also the DATABASE_URL Supavisor pooler note in
core/config.py for the same class of issue on the Postgres connection.
"""

import socket

_original_getaddrinfo = socket.getaddrinfo


def force_ipv4_dns() -> None:
    """Monkeypatch socket.getaddrinfo to only return IPv4 results.

    Must only be called for local development - production runs on hosts
    with working IPv6 (or don't need this at all), and this changes global
    process behavior for every outbound connection.
    """
    def _ipv4_only_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        return _original_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)

    socket.getaddrinfo = _ipv4_only_getaddrinfo
