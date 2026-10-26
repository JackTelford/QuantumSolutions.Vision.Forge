/**
 * Probe P7: which hosts do the allowlisted download URLs redirect to?
 *
 * The network allowlist must name every host a download actually touches.
 * This probe sends HEAD requests with manual redirect handling and records
 * each hop, so the allowlist can be written as (initial host, redirect hosts).
 * Nothing is downloaded beyond response headers.
 */
import { EvidenceReport } from './lib.ts';

interface Target {
  readonly label: string;
  readonly url: string;
  readonly why: string;
}

const targets: readonly Target[] = [
  {
    label: 'Hugging Face pinned Kokoro file',
    url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/onnx/model_quantized.onnx',
    why: 'narration weights (M6)',
  },
  {
    label: 'Hugging Face small config file',
    url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/config.json',
    why: 'small files may be served without the CDN hop',
  },
  {
    label: 'Poly Haven API',
    url: 'https://api.polyhaven.com/assets?t=hdris',
    why: 'asset catalogue',
  },
  {
    label: 'Poly Haven file listing',
    url: 'https://api.polyhaven.com/files/studio_small_09',
    why: 'per-asset file list with md5',
  },
  {
    label: 'Poly Haven download host',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
    why: 'HDRI bytes',
  },
  {
    label: 'GitHub raw font file',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt',
    why: 'OFL fonts and license text',
  },
  {
    label: 'GitHub "raw" link on github.com',
    url: 'https://github.com/google/fonts/raw/main/ofl/inter/OFL.txt',
    why: 'github.com redirects raw links elsewhere',
  },
  {
    label: 'GitHub release asset',
    url: 'https://github.com/microsoft/onnxruntime/releases/download/v1.21.0/onnxruntime-win-x64-1.21.0.zip',
    why: 'release downloads redirect to a storage host',
  },
  {
    label: 'npm registry tarball',
    url: 'https://registry.npmjs.org/three/-/three-0.186.1.tgz',
    why: 'npm tarballs',
  },
];

interface Hop {
  readonly url: string;
  readonly status: number;
  readonly host: string;
  readonly location: string;
  readonly contentLength: string;
  readonly etag: string;
}

async function followHead(url: string, maxHops: number): Promise<Hop[]> {
  const hops: Hop[] = [];
  let current = url;
  for (let i = 0; i < maxHops; i += 1) {
    const response = await fetch(current, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'User-Agent': 'vision-forge-probe/0.0.0 (+https://github.com/JackTelford/QuantumSolutions.Vision.Forge)' },
      signal: AbortSignal.timeout(20_000),
    });
    const location = response.headers.get('location') ?? '';
    hops.push({
      url: current,
      status: response.status,
      host: new URL(current).host,
      location,
      contentLength: response.headers.get('content-length') ?? response.headers.get('x-linked-size') ?? '',
      etag: response.headers.get('x-linked-etag') ?? response.headers.get('etag') ?? '',
    });
    if (response.status >= 300 && response.status < 400 && location.length > 0) {
      current = new URL(location, current).toString();
      continue;
    }
    break;
  }
  return hops;
}

/** Runs the probe and writes docs/evidence/m0/p7-redirects.md. */
export async function run(): Promise<void> {
  const report = new EvidenceReport('p7-redirects', 'P7: redirect hosts behind the allowlisted download URLs');
  report.paragraph('HEAD requests with manual redirect handling, at most 5 hops, 20 s timeout each. Only headers are read.');
  const rows: string[][] = [];
  const hostsByOrigin = new Map<string, Set<string>>();
  for (const target of targets) {
    let hops: Hop[] = [];
    let failure = '';
    try {
      hops = await followHead(target.url, 5);
    } catch (error: unknown) {
      failure = error instanceof Error ? error.message : String(error);
    }
    const origin = new URL(target.url).host;
    const seen = hostsByOrigin.get(origin) ?? new Set<string>();
    for (const hop of hops) seen.add(hop.host);
    hostsByOrigin.set(origin, seen);
    const chain = hops.map((h) => `${h.host} → ${h.status}`).join(' ; ');
    const last = hops[hops.length - 1];
    rows.push([
      target.label,
      origin,
      failure.length > 0 ? `FAILED: ${failure}` : chain,
      last === undefined ? '' : last.contentLength,
      last === undefined ? '' : last.etag.slice(0, 20),
      target.why,
    ]);
  }
  report.heading('Hops per target');
  report.table(['Target', 'Initial host', 'Hop chain (host → status)', 'Size', 'ETag/linked', 'Why'], rows);
  report.heading('Hosts touched per initial host');
  report.table(['Initial host', 'All hosts in chain'], [...hostsByOrigin.entries()].map(([origin, hosts]) => [origin, [...hosts].join(', ')]));
  report.unverified('Redirect targets can change over time; the allowlist should match wildcard subdomains per initial host and the downloader must log every hop.');
  const path = report.write();
  process.stdout.write(`wrote ${path}\n`);
}
