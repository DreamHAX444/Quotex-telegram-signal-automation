import type { AutomationTask, ExecutionResult, TradeSignal } from './types.js';
import { logger } from './logger.js';
import { systemEvents } from './events.js';

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
    
    systemEvents.emit('queue:update', this.getStats());
    systemEvents.emit('task:queued', task);

    const epoch = this.clearEpoch;

    const executionPromise = this.tail.then(async () => {
      if (this.isPausedState || epoch !== this.clearEpoch) {
        this.pendingCount--;
        systemEvents.emit('queue:update', this.getStats());
        return { success: false, signal: task.signal, durationMs: 0, error: 'Cancelled' };
      }
      
      logger.queue(`Executing queued task [${task.id}]`);
      systemEvents.emit('task:start', task);

      try {
        const result = await runner(task.signal);
        return result;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`Task [${task.id}] runner threw exception`, err);
        return { success: false, signal: task.signal, durationMs: 0, error: errorMsg };
      } finally {
        this.pendingCount--;
        systemEvents.emit('queue:update', this.getStats());
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
    systemEvents.emit('queue:update', this.getStats());
  }

  /**
   * Resumes incoming execution in the queue.
   */
  public resume(): void {
    this.isPausedState = false;
    logger.queue('Task queue resumed.');
    systemEvents.emit('queue:update', this.getStats());
  }

  /**
   * Clears pending tasks from the queue.
   */
  public clear(): void {
    this.clearEpoch++;
    this.pendingCount = 0;
    this.tail = Promise.resolve();
    logger.queue('Task queue cleared.');
    systemEvents.emit('queue:update', this.getStats());
  }

  /**
   * Waits until all currently executing and pending tasks are finished.
   */
  public async onIdle(): Promise<void> {
    await this.tail;
  }
}

export const automationQueue = new AutomationQueue();
