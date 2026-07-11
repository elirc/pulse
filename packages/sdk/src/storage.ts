/**
 * Storage (S03). `localStorage` is not as safe as it looks: Safari private mode throws on `setItem`, some
 * browsers disable it entirely, and quota can be exceeded. A analytics SDK that lets any of those throw would
 * take down the host page. So every access is wrapped, and on any failure we fall back to an in-memory store —
 * the SDK keeps working (for the session) and the page never sees an exception.
 */
export interface SafeStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** An in-memory SafeStorage — the fallback when localStorage is unavailable, and the seam tests inject. */
export function memoryStorage(): SafeStorage {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
}

/** localStorage-backed SafeStorage, degrading to memory if localStorage throws or is missing. */
export function browserStorage(): SafeStorage {
  try {
    const ls = globalThis.localStorage;
    const probe = "__pulse_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return {
      get: (k) => {
        try {
          return ls.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          ls.setItem(k, v);
        } catch {
          /* quota / private mode — drop silently, never throw into the page */
        }
      },
      remove: (k) => {
        try {
          ls.removeItem(k);
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return memoryStorage();
  }
}
