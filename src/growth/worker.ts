import type { GrowthRuntime } from './runtime.js';

export type StepResult = 'idle' | 'completed' | 'failed';
export interface GrowthWorkerOptions {
  name: string;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

// Local proposal-processing worker. No shell, git, network or deployment
// capability: it only turns queued commands into verified deterministic
// proposals using the runtime's lease-fenced, owner-gated machinery.
export class GrowthWorker {
  private readonly name: string;
  private readonly pollMs: number;
  private readonly sleepMs: (ms: number) => Promise<void>;
  private stopped = false;

  constructor(private readonly runtime: GrowthRuntime, options: GrowthWorkerOptions) {
    this.name = options.name;
    this.pollMs = options.pollMs ?? 2000;
    this.sleepMs = options.sleep ?? (ms => new Promise<void>(resolve => { setTimeout(resolve, ms); }));
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(this.name)) throw new Error('invalid_worker');
    if (!Number.isSafeInteger(this.pollMs) || this.pollMs < 100 || this.pollMs > 60000) throw new Error('invalid_poll_interval');
  }

  // One claim -> heartbeat -> deterministic completion cycle.
  async step(): Promise<StepResult> {
    const claim = await this.runtime.claim(this.name);
    if (!claim) return 'idle';
    await this.runtime.renew(claim.id, claim.token);
    try {
      await this.runtime.complete(claim.id, claim.token);
      return 'completed';
    } catch {
      // Storage or compute failure: leave the lease in place. Bounded retries,
      // lease expiry fencing and the paused policy decide re-attempts.
      return 'failed';
    }
  }

  async run(signal?: AbortSignal): Promise<void> {
    this.stopped = false;
    while (!this.stopped && !signal?.aborted) {
      const worked = await this.step();
      if (worked === 'completed') continue;
      if (this.stopped || signal?.aborted) return;
      await this.sleepMs(this.pollMs);
    }
  }

  stop(): void { this.stopped = true; }
}
