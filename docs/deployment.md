# Deploying the demo

قارئ runs entirely in the visitor's browser. Deploying it means putting static files on an HTTPS host: no server code, no functions, no database.

What gets deployed is `demo/dist/`, the output of `npm run build`:

| File | Size | Sent compressed (measured) |
| --- | --- | --- |
| `index.html`, `assets/index-*.js`, `assets/synth.worker-*.js` | ≈ 155 KB | smaller |
| `assets/ort-wasm-simd-threaded.asyncify-*.wasm` (onnxruntime's engine, CPU + GPU) | 28.7 MB | 6.7–8.3 MB |
| `male-sound.json`, `female-sound.json`, `index.json` | < 1 KB | — |
| `models/mixer128.onnx`, `models/vocos22.onnx` (the voice files; not in git) | tens of MB | barely shrinks |

Before you share the link, know what visitors will see:
- **It's the developer test page, not the reader.** It has a log, model URL boxes and a mode menu. The real `<qari-reader>` with read-along arrives in Q5.
- **The first visit is heavy:** the engine plus the voice files. After that the voice comes from the browser's own storage, and only the page reloads. On mobile data, suggest Wi-Fi the first time.

## What the host decides, and what it doesn't

**The GPU is not the host's job.** Accelerated mode runs on the visitor's own GPU, through their browser. Every host serves the same files; whether accelerated mode is offered depends only on the visitor's device and browser (the page probes it). No static host gives you a GPU, and none needs to.

What the host does decide:

| Topic | Why it matters for قارئ | What to do |
| --- | --- | --- |
| **HTTPS** | Without it, browsers turn off both the voice cache and accelerated mode (`localhost` is the only exception). | Every option below gives free HTTPS; force redirects from `http://`. |
| **Headers** (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`) | With both, default mode uses several CPU threads; without them, one thread. Everything still works, just slower on long texts. | Hosts that let you set headers: use the files in `deploy/`. A CDN in front of the site can drop them. |
| **Per-file size limit** | The engine is 28.7 MB, and the voice files are large too. | Shared hosting, VMs and GitHub Pages are fine. Cloudflare Pages (25 MiB) rejects the engine. |
| **`.wasm` content type** | The engine must be served as `application/wasm`. | Set in every `deploy/` config; most servers already do it. |
| **Compression** | gzip/zstd shrinks the 28.7 MB engine to about 7 MB on the wire. | Turned on in every `deploy/` config. Voice files barely compress; that's expected. |
| **Caching** | Hashed build files never change; the page and the voice configs must not be cached stale. | Set in every `deploy/` config: a year for hashed files, "always check" for `.html` / `.json`, a day for voice files. |
| **Subfolder** | The site may live at `/qari/` rather than the root. | Nothing to do: the build uses relative paths. |
| **Bandwidth** | Each first-time visitor downloads tens of MB. | Watch your plan's limit; GitHub Pages is the tightest. |

## Step 0 (every host): the voice files

The voice files are kept out of git (`voices/models/*.onnx` is ignored). Two ways to get them into a build:

- **By hand (local builds):** copy `mixer128.onnx` and `vocos22.onnx` into `voices/models/`, then run `npm run build`.
- **From a release (automatic deploys):** create a release of this repo tagged `models-v1` with both files attached under those exact names. `npm run fetch-models` downloads any missing file before the build. The deploy workflow does this for you; the repo must be public.

  ```sh
  gh release create models-v1 voices/models/mixer128.onnx voices/models/vocos22.onnx \
    --title "Voice model files v1" --notes "Model files for the demo. Licence type: non-commercial."
  ```

To change voice files later: make a new release (e.g. `models-v2`) with the same file names, bump `version` in each `voices/*.json` for the files that changed (the browser cache is keyed by URL + version), and set the repository variable `QARI_MODELS_TAG` to the new tag.

## Hostinger web hosting

Hostinger's web hosting runs LiteSpeed, which reads Apache's `.htaccess`. `deploy/apache/.htaccess` sets the headers, the `.wasm` type, compression and caching. (Tested on Apache here; LiteSpeed reads the same directives.)

### Choose where it lives

- **A subdomain**, e.g. `reader.example.com`: create it in hPanel; it gets its own folder.
- **A subfolder of your site**, e.g. `example.com/qari/`: a folder inside `public_html`.

Either way, use a folder that holds **only** قارئ: the automatic deploy mirrors the build into it and deletes anything else there.

### Turn on HTTPS

In hPanel, install the free SSL certificate for the domain and turn on "Force HTTPS".

### Option A: upload by hand (any plan, including Single)

1. Locally: put the voice files in `voices/models/`, run `npm run build`, then `cp deploy/apache/.htaccess demo/dist/`.
2. Zip the *contents* of `demo/dist/` (including the hidden `.htaccess`).
3. In hPanel's File Manager, upload the zip into the target folder and extract it there.

### Option B: deploy automatically on every push (Premium plan or higher)

SSH is available on Premium and higher plans, on port 65002. The `Deploy` workflow uploads with rsync over SSH.

1. **Make a key just for deploys** (no passphrase):
   `ssh-keygen -t ed25519 -N "" -C "qari-deploy" -f qari_deploy`
2. **Add the public key to Hostinger:** hPanel → Advanced → SSH Access → SSH Keys → add the contents of `qari_deploy.pub`. On the same page, note the IP, port and username.
3. **Pin the server's key:** `ssh-keyscan -p 65002 <IP>`. Copy the output.
4. **In GitHub**, go to *Settings → Secrets and variables → Actions*:
   - **Variables:**
     - `HOSTINGER_HOST` = the IP
     - `HOSTINGER_USER` = the username (e.g. `u123456789`)
     - `HOSTINGER_PATH` = the absolute folder path, e.g. `/home/u123456789/domains/example.com/public_html/qari`
     - `HOSTINGER_PORT` only if it isn't 65002
   - **Secrets:**
     - `HOSTINGER_SSH_KEY` = the contents of `qari_deploy` (the private key)
     - `HOSTINGER_KNOWN_HOSTS` = the `ssh-keyscan` output
5. **Push to `main`**, or run *Actions → Deploy → Run workflow*. CI runs first, then the build, then the upload.

The workflow only runs this job when `HOSTINGER_HOST` is set. It works for any server with SSH and rsync, not just Hostinger.

### If the headers don't show up

Check them with `curl -sI https://reader.example.com/ | grep -i cross-origin`. If they're missing:
- **Hostinger's CDN:** one user reports Hostinger support saying custom headers can't be applied while their CDN is on. Turn the CDN off for this site, or accept single-threaded default mode.
- **Hidden file not uploaded:** the File Manager hides files starting with a dot. Make sure `.htaccess` reached the folder.

## A regular VM (any VPS, including Hostinger VPS)

You run the web server yourself, so everything in the table above is under your control. Copy `demo/dist/` to `/var/www/qari`, then use one of:

- **Caddy (recommended, HTTPS is automatic):** `deploy/caddy/Caddyfile`. Replace the domain, put it in `/etc/caddy/Caddyfile` (or import it), then run `sudo systemctl reload caddy`.
- **Nginx:**
  1. Install `deploy/nginx/qari-headers.conf` as `/etc/nginx/snippets/qari-headers.conf`.
  2. Put `deploy/nginx/qari.conf` in `sites-available` and link it into `sites-enabled`.
  3. Run `sudo nginx -t && sudo systemctl reload nginx`.
  4. Add HTTPS with `sudo certbot --nginx -d <domain>`.
- **Apache:** use `deploy/apache/.htaccess` with `AllowOverride All`, plus `a2enmod headers deflate`.

For automatic deploys, the same `Deploy` workflow works. Set `HOSTINGER_HOST` / `USER` / `PATH` to the VM, and `HOSTINGER_PORT=22`. Give the deploy user write access to `/var/www/qari` only.

## GitHub Pages (optional)

1. Make the repo public and create the `models-v1` release (Step 0).
2. *Settings → Pages → Build and deployment → Source: GitHub Actions*.
3. Set the repository variable `QARI_DEPLOY_PAGES` = `true`, then push.

The site appears at `https://<you>.github.io/<repo>/`.

Limits:
- **No custom headers,** so default mode is single-threaded.
- **Size:** published sites must be under 1 GB.
- **Bandwidth:** a soft cap of 100 GB a month. At tens of MB per new visitor, that's on the order of a thousand new visitors a month.

## Other hosts

- **Netlify:**
  - Build command: `npm run fetch-models && npm run build`. Publish directory: `demo/dist`.
  - Environment variable `QARI_MODELS_BASE_URL=https://github.com/<user>/<repo>/releases/download/models-v1/`.
  - Headers in `netlify.toml` (`[[headers]] for = "/*"` with the two `Cross-Origin-*` values).
  - Your earlier research found files over 10 MB poorly supported there, so test before sharing.
- **Cloudflare Pages / Workers static assets: not possible today.** The limit is 25 MiB per file, and the engine is 28.7 MB. Q2's plan to load the 14.8 MB CPU-only engine in default mode, plus voice files in R2 with CORS, would make it fit, without accelerated mode.

## After each deploy, check

1. The page loads over HTTPS. The top line shows whether accelerated mode is available on that device, and "Cross-origin isolated: true" on hosts with the headers.
2. **Prepare voice** downloads with real MB progress and ends with "Ready · Male sound · default mode".
3. **Read** speaks. Switching to Female sound doesn't download again.
4. Reloading and preparing again says "From cache".
5. On a device with a real GPU, accelerated mode works. On one without, it shows the plain "doesn't work on this device" message and stays in default mode.

## What was tested, and how

- **Builds:** made with the tiny test models standing in for the voice files.
- **Servers:** the same build served by Apache (with `deploy/apache/.htaccess`, from a `/qari/` subfolder), Nginx (`deploy/nginx/`) and Caddy (`deploy/caddy/Caddyfile`).
- **Headers, all three servers:** the two `Cross-Origin-*` headers, `application/wasm`, compression (engine sent as 7.2 MB, 8.3 MB and 6.7 MB), and the three caching rules.
- **Chrome, all three servers:** cross-origin isolation reported as `true`; prepare and read worked; no failed requests.
- **Hostinger upload step:** the workflow's commands run against a local SSH server on port 65002. Files upload. A stale file is removed. `.well-known` and a neighbouring site are left alone. A pinned server key works, a wrong one is refused, and a relative path is rejected.
- **Not tested here:**
  - LiteSpeed itself (Apache stood in).
  - Hostinger's CDN.
  - The workflow running on GitHub.
  - Real voice files.
