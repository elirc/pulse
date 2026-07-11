/**
 * @pulse/sdk — the public surface (S03). A module-level singleton mirrors the script-tag global that most
 * customers use (`pulse.init(...)`, `pulse.capture(...)`). The never-throw wrapper that makes these safe on a
 * stranger's page arrives in a later commit; the shape is fixed now.
 */
import { Pulse } from "./pulse";
import { guard } from "./guard";
import type { PulseOptions } from "./types";

const instance = new Pulse();

// Every public entry point runs inside the never-throw boundary: a bug in here can never throw into the host
// page. Errors are swallowed and (optionally) reported through the caller's `onError`.
export function init(options: PulseOptions): void {
  guard(() => instance.init(options), options.onError);
}

export function capture(name: string, props?: Record<string, unknown>): void {
  guard(() => instance.capture(name, props), instance.onError);
}

export function identify(distinctId: string): void {
  guard(() => instance.identify(distinctId), instance.onError);
}

export function reset(): void {
  guard(() => instance.reset(), instance.onError);
}

export type { EventEnvelope, PulseOptions } from "./types";
export { Pulse } from "./pulse";
export { guard } from "./guard";
export { installAutoPageview } from "./pageview";
export { uuid, loadOrCreateDistinctId } from "./id";
export { browserStorage, memoryStorage, type SafeStorage } from "./storage";
export {
  BatchTransport,
  ImmediateTransport,
  httpSend,
  beaconSend,
  withRetry,
  type Transport,
  type SendFn,
  type BeaconFn,
  type RetryConfig,
} from "./transport";
