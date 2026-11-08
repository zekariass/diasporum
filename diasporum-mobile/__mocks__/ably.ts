/**
 * Manual Jest mock for `ably` — prevents real sockets/auth in tests.
 * Test files that drive events may shadow this with their own
 * `jest.mock('ably', factory)`; suites that merely render messaging UI get
 * this inert stand-in automatically.
 */

const state = { channels: {} as Record<string, FakeChannel>, instances: [] as FakeRealtime[] };

class FakeChannel {
  handlers: ((m: { name: string; data: unknown }) => void)[] = [];
  constructor(public name: string) {}
  subscribe(cb: (m: { name: string; data: unknown }) => void) {
    this.handlers.push(cb);
    return Promise.resolve(null);
  }
  unsubscribe() { this.handlers = []; }
}

class FakeRealtime {
  closed = false;
  connection = {
    state: 'connected',
    listeners: [] as ((s: { current: string; previous: string }) => void)[],
    on(cb: (s: { current: string; previous: string }) => void) {
      this.listeners.push(cb);
    },
  };
  channels = {
    get: (n: string) => state.channels[n] ??= new FakeChannel(n),
  };
  constructor(public options: Record<string, unknown>) {
    state.instances.push(this);
  }
  close() { this.closed = true; }
}

export const __state = state;
export { FakeRealtime as Realtime };
export default { Realtime: FakeRealtime };
