// Shared jsdom stubs for the Follow Mode render-harness. jsdom has no
// real <canvas> 2D rendering or ResizeObserver -- these stubs exist only
// so the real, unmodified CityCanvasIso component can execute its actual
// effects/handlers without throwing. They do not change or fake any
// application logic; they only satisfy browser APIs jsdom doesn't
// implement, mirroring how a headless test environment normally handles
// canvas in absence of an actual GPU/browser.
import { vi } from "vitest";

export function installDomStubs() {
  // No-op 2D context: every method call is a no-op, every property read
  // returns a benign default. drawX() calls in lib/isoRenderer.ts issue
  // real canvas API calls (fillRect, arc, etc.) -- we don't need them to
  // actually paint pixels for this harness, only to not throw.
  const ctxStub: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "canvas") return undefined;
        if (prop === "measureText") return () => ({ width: 10 });
        return () => {};
      },
      set() {
        return true;
      },
    }
  );
  (HTMLCanvasElement.prototype as any).getContext = () => ctxStub;
  (HTMLCanvasElement.prototype as any).setPointerCapture = () => {};

  (global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // Deterministic, manually-driven animation clock: requestAnimationFrame
  // queues the callback instead of firing it on a real display refresh.
  // The test advances time and flushes frames explicitly so walk timing
  // (MIN_WALK_MS/MAX_WALK_MS/WALK_SPEED_PX_PER_S, all real constants in
  // CityCanvasIso.tsx) can be exercised deterministically rather than
  // racing a real 60Hz clock.
  let now = 0;
  let pending: FrameRequestCallback[] = [];
  (global as any).__setNow = (t: number) => {
    now = t;
  };
  vi.spyOn(performance, "now").mockImplementation(() => now);
  (global as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    pending.push(cb);
    return pending.length;
  };
  (global as any).cancelAnimationFrame = () => {};
  (global as any).__flushFrame = (dtMs: number) => {
    now += dtMs;
    const toRun = pending;
    pending = [];
    for (const cb of toRun) cb(now);
  };
}
