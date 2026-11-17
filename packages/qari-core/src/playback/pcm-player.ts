/** Plays mono PCM through one AudioContext on the main thread. */
export class PcmPlayer {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private finishCurrent: (() => void) | null = null;
  private startedAt = 0;
  private offset = 0;

  /** Creates or resumes the AudioContext; call synchronously inside the user's click so Safari allows playback. */
  unlock(): void {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
  }

  /** Plays samples, from `from` seconds in (default 0), and resolves when they finish or stop() is called. */
  async play(pcm: Float32Array<ArrayBuffer>, sampleRate: number, from = 0): Promise<void> {
    this.stop();
    this.unlock();
    const context = this.context as AudioContext;
    // AudioBuffer accepts the voice's own rate; the context resamples to the device rate.
    const buffer = context.createBuffer(1, pcm.length, sampleRate);
    buffer.copyToChannel(pcm, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.source = source;
    await new Promise<void>((resolve) => {
      this.finishCurrent = resolve;
      source.onended = () => resolve();
      this.offset = Math.min(Math.max(from, 0), buffer.duration);
      this.startedAt = context.currentTime;
      source.start(0, this.offset);
    });
    if (this.source === source) this.source = null;
  }

  /**
   * Seconds into the sound that is playing now, as heard (output latency taken off where the browser reports it);
   * null when nothing is playing.
   */
  position(): number | null {
    if (!this.source || !this.context) return null;
    // Heard time only starts once the output delay has passed, so a jump starts exactly at its offset, never before it.
    return this.offset + Math.max(0, this.context.currentTime - this.startedAt - (this.context.outputLatency || 0));
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      }
      catch {
        // Already stopped.
      }
      source.disconnect();
    }
    this.finishCurrent?.();
    this.finishCurrent = null;
  }

  async close(): Promise<void> {
    this.stop();
    await this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
