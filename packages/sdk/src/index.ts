/**
 * @pulse/sdk — the public surface (S03). A module-level singleton mirrors the script-tag global that most
 * customers use (`pulse.init(...)`, `pulse.capture(...)`). The never-throw wrapper that makes these safe on a
 * stranger's page arrives in a later commit; the shape is fixed now.
 */
import { Pulse } from "./pulse";
import type { PulseOptions } from "./types";

const instance = new Pulse();

export function init(options: PulseOptions): void {
  instance.init(options);
}

export function capture(name: string, props?: Record<string, unknown>): void {
  instance.capture(name, props);
}

export function identify(distinctId: string): void {
  instance.identify(distinctId);
}

export function reset(): void {
  instance.reset();
}

export type { EventEnvelope, PulseOptions } from "./types";
export { Pulse } from "./pulse";
export { uuid, loadOrCreateDistinctId } from "./id";
export { browserStorage, memoryStorage, type SafeStorage } from "./storage";
export {
  BatchTransport,
  ImmediateTransport,
  httpSend,
  beaconSend,
  type Transport,
  type SendFn,
  type BeaconFn,
} from "./transport";
