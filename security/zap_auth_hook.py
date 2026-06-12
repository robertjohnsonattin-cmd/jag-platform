"""
ZAP hook — injects JWT Bearer token into every outgoing request.

Loaded by zap-baseline.sh and zap-full-scan.sh via --hook flag.
Token is read from the ZAP_TOKEN env var set by the calling script.
"""
import os


def zap_started(zap, target):
    token = os.environ.get('ZAP_TOKEN', '')
    if not token:
        print('[zap-auth-hook] WARNING: ZAP_TOKEN not set — scanning unauthenticated')
    else:
        zap.replacer.add_rule(
            description='JAG-Bearer-Token',
            enabled=True,
            matchtype='REQ_HEADER',
            matchregex=False,
            matchstring='Authorization',
            replacement='Bearer ' + token,
        )
        print('[zap-auth-hook] JWT injected into all outgoing requests.')

    # Bypass Cloudflare CDN cache — scan the origin server, not cached responses.
    # Without this, headers added after the last cache prime are invisible to ZAP.
    zap.replacer.add_rule(
        description='JAG-Cache-Bypass',
        enabled=True,
        matchtype='REQ_HEADER',
        matchregex=False,
        matchstring='Cache-Control',
        replacement='no-cache, no-store',
    )
    print('[zap-auth-hook] Cache-Control: no-cache injected (Cloudflare bypass).')
