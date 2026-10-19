# Deploying the phone page (app.lynshen.org)

The phone page is this repo's build, served as static files from
`/srv/lynshen-app/releases/<UTC timestamp>` on the gateway host, with
`/srv/lynshen-app/current` pointing at the live release. The relay is under
`/relay/v1/*` on the same origin.

## Build

1. Build from the tagged commit: `pnpm build`.
2. Copy `build/` to a staging directory, and write the commit to
   `REVISION` in it.
3. Run `node scripts/phone-csp.mjs <staging dir>`.
   - It adds a Content-Security-Policy `<meta>` tag at the top of
     `index.html`. The tag allows scripts from this origin plus the SHA-256
     of each inline script the build has (the boot script and SvelteKit's
     start script).
   - It writes the same policy to `<staging dir>/CSP`.
   - The desktop app is not affected: it uses `build/` as is, with the CSP
     in `src-tauri/tauri.conf.json`.
4. Run `node scripts/phone-csp-check.mjs <staging dir>`. It loads the page
   in Chromium and WebKit and checks two things: the page renders with no
   CSP violation, and an injected inline script does not run.
5. Pack the staging directory with
   `COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs`.

## Install

1. Extract the archive as root to `releases/<timestamp>`.
2. Switch `current` atomically: `ln -sfn` to a temporary name, then
   `mv -T` over `current`.
3. Keep the previous release for rollback.
4. Check that `/REVISION` returns the new commit.
5. Check that `/remote` has the CSP tag:
   `curl -s https://app.lynshen.org/remote | grep -c content-security-policy`
   returns `1`.

## Caddy (one-time)

The `<meta>` policy cannot set `frame-ancestors`, and HSTS must come from
the server. The `app.lynshen.org` block adds these response headers. They
do not depend on the build:

```
header {
    Strict-Transport-Security "max-age=31536000"
    Content-Security-Policy "frame-ancestors 'none'; object-src 'none'; base-uri 'none'"
    X-Frame-Options "DENY"
    Referrer-Policy "no-referrer"
    Permissions-Policy "camera=(self), microphone=(), geolocation=()"
    X-Content-Type-Options "nosniff"
}
```

- A browser enforces both policies, the header one and the `<meta>` one,
  so the header one only adds what the `<meta>` tag cannot say.
- `camera=(self)` keeps the QR scanner working.
- Start HSTS without `includeSubDomains` and `preload`: the other
  lynshen.org hosts are not all HTTPS-only yet.
