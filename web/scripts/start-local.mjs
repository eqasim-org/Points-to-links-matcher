import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { openBrowser, waitForReady } from "./launcher-utils.mjs";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const cliPath = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
const url = "http://localhost:3000";
let stopping = false;
let app;

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  app?.kill("SIGTERM");
  control.close(() => process.exit(exitCode));
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

const control = createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", url);
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  if (request.method === "POST" && request.url === "/stop") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ stopped: true }));
    setTimeout(() => shutdown(0), 150);
    return;
  }
  response.writeHead(404).end();
});

control.on("error", error => {
  console.error(`Cannot start LinkMatch: ${error.message}. It may already be running; check ${url}.`);
  shutdown(1);
});
control.listen(3001, "127.0.0.1", () => {
  app = spawn(process.execPath, [cliPath, "dev", "--port", "3000", "--hostname", "localhost"], {
    cwd: projectDirectory, stdio: "inherit", windowsHide: true,
  });
  app.on("error", error => { console.error(error.message); shutdown(1); });
  app.on("exit", code => { if (!stopping) shutdown(code ?? 0); });
  console.log("Starting LinkMatch. Your browser will open when the app is ready.");
  console.log("Keep this terminal open. Use Stop app or Ctrl+C to stop.");
  if (!process.argv.includes("--no-open")) {
    void waitForReady(url, { stopped: () => stopping }).then(async ready => {
      if (stopping) return;
      if (!ready) { console.warn(`Still waiting for the app. Check the errors above, then open ${url}.`); return; }
      try { await openBrowser(url); }
      catch (error) { console.warn(`Could not open a browser: ${error.message}. Open ${url} manually.`); }
    });
  }
});
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
