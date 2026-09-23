import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { browserCommand, openBrowser, waitForReady } from "../scripts/launcher-utils.mjs";

test("browser launch uses the native opener on each supported platform", () => {
  const url = "http://localhost:3000";
  assert.deepEqual(browserCommand("win32", url), ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]);
  assert.deepEqual(browserCommand("darwin", url), ["open", [url]]);
  assert.deepEqual(browserCommand("linux", url), ["xdg-open", [url]]);
});

test("browser is not considered ready until HTTP succeeds", async () => {
  let requests = 0, cancellations = 0;
  const ready = await waitForReady("http://localhost:3000", {
    attempts: 4, sleep: async () => {},
    request: async () => {
      requests++;
      if (requests === 1) throw new Error("Connection refused");
      return {ok:requests === 3, body:{cancel:async () => {cancellations++;}}};
    },
  });
  assert.equal(ready, true);
  assert.equal(requests, 3);
  assert.equal(cancellations, 2);
});

test("readiness polling stops on shutdown and gives up after the retry budget", async () => {
  const options = {attempts:2, sleep:async () => {}, request:async () => ({ok:false})};
  assert.equal(await waitForReady("http://localhost:3000", options), false);
  assert.equal(await waitForReady("http://localhost:3000", {...options, stopped:() => true, request:() => {throw new Error("Must not fetch");}}), false);
});

test("browser launch reports missing desktop opener without a shell", async () => {
  const launch = (command,args,options) => {
    assert.equal(command, "xdg-open");
    assert.equal(options.windowsHide, true);
    assert.equal(options.shell, undefined);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("error", new Error("ENOENT")));
    return child;
  };
  await assert.rejects(openBrowser("http://localhost:3000", "linux", launch), /ENOENT/);
});

test("successful browser launch resolves", async () => {
  await openBrowser("http://localhost:3000", "darwin", () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  });
});
