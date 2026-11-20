/**
 * Lightweight frame-timing monitor supporting 60Hz, 90Hz, and 120Hz+ displays
 * with zero-allocation ring buffering and adaptive DPR hints for low-end devices.
 */
export function isLowEndDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const cores = navigator.hardwareConcurrency ?? 8;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const lowCores = cores > 0 && cores <= 4;
  const lowMem = typeof mem === 'number' && mem > 0 && mem <= 4;
  const isCoarsePointer =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  return lowCores || lowMem || (isCoarsePointer && cores <= 6);
}

export function getInitialChartDpr(): number {
  if (typeof window === 'undefined') return 1;
  const raw = window.devicePixelRatio || 1;
  return Math.min(raw, 2.5);
}

export class PerformanceMonitor {
  private lastTimestamp = 0;
  private readonly maxSamples = 48;
  private readonly samples = new Float64Array(48);
  private writeIndex = 0;
  private sampleCount = 0;
  private sampleSum = 0;
  private fps = 60;

  public recordFrame(now: number): void {
    if (this.lastTimestamp > 0) {
      const delta = now - this.lastTimestamp;
      // Ignore long idle gaps between on-demand RAF bursts (> 120ms is idle pause, not slow rendering)
      if (delta > 0 && delta < 120) {
        if (this.sampleCount === this.maxSamples) {
          this.sampleSum -= this.samples[this.writeIndex];
        } else {
          this.sampleCount += 1;
        }
        this.samples[this.writeIndex] = delta;
        this.sampleSum += delta;
        this.writeIndex = (this.writeIndex + 1) % this.maxSamples;
        if (this.sampleSum > 0) {
          this.fps = Math.round(1000 / (this.sampleSum / this.sampleCount));
        }
      }
    }
    this.lastTimestamp = now;
  }

  /** Reset frame timestamp when resuming from idle/background so gaps don't skew delta */
  public markResumed(): void {
    this.lastTimestamp = 0;
  }

  public getCurrentFps(): number {
    return this.fps;
  }

  /** Keep full native canvas sharpness (never blur chart via DPR downgrade) */
  public shouldStepDownDpr(): boolean {
    return false;
  }

  public reset(): void {
    this.lastTimestamp = 0;
    this.writeIndex = 0;
    this.sampleCount = 0;
    this.sampleSum = 0;
    this.fps = 60;
  }
}
