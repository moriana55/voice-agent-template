export type ReplayResult<T> =
  | { cached: true; value: T }
  | { cached: false };

export class ReplayWindow<T> {
  private readonly active = new Set<string>();
  private readonly completed = new Map<string, { value: T; completedAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maximumEntries: number,
  ) {}

  private clean(now: number) {
    const cutoff = now - this.ttlMs;
    for (const [key, entry] of this.completed) {
      if (entry.completedAt < cutoff) this.completed.delete(key);
    }
    while (this.completed.size > this.maximumEntries) {
      const oldest = this.completed.keys().next().value as string | undefined;
      if (!oldest) break;
      this.completed.delete(oldest);
    }
  }

  begin(key: string, now = Date.now()): ReplayResult<T> {
    this.clean(now);
    const completed = this.completed.get(key);
    if (completed) return { cached: true, value: completed.value };
    if (this.active.has(key)) {
      throw Object.assign(new Error("Bu sağlayıcı isteği halen işleniyor."), { status: 409 });
    }
    this.active.add(key);
    return { cached: false };
  }

  commit(key: string, value: T, now = Date.now()) {
    this.active.delete(key);
    this.completed.set(key, { value, completedAt: now });
    this.clean(now);
  }

  abort(key: string) {
    this.active.delete(key);
  }

  clear() {
    this.active.clear();
    this.completed.clear();
  }
}
