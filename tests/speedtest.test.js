const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const page = readFileSync(join(__dirname, "../index.html"), "utf8");
const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
const flush = () => new Promise(setImmediate);

// A virtual clock lets the real pass logic run against controlled throughput.
class Clock {
  now = 0;
  nextId = 0;
  timers = new Map();
  transfer = () => {};

  schedule(callback, delay, repeat = false) {
    const id = ++this.nextId;
    this.timers.set(id, { callback, at: this.now + delay, delay, repeat });
    return id;
  }

  advance(to) {
    this.transfer(to - this.now);
    this.now = to;
  }

  async tick(duration) {
    const end = this.now + duration;
    await flush();
    while (true) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      const [id, timer] = next;
      this.advance(Math.max(this.now, timer.at));
      if (timer.repeat) timer.at = this.now + timer.delay;
      else this.timers.delete(id);
      timer.callback();
      await flush();
    }
    this.advance(end);
    await flush();
  }
}

function harness() {
  const clock = new Clock();
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        value: "",
        addEventListener() {},
        setCustomValidity() {},
      });
    }
    return elements.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: element },
    performance: { now: () => clock.now },
    setTimeout: (fn, ms) => clock.schedule(fn, ms),
    setInterval: (fn, ms) => clock.schedule(fn, ms, true),
    clearTimeout: id => clock.timers.delete(id),
    clearInterval: id => clock.timers.delete(id),
    URL,
    AbortController,
    location: { href: "http://localhost/" },
  });
  vm.runInContext(script, context);

  const workers = [];
  const active = new Set();
  let bytesPerMs = () => 100;
  clock.transfer = elapsed => {
    for (const worker of active) {
      worker.addBytes(elapsed * bytesPerMs(active.size, element("#status").value));
    }
  };
  function createWorker(addBytes, fail) {
    let resolve;
    const worker = {
      addBytes,
      fail,
      started: clock.now,
      done: new Promise(done => { resolve = done; }),
      stop() {
        if (!active.delete(worker)) return;
        worker.stopped = clock.now;
        resolve();
      },
    };
    workers.push(worker);
    active.add(worker);
    return worker;
  }
  return {
    clock, context, element, workers, active, createWorker,
    speed(fn) { bytesPerMs = fn; },
    pass(timing, config = {}, name = "Download") {
      const selector = name.toLowerCase();
      return context.throughputPass(
        name,
        element(`#${selector}`),
        element(`#${selector}-connections`),
        { mode: "auto", minConnections: 2, maxConnections: 4, ...config },
        timing,
        createWorker,
      );
    },
  };
}

function assertClean(run) {
  assert.equal(run.active.size, 0, "all transfers must stop");
  assert.equal(run.clock.timers.size, 0, "all timers must be cleared");
}

test("each direction uses its own warm-up and full measurement duration", async () => {
  const run = harness();
  run.speed((_, status) => status.includes("warm-up") ? 10000 : 100);
  for (const [name, warmup, duration] of [["Download", 600, 1000], ["Upload", 900, 1700]]) {
    const started = run.clock.now;
    const result = run.pass({ warmup, duration }, { mode: "single" }, name);
    await run.clock.tick(warmup);
    assert.equal(run.element("#status").value, `${name}…`);
    await run.clock.tick(duration - 1);
    assert.equal(run.active.size, 1, "measurement must not end early");
    await run.clock.tick(1);
    assert.equal((await result).mbps, 0.8, "warm-up bytes must not affect the score");
    assert.equal(run.workers.at(-1).stopped - started, warmup + duration);
    assertClean(run);
  }
});

test("Auto starts at the configured minimum and retains a faster maximum", async () => {
  const run = harness();
  const result = run.pass({ warmup: 6000, duration: 1200 }, {
    minConnections: 3, maxConnections: 6,
  });
  assert.equal(run.active.size, 3);
  await run.clock.tick(2000);
  assert.equal(run.active.size, 6);
  assert.equal(run.element("#download-connections").value, "probing 6");
  await run.clock.tick(4000);
  assert.equal(run.element("#status").value, "Download…");
  await run.clock.tick(1200);
  assert.equal((await result).connections, 6);
  assert.equal(run.element("#download-connections").value, "6 connections");
  assert.equal((await result).mbps, 4.8);
  assertClean(run);
});

test("Auto releases the extra connections when they do not improve throughput", async () => {
  const run = harness();
  run.speed(count => 300 / count);
  const result = run.pass({ warmup: 3000, duration: 500 }, {
    minConnections: 1, maxConnections: 5,
  });
  await run.clock.tick(1000);
  assert.equal(run.active.size, 5);
  await run.clock.tick(1000);
  assert.equal(run.active.size, 1);
  assert.ok(run.workers.slice(1).every(worker => worker.stopped === 2000));
  await run.clock.tick(1500);
  assert.equal((await result).connections, 1);
  assert.equal(run.element("#download-connections").value, "1 connection");
  assert.equal((await result).mbps, 2.4);
  assertClean(run);
});

test("Auto rejects gains below 8% and accepts larger gains", async () => {
  for (const gain of [1.079, 1.081]) {
    const run = harness();
    run.speed(count => (count === 2 ? 200 : 200 * gain) / count);
    const result = run.pass({ warmup: 6000, duration: 1000 });
    await run.clock.tick(7000);
    assert.equal((await result).connections, gain < 1.08 ? 2 : 4);
    assertClean(run);
  }
});

test("equal connection limits use a fixed count without probing", async () => {
  const run = harness();
  const result = run.pass({ warmup: 600, duration: 700 }, {
    minConnections: 3, maxConnections: 3,
  });
  await run.clock.tick(1300);
  assert.equal(run.workers.length, 3);
  assert.equal((await result).connections, 3);
  assertClean(run);
});

test("zero warm-up measures immediately without probing", async () => {
  const run = harness();
  const result = run.pass({ warmup: 0, duration: 100 }, {
    minConnections: 2, maxConnections: 6,
  });
  assert.equal(run.element("#status").value, "Download…");
  await run.clock.tick(100);
  assert.equal(run.workers.length, 2);
  assert.equal((await result).connections, 2);
  assert.equal((await result).mbps, 1.6);
  assertClean(run);
});

test("Single ignores the configured Auto connection limits", async () => {
  const run = harness();
  const result = run.pass({ warmup: 3000, duration: 2000 }, {
    mode: "single", minConnections: 3, maxConnections: 6,
  });
  await run.clock.tick(5000);
  assert.equal(run.workers.length, 1);
  assert.equal((await result).connections, 1);
  assert.equal(run.element("#download-connections").value, "1 connection");
  assertClean(run);
});

test("late warm-up timers do not shorten the measurement window", async () => {
  const run = harness();
  const result = run.pass({ warmup: 1000, duration: 2000 }, { mode: "single" });
  run.clock.advance(1400); // Simulate a busy browser event loop.
  await run.clock.tick(0);
  await run.clock.tick(1999);
  assert.equal(run.active.size, 1);
  await run.clock.tick(1);
  assert.equal(run.workers[0].stopped, 3400);
  assert.equal((await result).mbps, 0.8);
  assertClean(run);
});

test("a failed worker stops all transfers and cancels long pending timers", async () => {
  const run = harness();
  const result = run.pass({ warmup: 3600000, duration: 3600000 });
  const rejected = assert.rejects(result, /connection lost/);
  run.workers[0].fail(new Error("connection lost"));
  await rejected;
  assertClean(run);
});

test("an empty measurement fails even if warm-up transferred data", async () => {
  const run = harness();
  run.speed((_, status) => status.includes("warm-up") ? 100 : 0);
  const result = run.pass({ warmup: 500, duration: 500 }, { mode: "single" });
  const rejected = assert.rejects(result, /Download transferred no data/);
  await run.clock.tick(1000);
  await rejected;
  assertClean(run);
});

test("upload repeats completed bodies and aborts an unfinished body at the deadline", async () => {
  const run = harness();
  const requests = [];
  run.context.XMLHttpRequest = class {
    upload = {};
    status = 204;
    constructor() { requests.push(this); }
    open() {}
    send(body) { this.body = body; }
    abort() { this.aborted = true; this.onabort(); }
  };
  const body = { size: 1000 };
  const result = run.context.throughputPass(
    "Upload",
    run.element("#upload"),
    run.element("#upload-connections"),
    { mode: "single" },
    { warmup: 0, duration: 1000 },
    (addBytes, fail) => run.context.uploadWorker(body, addBytes, fail),
  );
  for (let i = 0; i < 3; i++) {
    await run.clock.tick(200);
    requests[i].upload.onprogress({ loaded: body.size });
    requests[i].upload.onload({ loaded: body.size });
    requests[i].onload();
    await flush();
  }
  assert.equal(requests.length, 4, "finishing a body must not finish the test");
  assert.ok(requests.every(request => request.body === body));
  await run.clock.tick(200);
  requests[3].upload.onprogress({ loaded: 500 });
  await run.clock.tick(200);
  assert.equal(requests[3].aborted, true, "deadline must abort a partial body");
  assert.equal((await result).mbps, 0.028, "progress and load must not double-count bytes");
  assertClean(run);
});
