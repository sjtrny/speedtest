# Speedtest

Minimal browser-based latency, download, and upload test to your server.

- **Auto** starts with the configured minimum connections, probes the maximum
  during warm-up, and keeps the maximum only when it improves throughput by
  at least 8%.
- **Single connection** measures one transfer for comparison with workloads
  such as media streaming and ordinary browser downloads.
- Download and upload each have their own warm-up and measurement times.
  Results exclude warm-up traffic. Both directions stop on a timer, not after
  transferring a fixed amount of data.

![Speed test running](screenshot.gif)

## Run

```sh
docker run --rm -p 8080:8080 ghcr.io/sjtrny/speedtest:latest
```

Or with Docker Compose:

```yaml
services:
  speedtest:
    image: ghcr.io/sjtrny/speedtest:latest
    ports:
      - "8080:8080"
    restart: unless-stopped
```

```sh
docker compose up -d
```

Open <http://localhost:8080>, choose a mode and settings, and select **Start**.

## Test settings

| Setting | Default | Allowed values |
| --- | --- | --- |
| Minimum Auto connections | 2 | 1–6 |
| Maximum Auto connections | 4 | Minimum–6 |
| Download warm-up | 6 seconds | 0–3600 seconds |
| Upload warm-up | 6 seconds | 0–3600 seconds |
| Download measurement | 4 seconds | 0.1–3600 seconds |
| Upload measurement | 4 seconds | 0.1–3600 seconds |

Times accept tenths of a second. Each direction runs for its warm-up **plus**
its measurement time. The defaults retain the ten-second pass per direction.
Settings are fixed during a run and can be changed before the next run.

Auto uses the first third of warm-up at the minimum connection count, the
second third to probe the maximum, and the final third to settle at the
selected count. If there are not enough throughput samples to show a gain,
it keeps the minimum. Zero warm-up skips probing and immediately measures at
the minimum. Set minimum and maximum to the same value for a fixed connection
count. Single mode ignores the Auto connection settings.

The upload repeats a reusable 32 MiB request body for as long as needed and
aborts any in-flight request when its time expires. That chunk size does not
set the test duration or impose a total transfer limit.

## Development checks

Run the dependency-free timing and connection regression checks with Node.js:

```sh
node --test tests/speedtest.test.js
```

## Reverse proxies

The app cannot tell a browser to create a new transport connection. When a
reverse proxy offers HTTP/2 or HTTP/3, concurrent test requests can share one
connection. Configure the dedicated speed-test hostname for HTTP/1.1 if Auto
mode must measure multiple independent TCP connections.

The production Caddy route is configured to use HTTP/1.1. The page does not
show a protocol result because this is a deployment setting rather than a
speed-test result.

Connection settings are limited to six to fit Chromium's default HTTP/1.1
[per-host connection limit](https://github.com/chromium/chromium/blob/main/net/socket/client_socket_pool_manager.cc).
The browser and proxy still control the actual transport connections.
