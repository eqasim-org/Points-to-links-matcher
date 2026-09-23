import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const cliPath = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
let stopping = false;

const app = spawn(process.execPath, [cliPath, "dev"], {
  cwd: projectDirectory,
  stdio: "inherit",
  windowsHide: false,
});

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  app.kill("SIGTERM");
  control.close(() => process.exit(exitCode));
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

const control = createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
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

control.listen(3001, "127.0.0.1", () => {
  console.log("Stop control ready. Use the Stop app button in LinkMatch.");
});

app.on("exit", (code) => {
  if (!stopping) shutdown(code ?? 0);
});
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
