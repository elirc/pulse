/**
 * Share-token policy (S13, harvests flaw #5). S10 shipped share tokens that never expired and had no revocation
 * path — a link leaked once was public forever. This is the pure decision layer that fixes it: given a token
 * record and the current time, decide whether the link is still valid, and *why not* if it isn't. Kept pure and
 * DB-free so CI can exercise every branch; `share.ts` supplies the record from Postgres.
 */
export const SHARE_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export interface ShareTokenRecord {
  dashboardId: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

export type ShareTokenVerdict =
  | { valid: true; dashboardId: string }
  | { valid: false; reason: "revoked" | "expired" };

/** Evaluate a resolved token record against the policy: revoked links die immediately, expired links stop. */
export function evaluateShareToken(record: ShareTokenRecord, now: Date = new Date()): ShareTokenVerdict {
  if (record.revokedAt !== null) return { valid: false, reason: "revoked" };
  if (record.expiresAt !== null && now.getTime() >= record.expiresAt.getTime()) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true, dashboardId: record.dashboardId };
}

/**
 * Enumeration monitor (S13). Share tokens carry an identifiable `pst_`-prefix; an attacker probing sequential
 * prefixes to find a live link is a scan we should SEE. This tracks failed lookups per source and flags a source
 * that crosses a miss threshold inside a window — the signal an on-call uses to spot (and later block) a scanner.
 * A monitor, not a blocker: it never denies a legitimate 404, it raises the alarm.
 */
export interface EnumerationMonitorConfig {
  /** Failed lookups from one source within the window before it's flagged. Default 20. */
  threshold?: number;
  /** Rolling window, ms. Default 60_000. */
  windowMs?: number;
  now?: () => number;
}

export class EnumerationMonitor {
  private readonly misses = new Map<string, number[]>();
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(cfg: EnumerationMonitorConfig = {}) {
    this.threshold = cfg.threshold ?? 20;
    this.windowMs = cfg.windowMs ?? 60_000;
    this.now = cfg.now ?? (() => Date.now());
  }

  /** Record a failed token lookup from `source`; returns true if this source is now flagged as scanning. */
  recordMiss(source: string): boolean {
    const t = this.now();
    const cutoff = t - this.windowMs;
    const recent = (this.misses.get(source) ?? []).filter((ts) => ts > cutoff);
    recent.push(t);
    this.misses.set(source, recent);
    return recent.length >= this.threshold;
  }

  missCount(source: string): number {
    const cutoff = this.now() - this.windowMs;
    return (this.misses.get(source) ?? []).filter((ts) => ts > cutoff).length;
  }
}
