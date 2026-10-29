/**
 * A BrowserRenderer that writes solid-colour PNGs instead of launching a
 * browser: the colour comes from the frame number, so the frames are as
 * deterministic as the real ones. It records every capture request and
 * can be told to fail at a frame, which is how the render tests check
 * resumption and failure marking. Not a test file.
 */
import type { BrowserFingerprint, BrowserRenderer, CaptureRequest, CapturedFrame } from '../../src/harness/types.ts';
import type { RenderProfile } from '../../src/shared/contracts/shot-spec.ts';
import { frameColor, writeSolidPng } from './png.ts';

/** What the fake pretends to be. */
export interface FakeRendererOptions {
  readonly profile?: RenderProfile;
  readonly fingerprint?: BrowserFingerprint;
  /** Throw after this many frames of a capture have been written (0 fails before the first). */
  readonly failAfterFrames?: number;
}

/** The profile the fake reports unless told otherwise. */
export const fakeProfile: RenderProfile = { engine: 'chromium', backend: 'd3d11', renderer: 'hardware' };

/** The fingerprint the fake reports unless told otherwise. */
export const fakeFingerprint: BrowserFingerprint = { channel: 'msedge', version: '156.0.4314.42', args: ['--force-device-scale-factor=1', '--disable-lcd-text', '--use-angle=d3d11'], webglRenderer: 'ANGLE (fake)' };

/** The scripted renderer. */
export class FakeBrowserRenderer implements BrowserRenderer {
  readonly profile: RenderProfile;
  readonly fingerprint: BrowserFingerprint;
  /** Every capture request, in order. */
  readonly requests: CaptureRequest[] = [];
  /** Every frame actually written, in order, across all requests (a failing or stopped capture writes fewer than asked). */
  readonly landed: CapturedFrame[] = [];
  /** How many times close() was called. */
  closes = 0;
  private readonly failAfterFrames: number | undefined;

  constructor(options: FakeRendererOptions = {}) {
    this.profile = options.profile ?? fakeProfile;
    this.fingerprint = options.fingerprint ?? fakeFingerprint;
    this.failAfterFrames = options.failAfterFrames;
  }

  /** The frames of every request so far, flattened in order. */
  get capturedFrames(): readonly number[] {
    return this.requests.flatMap((request) => [...request.frames]);
  }

  /** Writes one PNG per requested frame at the spec's size and reports each as it lands. */
  async capture(request: CaptureRequest, signal: AbortSignal, onFrame?: (frame: CapturedFrame) => void): Promise<readonly CapturedFrame[]> {
    this.requests.push(request);
    const captured: CapturedFrame[] = [];
    for (const frame of request.frames) {
      if (signal.aborted) throw new Error('aborted');
      if (this.failAfterFrames !== undefined && captured.length >= this.failAfterFrames) throw new Error(`fake renderer failed at frame ${frame}`);
      const path = request.framePath(frame);
      writeSolidPng(path, request.spec.width, request.spec.height, frameColor(frame));
      const landed: CapturedFrame = { frame, path, screenshotMs: 1 + (frame % 3) };
      captured.push(landed);
      this.landed.push(landed);
      onFrame?.(landed);
      // A real screenshot is I/O, so the hashing in renderShot gets a whole event-loop turn between frames here too.
      await new Promise<void>((resolveTurn) => { setImmediate(resolveTurn); });
    }
    return captured;
  }

  /** Counts the close. */
  close(): Promise<void> {
    this.closes += 1;
    return Promise.resolve();
  }
}
