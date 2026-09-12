# Speedtest

A small, self-hosted browser test for latency, download speed, and upload speed.

![Speed test running](screenshot.gif)

## Features

- **Auto** selects between configurable minimum and maximum connection counts.
- **Single connection** measures one transfer for comparison with workloads
  such as media streaming and browser downloads.
- Download and upload have separate warm-up and measurement durations.
- Tests end after the configured time, not after a fixed amount of data.
- Warm-up traffic is excluded from the reported speed.

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

Open <http://localhost:8080>, choose the settings, and select **Start**.
Select **Cancel** to stop and keep the displayed results. Starting again clears
the results and runs the test from the beginning.

## Test settings

| Setting | Default | Allowed values |
| --- | --- | --- |
| Minimum connections (Auto) | 2 | 1–6 |
| Maximum connections (Auto) | 4 | 1–6; at least the minimum |
| Download warm-up | 6 seconds | 0–3600 seconds |
| Upload warm-up | 6 seconds | 0–3600 seconds |
| Download duration | 4 seconds | 0.1–3600 seconds |
| Upload duration | 4 seconds | 0.1–3600 seconds |

Times accept tenths of a second. Each direction runs for its warm-up plus its
measurement duration. Settings cannot change during a run.

In Auto mode, the test measures the minimum connection count, probes the
maximum, and keeps the maximum only when throughput improves by at least 8%.
If there is not enough data to show an improvement, it keeps the minimum. A
zero-second warm-up skips the comparison and uses the minimum. Set both counts
to the same value to use a fixed number of connections.

Single connection mode ignores the Auto connection settings. Upload requests
repeat until the configured time ends, and any request still running at the
deadline is stopped.

## Reverse proxies

The app can start concurrent requests, but it cannot force a browser to open
separate transport connections. HTTP/2 and HTTP/3 can carry concurrent requests
over one connection. Use HTTP/1.1 for the speed-test hostname when Auto mode
must measure separate TCP connections.

The maximum is six connections to fit common HTTP/1.1 browser limits. The
browser, operating system, and reverse proxy still control connection reuse.
