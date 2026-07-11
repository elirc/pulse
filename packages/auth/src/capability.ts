/**
 * Key capabilities (S02) — the fix to the privilege-confusion arc.
 *
 * The rule, stated once and enforced everywhere: a credential's capability follows its AUDIENCE.
 *   • WRITE keys ship in public page source to strangers → they may only APPEND events. Never read.
 *   • SECRET keys live only on a server → they may read (and append server-side).
 *
 * "Valid" and "allowed" are different questions. Resolving a key answers the first (is it real?). This module
 * answers the second (may it do THIS?). Keeping them separate is what stopped a public write key from reading
 * a project's event stream. This is a pure lookup table on purpose — the policy is small, total, and auditable
 * at a glance; when it grows (per-key scopes in S13) it grows here, in one place.
 */
import type { KeyType } from "./keys";

export type Capability = "append" | "read";

const CAPABILITIES: Record<KeyType, Record<Capability, boolean>> = {
  WRITE: { append: true, read: false },
  SECRET: { append: true, read: true },
};

/** Whether a key of `type` may perform `cap`. */
export function keyCan(type: KeyType, cap: Capability): boolean {
  return CAPABILITIES[type][cap];
}

/** The full capability row for a key type (handy for tests and settings UIs). */
export function capabilitiesFor(type: KeyType): Readonly<Record<Capability, boolean>> {
  return CAPABILITIES[type];
}

export class CapabilityError extends Error {
  constructor(
    public readonly type: KeyType,
    public readonly capability: Capability,
  ) {
    super(`A ${type} key may not ${capability}`);
    this.name = "CapabilityError";
  }
}

/** Throw {@link CapabilityError} unless a key of `type` may perform `cap`. */
export function assertCapability(type: KeyType, cap: Capability): void {
  if (!keyCan(type, cap)) throw new CapabilityError(type, cap);
}
