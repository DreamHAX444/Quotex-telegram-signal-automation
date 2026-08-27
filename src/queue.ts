import PQueue from 'p-queue';
import type { AutomationTask, ExecutionResult, TradeSignal } from './types.js';
import { logger } from './logger.js';

/**
 * Sequential Task Queue (Concurrency = 1)
 * Prevents launching multiple concurrent Chromium instances and guarantees
 * deterministic, serialized execution of trading/automation tasks.
 */
class AutomationQueue {
  private queue: PQueue;

  constructor() {
    this.queue = new PQueue({ concurrency: 1 });

    this.queue.on('add', () => {
      logger.queue(`Task added. Queue Size: ${this.queue.size}, Active: ${this.queue.pending}`);
    });

    this.queue.on('active', () => {
      logger.queue(`Processing task. Active: ${this.queue.pending}, Remaining: ${this.queue.size}`);
    });

    this.queue.on('completed', () => {
      logger.queue(`Task finished. Remaining in queue: ${this.queue.size}`);
    });

    this.queue.on('idle', () => {
      logger.queue('Queue is idle. All tasks completed.');
    });

    this.queue.on('error', (err) => {
      logger.error('Unhandled error inside queue worker', err);
    });
  }

  /**
   * Enqueues an automation task to be processed sequentially.
   */
  public async enqueue(
    task: AutomationTask,
    runner: (signal: TradeSignal) => Promise<ExecutionResult>
  ): Promise<ExecutionResult> {
    logger.queue(`Enqueueing task [${task.id}] for [${task.signal.action} ${task.signal.ticker}]`);

    return this.queue.add(async () => {
      logger.queue(`Executing queued task [${task.id}]`);
      return await runner(task.signal);
    }) as Promise<ExecutionResult>;
  }

  /**
   * Returns current queue metrics.
   */
  public getStats(): { size: number; pending: number; isPaused: boolean } {
    return {
      size: this.queue.size,
      pending: this.queue.pending,
      isPaused: this.queue.isPaused,
    };
  }

  /**
   * Pauses incoming execution in the queue.
   */
  public pause(): void {
    this.queue.pause();
    logger.queue('Task queue paused.');
  }

  /**
   * Clears pending tasks from the queue.
   */
  public clear(): void {
    this.queue.clear();
    logger.queue('Task queue cleared.');
  }

  /**
   * Waits until all currently executing and pending tasks are finished.
   */
  public async onIdle(): Promise<void> {
    await this.queue.onIdle();
  }
}

export const automationQueue = new AutomationQueue();
