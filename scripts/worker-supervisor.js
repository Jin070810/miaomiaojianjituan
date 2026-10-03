// Runs outside the Worker event loop. Docker restarts this parent on failure;
// Redis unavailability alone is not treated as an event-loop stall.
const { spawn } = require("node:child_process");

function superviseWorker({
  spawnWorker = () => spawn(process.execPath, ["--import", "tsx", "worker.ts"], {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: { ...process.env, MIAOMIAO_WORKER_SUPERVISED: "1" },
  }),
  exit = (code) => process.exit(code),
  startupTimeoutMs = 120_000,
  heartbeatTimeoutMs = 60_000,
  stopTimeoutMs = 65_000,
  attachSignals = true,
} = {}) {
  const child = spawnWorker();
  let lastPulse = Date.now();
  let hasPulse = false;
  let stopping = false;
  let timedOut = false;
  let killTimer;
  let finished = false;

  const stop = (signal = "SIGTERM") => {
    if (stopping || finished) return;
    stopping = true;
    child.kill(signal);
    killTimer = setTimeout(() => {
      console.error("[worker-supervisor] graceful stop timed out");
      child.kill("SIGKILL");
    }, stopTimeoutMs);
  };
  const tick = setInterval(() => {
    if (stopping || finished) return;
    if (Date.now() - lastPulse > (hasPulse ? heartbeatTimeoutMs : startupTimeoutMs)) {
      timedOut = true;
      console.error("[worker-supervisor] event-loop heartbeat expired; restarting Worker");
      stop();
    }
  }, 5_000);
  const onTerm = () => stop("SIGTERM");
  const onInt = () => stop("SIGINT");
  const finish = (code) => {
    if (finished) return;
    finished = true;
    clearInterval(tick);
    if (killTimer) clearTimeout(killTimer);
    if (attachSignals) {
      process.off("SIGTERM", onTerm);
      process.off("SIGINT", onInt);
    }
    exit(code);
  };
  child.on("message", (message) => {
    if (message && message.type === "worker-liveness") {
      lastPulse = Date.now();
      hasPulse = true;
    }
  });
  child.on("error", (error) => { console.error("[worker-supervisor]", error); finish(1); });
  child.on("exit", (code) => finish(timedOut ? 1 : code ?? (stopping ? 0 : 1)));
  if (attachSignals) {
    process.once("SIGTERM", onTerm);
    process.once("SIGINT", onInt);
  }
  return { stop };
}
module.exports = { superviseWorker };
if (require.main === module) superviseWorker();
