import { afterEach, describe, expect, it, vi } from "vitest";

import { ProtocolClient } from "./client.js";

/**
 * Backoff ageing.
 *
 * The attempt counter decides which rung of the backoff schedule is used. It
 * rises on each failure and must fall again once the connection has been quiet
 * for long enough — otherwise a host that was down for hours leaves the page
 * waiting the full backoff after it returns.
 *
 * The clock is injected, so "quiet for a while" is expressed by advancing a
 * number rather than by waiting. Advancing real or fake timers would also fire
 * the retry timer, which is a different mechanism from the one under test.
 */

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(): void {}

  close(): void {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
}

interface Rig {
  client: ProtocolClient;
  /** Every delay the client asked a timer for, in order. */
  delays: number[];
  /** Advance the injected clock without firing timers. */
  elapse(ms: number): void;
  /** Run the most recently scheduled timer, as the browser would. */
  fireNext(): void;
}

const SCHEDULE = [1_000, 2_000, 4_000] as const;

function createRig(): Rig {
  FakeSocket.instances = [];
  let clock = 0;
  const delays: number[] = [];
  const pending: Array<() => void> = [];

  const client = new ProtocolClient({
    role: "control",
    location: { protocol: "http:", host: "127.0.0.1:8765", search: "" },
    webSocketFactory: (url) => new FakeSocket(url) as unknown as WebSocket,
    backoffMs: SCHEDULE,
    now: () => clock,
    setTimeout: (handler, ms) => {
      delays.push(ms);
      pending.push(handler);
      return pending.length - 1;
    },
    clearTimeout: (handle) => {
      const index = handle as number;
      if (pending[index] !== undefined) {
        pending[index] = () => {};
      }
    },
  });

  return {
    client,
    delays,
    elapse(ms: number): void {
      clock += ms;
    },
    fireNext(): void {
      const next = pending.shift();
      next?.();
    },
  };
}

/** Fail `count` times, each failure immediately following its retry. */
function failRepeatedly(rig: Rig, count: number): void {
  rig.client.connect();
  for (let round = 0; round < count; round += 1) {
    const socket = FakeSocket.instances[FakeSocket.instances.length - 1]!;
    socket.close();
    rig.fireNext();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("backoff ageing", () => {
  it("climbs the schedule while failures keep coming", () => {
    const rig = createRig();
    failRepeatedly(rig, 4);

    // Four failures, so the first four delays walk the schedule and then stay
    // at its ceiling.
    expect(rig.delays.slice(0, 4)).toEqual([1_000, 2_000, 4_000, 4_000]);
    rig.client.dispose();
  });

  it("returns to the first rung after a quiet period", () => {
    const rig = createRig();
    failRepeatedly(rig, 4);
    rig.delays.length = 0;

    // Quiet for several windows: the counter ages all the way back down.
    rig.elapse(20_000);

    const socket = FakeSocket.instances[FakeSocket.instances.length - 1]!;
    socket.close();
    expect(rig.delays[0]).toBe(SCHEDULE[0]);
    rig.client.dispose();
  });

  it("does not drop below the ceiling from a single quiet window", () => {
    const rig = createRig();
    failRepeatedly(rig, 4);

    // One window of quiet lowers the count by one, which from the ceiling is
    // still the ceiling: ageing is gradual, not a collapse to the first rung.
    rig.elapse(4_000);
    rig.delays.length = 0;
    FakeSocket.instances[FakeSocket.instances.length - 1]!.close();
    expect(rig.delays[0]).toBe(SCHEDULE[2]);

    rig.client.dispose();
  });

  it("does not age while failures keep arriving", () => {
    const rig = createRig();
    // Each failure arrives well inside a window, so the counter must only climb.
    rig.client.connect();
    for (let round = 0; round < 3; round += 1) {
      rig.elapse(500);
      FakeSocket.instances[FakeSocket.instances.length - 1]!.close();
      rig.fireNext();
    }

    expect(rig.delays.slice(0, 3)).toEqual([1_000, 2_000, 4_000]);
    rig.client.dispose();
  });

  it("resets completely once a connection opens", () => {
    const rig = createRig();
    failRepeatedly(rig, 3);
    rig.delays.length = 0;

    // The retry opens.
    FakeSocket.instances[FakeSocket.instances.length - 1]!.open();
    expect(rig.client.transport).toBe("open");

    FakeSocket.instances[FakeSocket.instances.length - 1]!.close();
    // No quiet period at all; a successful open already cleared the history.
    expect(rig.delays[0]).toBe(SCHEDULE[0]);
    rig.client.dispose();
  });
});
