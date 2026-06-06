# JAG Holdings — Custom Caddy image with Cloudflare DNS-01 plugin
#
# The standard caddy:2 image does not include the Cloudflare DNS provider.
# We use xcaddy to compile a custom binary with it baked in.
# This is the standard Caddy approach for non-bundled plugins.

FROM caddy:2-builder AS builder

RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

FROM caddy:2

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
