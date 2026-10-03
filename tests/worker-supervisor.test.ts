import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
// The production supervisor is plain Node.js and deliberately has no tsx dependency.
const { superviseWorker } = require("../scripts/worker-supervisor.js") as {
  superviseWorker: (options: { spawnWorker: () => EventEmitter & { kill: ReturnType<typeof vi.fn> }; exit: (code: number) => void; attachSignals: boolean; startupTimeoutMs: number; heartbeatTimeoutMs: number; stopTimeoutMs: number }) => { stop: () => void };
};
describe("Worker supervisor", () => {
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  function setup() {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const exit = vi.fn();
    const supervisor = superviseWorker({
      spawnWorker: () => child, exit, attachSignals: false,
      startupTimeoutMs: 20_000, heartbeatTimeoutMs: 10_000, stopTimeoutMs: 5_000,
    });
    return { child, exit, supervisor };
  }
  it("does not restart a live event loop when Redis heartbeats are unavailable", async () => {
    const { child, exit, supervisor } = setup();
    for (let i = 0; i < 10; i++) {
      child.emit("message", { type: "worker-liveness" });
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(child.kill).not.toHaveBeenCalled();
    supervisor.stop();
    child.emit("exit", 0);
    expect(exit).toHaveBeenCalledWith(0);
  });
  it("terminates a stalled process, force-kills after the grace period and exits nonzero", async () => {
    const { child, exit } = setup();
    child.emit("message", { type: "worker-liveness" });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("exit", null);
    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });
  it("does not report a timed-out deployment drain as a successful shutdown", async () => {
    const { child, exit, supervisor } = setup();
    supervisor.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("exit", null, "SIGKILL");
    expect(exit).toHaveBeenCalledWith(1);
  });
  it("requires the child to exit normally even when shutdown was requested", () => {
    const { child, exit, supervisor } = setup();
    supervisor.stop();
    child.emit("exit", null, "SIGTERM");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
