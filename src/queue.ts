import type { AutomationTask, ExecutionResult, TradeSignal } from './types.js';
import { logger } from './logger.js';

/**
 * Sequential Task Queue (Concurrency = 1)
 * Prevents launching multiple concurrent Chromium instances and guarantees
 * deterministic, serialized execution of trading/automation tasks.
 */
class AutomationQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pendingCount: number = 0;
  private isPausedState: boolean = false;
  private clearEpoch: number = 0;

  /**
   * Enqueues an automation task to be processed sequentially.
   */
  public async enqueue(
    task: AutomationTask,
    runner: (signal: TradeSignal) => Promise<ExecutionResult>
  ): Promise<ExecutionResult> {
    if (this.isPausedState) {
      return { success: false, signal: task.signal, durationMs: 0, error: 'Queue is paused' };
    }

    this.pendingCount++;
    logger.queue(`Enqueueing task [${task.id}] for [${task.signal.action} ${task.signal.ticker}]. Pending: ${this.pendingCount}`);

    const epoch = this.clearEpoch;

    const executionPromise = this.tail.then(async () => {
      if (this.isPausedState || epoch !== this.clearEpoch) {
        this.pendingCount--;
        return { success: false, signal: task.signal, durationMs: 0, error: 'Cancelled' };
      }
      
      logger.queue(`Executing queued task [${task.id}]`);
      try {
        return await runner(task.signal);
      } catch (err: any) {
        logger.error(`Task [${task.id}] runner threw exception`, err);
        return { success: false, signal: task.signal, durationMs: 0, error: err?.message || String(err) };
      } finally {
        this.pendingCount--;
        if (this.pendingCount === 0) {
          logger.queue('Queue is idle. All tasks completed.');
        }
      }
    });

    // Advance the tail, catching errors so the chain doesn't break
    this.tail = executionPromise.catch((err) => {
      logger.error('Unhandled error inside queue worker', err);
    });
    
    return executionPromise;
  }

  /**
   * Returns current queue metrics.
   */
  public getStats(): { size: number; pending: number; isPaused: boolean } {
    return {
      size: this.pendingCount,
      pending: this.pendingCount > 0 ? 1 : 0,
      isPaused: this.isPausedState,
    };
  }

  /**
   * Pauses incoming execution in the queue.
   */
  public pause(): void {
    this.isPausedState = true;
    logger.queue('Task queue paused.');
  }

  /**
   * Clears pending tasks from the queue.
   */
  public clear(): void {
    this.clearEpoch++;
    this.pendingCount = 0;
    this.tail = Promise.resolve();
    logger.queue('Task queue cleared.');
  }

  /**
   * Waits until all currently executing and pending tasks are finished.
   */
  public async onIdle(): Promise<void> {
    await this.tail;
  }
}

export const automationQueue = new AutomationQueue();
