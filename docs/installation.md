# Installing HessuTalks

[Suomi](asennus.md) · **English**

HessuTalks is a PHP application that is installed on a web server in a directory of its own. It needs no
database server (the database is an SQLite file), no background processes and no scheduled jobs. This guide
is generic: it works on shared web hosting, on your own virtual server and in a container, as long as the
requirements below are met.

## Overview

The application consists of three parts:

| Part | Contents | Reachable from the web | PHP writes |
|---|---|---|---|
| Public directory | `index.php`, `.htaccess`, `assets/`, `live/` | yes | only `live/` |
| Application code `app/` | `src/`, `templates/`, `migrations/`, `vendor/`, `bin/init.php` | **no** | no |
| Data directory | `config.php`, `hessutalks.sqlite`, `sessions/` | **no, outside the webroot** | yes |

```
<webroot>/hessutalks/          public directory = https://example.com/hessutalks
    index.php                  front controller: every request goes here
    .htaccess                  Apache rules (other servers: see Web server configuration)
    assets/                    CSS, JavaScript, browser libraries
    live/                      participant state files, served as static files
    app/                       application code, direct access denied
<data directory>/              e.g. ~/hessutalks-data, never under the webroot
    config.php                 settings and secrets (created by bin/init.php)
    hessutalks.sqlite          database (created and migrated automatically)
    sessions/                  administrator sessions
```

A deploy replaces only the public directory and the `app/` folder. It never touches the data directory, so
the application can be updated without losing settings or lectures.

The public directory's name and location are free. It can be at the domain root (`https://example.com/`)
or in a subdirectory (`https://example.com/hessutalks`). The path is set in the configuration (`--base`).

### How the application finds its code and configuration

`index.php` looks for the application code and the configuration file in this order:

1. **Application code:** the environment variable `HESSUTALKS_APP_ROOT`, otherwise the `app/` folder next to `index.php`.
2. **Configuration:** the environment variable `HESSUTALKS_CONFIG`, otherwise `hessutalks-data/config.php`
   in the home directory of the user running PHP, otherwise `hessutalks-data/config.php` in the parent
   directories of the public directory (at most five levels up).

On shared hosting the defaults usually work as they are. On your own server, always set
`HESSUTALKS_CONFIG` yourself. For example, the home directory of the `www-data` user may be under the
webroot, and the default location would then be readable from the web.

If the configuration file or the application code is not found, the application responds with `503`.

## Requirements

- **PHP 8.4** or newer with the extensions `sodium`, `pdo_sqlite`, `mbstring`, `intl` and `openssl`.
  `posix` is optional (home directory detection).
- **HTTPS.** Passkeys (WebAuthn) and the `__Host-` session cookie only work over a secure connection.
  In production, `bin/init.php` accepts only an `https://` origin.
- **A web server** that can route requests to `index.php`, deny access to the application code and add
  security headers to static files. Apache rules ship with the package. For other servers you write the
  rules yourself (see below).
- **A command line on the server** to create the configuration file. Without one, the file can be created on
  your own machine and uploaded.
- To build the package: PHP, [Composer](https://getcomposer.org/) and this repository. Composer is not needed on the server.

## 1. Building the package

Build the release package in the repository root the same way CI does (`.github/workflows/ci.yml`):

```sh
composer install --no-dev --no-interaction --optimize-autoloader --classmap-authoritative
scripts/verify-vendor.sh                    # SHA-256 check of the browser libraries
mkdir -p build/app/bin
cp -r public/. build/                       # public directory, including the .htaccess files
cp -r src templates migrations vendor build/app/
cp bin/init.php build/app/bin/
git rev-parse --short HEAD > build/app/VERSION
printf 'Require all denied\n' > build/app/.htaccess
composer install                            # restore development dependencies on your machine
```

The contents of `build/` are a complete public directory. They contain no configuration, database or git data.

## 2. Transferring the files

Copy the contents of `build/` to the public directory on the server in any way you like: SFTP, FTPS, rsync,
a container image or a build run on the server. Good practice:

- Give the deploy account access to the public directory only. A leaked account then cannot reach the
  data directory or the rest of the site.
- Never deploy the data directory or `config.php`.
- The `live/` folder must be writable by the PHP process, and the web server must be able to read its files.
  Do not empty it during a lecture: participants read the lecture state from there.

## 3. Web server configuration

The application adds security headers (CSP, HSTS etc.) to every PHP response itself. The web server is responsible for:

1. **HTTPS:** redirect `http://` requests to `https://`.
2. **Front controller:** a request that does not match an existing file is routed to `index.php` so that the
   original path is kept in `REQUEST_URI`.
3. **Application code:** `app/` is not reachable from the web (403 or 404). Alternatively, place the code outside
   the webroot and set `HESSUTALKS_APP_ROOT`.
4. **Only `index.php` is executed as PHP.** Other `.php` files are not reachable.
5. **Hidden and source files are blocked:** names starting with `.` and the extensions `.lock`, `.md`, `.sql`,
   `.sqlite`, `.ini`, `.log`, `.sh` and `.dist`. Directory listing off.
6. **`live/`:** only names of the form 32 hex characters + `.json` are served, as static files
   (`application/json`, `Cache-Control: no-store`). A missing file is a static 404 and is not routed to PHP.
   This keeps the participants' once-per-second state requests away from PHP.
7. **Security headers on static files:** the same as in `public/.htaccess`
   (`X-Content-Type-Options`, `Content-Security-Policy`, `Cross-Origin-*`, `Strict-Transport-Security` etc.).

### Apache

The `.htaccess` files in the package implement the rules. They require the modules `mod_rewrite` and `mod_headers`
and that `.htaccess` files are allowed (`AllowOverride All`, because the file's `ServerSignature` is not accepted
with a narrower setting). On shared hosting these are usually in place. On your own server, check the setting
in the virtual host configuration and set the configuration path in the same place (not in `.htaccess`,
which a deploy overwrites):

```apache
<Directory /var/www/example.com/hessutalks>
    AllowOverride All
    SetEnv HESSUTALKS_CONFIG /srv/hessutalks-data/config.php
</Directory>
```

### Nginx and PHP-FPM

Nginx does not read `.htaccess` files, so the rules go into the server configuration. The example below assumes
the application lives at `/hessutalks`. Adjust the paths and the PHP-FPM socket and verify the result with the
commands in [6. Verification](#6-verification). The example is not run in the project's CI.

```nginx
# Repeated headers in a file of their own, e.g. /etc/nginx/snippets/hessutalks-headers.conf:
#   add_header X-Content-Type-Options "nosniff" always;
#   add_header Referrer-Policy "no-referrer" always;
#   add_header X-Frame-Options "DENY" always;
#   add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
#   add_header Cross-Origin-Resource-Policy "same-origin" always;
#   add_header Cross-Origin-Opener-Policy "same-origin" always;
#   add_header Cross-Origin-Embedder-Policy "require-corp" always;
#   add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
#   add_header Content-Security-Policy "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" always;

server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name example.com;
    root /var/www/example.com;
    # ssl_certificate and ssl_certificate_key
    server_tokens off;

    location = /hessutalks { return 301 /hessutalks/; }

    location ^~ /hessutalks/ {
        autoindex off;

        location ^~ /hessutalks/app/ { return 404; }
        location ~ /\. { return 404; }
        location ~ \.(lock|md|sql|sqlite|ini|log|sh|dist)$ { return 404; }

        location ^~ /hessutalks/live/ {
            location ~ ^/hessutalks/live/[0-9a-f]{32}\.json$ {
                default_type application/json;
                include snippets/hessutalks-headers.conf;
                add_header Cache-Control "no-store" always;
                try_files $uri =404;
            }
            return 404;
        }

        location ^~ /hessutalks/assets/ {
            include snippets/hessutalks-headers.conf;
            add_header Cache-Control "public, max-age=604800, immutable" always;
            try_files $uri =404;
        }

        location = /hessutalks/index.php {
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $document_root/hessutalks/index.php;
            fastcgi_param HESSUTALKS_CONFIG /srv/hessutalks-data/config.php;
            fastcgi_pass unix:/run/php/php8.4-fpm.sock;
        }
        location ~ \.php$ { return 404; }

        try_files $uri /hessutalks/index.php$is_args$args;
    }
}
```

`HESSUTALKS_CONFIG` can also be set in the PHP-FPM pool configuration: `env[HESSUTALKS_CONFIG] = /srv/hessutalks-data/config.php`.

### Other servers and reverse proxies

On other servers (e.g. Caddy, IIS), implement the seven rules listed above in the server's own way.
PHP's built-in server (`php -S`) is for development only.

If TLS terminates at a reverse proxy or load balancer:

- `.htaccess` also recognises HTTPS from the header `X-Forwarded-Proto: https`.
- Pass the participant's address to the application (`REMOTE_ADDR`), e.g. with Apache's `mod_remoteip` or nginx's
  `real_ip` module. Otherwise every request appears to come from the same address and shares the same
  per-address rate limit. The application does not store the address: for rate limiting it computes a
  keyed hash, which is deleted after the time window.

### Server logs

The application does not store IP addresses, but the web server's access log usually does. Limit log
retention (at most 7 days, see [SECURITY.en.md](../SECURITY.en.md)) or turn off the access log for the
application's path. On shared hosting, retention is usually set in the control panel, for example in the
log archiving settings.

## 4. Configuration file

Once the package is on the server, create the configuration file on the server's command line:

```sh
php <public directory>/app/bin/init.php --origin=https://example.com --base=/hessutalks --data=/srv/hessutalks-data
```

| Option | Meaning |
|---|---|
| `--origin` | Public origin of the application without a path, `https://` required |
| `--base` | Path where the application is served, e.g. `/hessutalks`. At the domain root `--base=/` |
| `--data` | Data directory. Default `~/hessutalks-data` (home directory of the user running the command) |
| `--out` | Path of the configuration file. Default `<data>/config.php` |
| `--rp-id` | WebAuthn identifier. Default: the host name of the origin |
| `--name` | Display name of the administrator |
| `--force` | Replace an existing file (a new `app_secret` invalidates open forms) |

The command creates the data directory (permissions `700`) and `config.php` (`600`). It prints a **setup token**
used to register the first passkey. The token is shown only once.

- Run the command **as the user that runs PHP**, or hand the data directory over to that user
  (`chown -R`). PHP must be able to write the database and sessions, and other users must not see them.
- If the data directory is not in a default location (see [How the application finds its code and configuration](#how-the-application-finds-its-code-and-configuration)),
  set `HESSUTALKS_CONFIG` in the web server or PHP-FPM configuration.
- **If the server has no command line:** run the command on your own machine in the repository root and give the server path:
  `php bin/init.php --origin=… --base=… --data=/home/USER/hessutalks-data --out=config.php`. Then upload
  `config.php` to the data directory on the server (directory `700`, file `600`). The database and sessions are
  created on the first request.

## 5. First-time setup

1. Open the admin view at the address printed by `init.php`. Enter the setup token and create a passkey.
2. Create the encryption keys with a passphrase. Store the passphrase in a password manager and keep the
   downloaded backup file safe. Messages cannot be opened without one or the other.
3. On the *Settings* page, add a second passkey, for example on your phone.
4. Sign in once with each passkey and unlock the key with the passphrase. The application stores an encrypted
   copy per passkey, after which the passkey alone also unlocks the messages. This requires PRF support in
   the browser (Safari 18 / macOS 15 / iOS 18, Chrome, Edge). Otherwise the passphrase is asked every time.

## 6. Verification

Verify the installation with these commands (replace the address with yours):

```sh
URL=https://example.com/hessutalks
curl -s "$URL/healthz"                                   # {"ok":true,…}; 503 = configuration not found
curl -s -o /dev/null -w '%{http_code}\n' "$URL/app/bin/init.php"     # 403 or 404
curl -s -o /dev/null -w '%{http_code}\n' "$URL/app/VERSION"          # 403 or 404
curl -s -o /dev/null -w '%{http_code}\n' "$URL/live/"                # 403 or 404
curl -s -o /dev/null -w '%{http_code}\n' "${URL/https:/http:}/"      # 301 (redirect to HTTPS)
curl -sI "$URL/assets/css/app.css" | grep -i -E 'content-security|nosniff|strict-transport'
curl -sI "$URL/" | grep -i 'content-security-policy'      # the application's CSP
```

Finally, make sure the data directory is not reachable from the web: try its guessable addresses, e.g.
`https://example.com/hessutalks-data/config.php`. The response must be 403 or 404.

## Updates and backups

- **Update:** build a new package and replace the public directory and `app/`. Database migrations run
  automatically on the next request. Do not update during a lecture.
- **Backup:** copy the data directory. A consistent copy of the database can be taken even while it is in use:
  `sqlite3 hessutalks.sqlite ".backup hessutalks-copy.sqlite"`. Messages are encrypted in the database, but
  `config.php` contains the `app_secret`, so keep backups protected.
- **Moving to another server:** move the data directory, install the package and, if needed, fix the paths in
  `config.php` (`db_path`, `session_path`). If the address changes, passkeys must be created again, because
  they are bound to the host name (`rp_id`).

## Automatic deployment

The repository's CI/CD pipeline (`.github/workflows/ci.yml`) builds the same package and uploads it over FTPS
when all tests pass on the `main` branch. After the deploy it smoke-tests `APP_URL/healthz`. In your own copy:

1. Create the environment `production` on GitHub (*Settings → Environments*) and add the secrets `FTP_SERVER`,
   `FTP_USERNAME` and `FTP_PASSWORD` and the variable `APP_URL` (e.g. `https://example.com/hessutalks`).
2. Restrict the FTP account's root to the public directory. Choose an account name that cannot be guessed and a long random password.
3. Optionally add *Required reviewers* to the environment, so that every deploy waits for approval.
4. The variable `DEPLOY_FREEZE` blocks deploys during given time windows (see [README](../README.en.md#cicd-pipeline)).

If you deploy some other way (SFTP, rsync, container), replace the pipeline's FTPS upload step with your own.
Building the package and the smoke test stay the same.
