import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export function browserCommand(platform, url) {
  if (platform === "win32") return ["rundll32.exe", ["url.dll,FileProtocolHandler", url]];
  if (platform === "darwin") return ["open", [url]];
  if (platform === "linux") return ["xdg-open", [url]];
  throw new Error("Automatic browser opening is not supported on this platform.");
}

export function openBrowser(url, platform = process.platform, launch = spawn) {
  return new Promise((resolve, reject) => {
    const [command, args] = browserCommand(platform, url);
    const child = launch(command, args, { stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Browser opener exited with code ${code}`)));
  });
}

export async function waitForReady(url, { request = fetch, sleep = delay, attempts = 120, stopped = () => false } = {}) {
  for (let attempt = 0; attempt < attempts && !stopped(); attempt++) {
    try {
      const response = await request(url, { signal: AbortSignal.timeout(3000) });
      const ready = response.ok;
      await response.body?.cancel();
      if (ready && !stopped()) return true;
    } catch { /* Server may still be starting or compiling. */ }
    await sleep(500);
  }
  return false;
}
