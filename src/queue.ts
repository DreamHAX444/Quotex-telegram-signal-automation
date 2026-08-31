import type { AutomationTask, ExecutionResult, TradeSignal } from './types.js';
import { logger } from './logger.js';
import { systemEvents } from './events.js';

interface QueueEntry {
  task: AutomationTask;
  runner: (signal: TradeSignal) => Promise<ExecutionResult>;
  resolve: (result: ExecutionResult) => void;
}

/**
 * Strict FIFO automation queue with exactly one active runner.
 * Waiting tasks can be cancelled safely without detaching the active task.
 */
export class AutomationQueue {
  private readonly waiting: QueueEntry[] = [];
  private active = false;
  private isPausedState = false;
  private idleWaiters: Array<() => void> = [];

  public enqueue(
    task: AutomationTask,
    runner: (signal: TradeSignal) => Promise<ExecutionResult>
  ): Promise<ExecutionResult> {
    if (this.isPausedState) {
      return Promise.resolve({
        success: false,
        signal: task.signal,
        durationMs: 0,
        error: 'Queue is paused',
      });
    }

    const resultPromise = new Promise<ExecutionResult>((resolve) => {
      this.waiting.push({ task, runner, resolve });
    });

    logger.queue(
      `Enqueued task [${task.id}] for [${task.signal.action} ${task.signal.ticker}]. Total: ${this.totalCount}`
    );
    systemEvents.emit('task:queued', task);
    this.emitStats();
    void this.drain();

    return resultPromise;
  }

  public getStats(): { size: number; pending: number; isPaused: boolean } {
    return {
      size: this.totalCount,
      pending: this.active ? 1 : 0,
      isPaused: this.isPausedState,
    };
  }

  public pause(): void {
    this.isPausedState = true;
    logger.queue('Task queue paused. Active task will finish; waiting tasks remain queued.');
    this.emitStats();
  }

  public resume(): void {
    if (!this.isPausedState) return;
    this.isPausedState = false;
    logger.queue('Task queue resumed.');
    this.emitStats();
    void this.drain();
  }

  /** Cancels waiting tasks only. The active task is never detached or duplicated. */
  public clear(): void {
    const cancelled = this.waiting.splice(0);
    for (const entry of cancelled) {
      entry.resolve({
        success: false,
        signal: entry.task.signal,
        durationMs: 0,
        error: 'Cancelled',
      });
    }

    logger.queue(`Task queue cleared. Cancelled ${cancelled.length} waiting task(s).`);
    this.emitStats();
    this.resolveIdleIfNeeded();
  }

  public async onIdle(): Promise<void> {
    if (!this.active && this.waiting.length === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private get totalCount(): number {
    return this.waiting.length + (this.active ? 1 : 0);
  }

  private emitStats(): void {
    systemEvents.emit('queue:update', this.getStats());
  }

  private resolveIdleIfNeeded(): void {
    if (this.active || this.waiting.length > 0) return;
    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  private async drain(): Promise<void> {
    if (this.active || this.isPausedState) return;

    const entry = this.waiting.shift();
    if (!entry) {
      this.resolveIdleIfNeeded();
      return;
    }

    this.active = true;
    this.emitStats();
    logger.queue(`Executing queued task [${entry.task.id}]`);
    systemEvents.emit('task:start', entry.task);

    let result: ExecutionResult;
    try {
      result = await entry.runner(entry.task.signal);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`Task [${entry.task.id}] runner threw exception`, err);
      result = {
        success: false,
        signal: entry.task.signal,
        durationMs: 0,
        error,
      };
    }

    entry.resolve(result);
    this.active = false;
    this.emitStats();

    if (this.waiting.length === 0) {
      logger.queue('Queue is idle. All tasks completed.');
      this.resolveIdleIfNeeded();
      return;
    }

    if (!this.isPausedState) void this.drain();
  }
}

export const automationQueue = new AutomationQueue();
