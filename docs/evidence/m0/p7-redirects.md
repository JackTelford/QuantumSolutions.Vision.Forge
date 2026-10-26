# P7: redirect hosts behind the allowlisted download URLs

Generated 2026-10-26T20:04:47.511Z by `node scripts/probes/run.ts p7-redirects`.

HEAD requests with manual redirect handling, at most 5 hops, 20 s timeout each. Only headers are read.

## Hops per target

| Target | Initial host | Hop chain (host → status) | Size | ETag/linked | Why |
| --- | --- | --- | --- | --- | --- |
| Hugging Face pinned Kokoro file | huggingface.co | huggingface.co → 302 ; us.aws.cdn.hf.co → 200 | 92361116 | "72db5d760d8920a2fbd | narration weights (M6) |
| Hugging Face small config file | huggingface.co | huggingface.co → 307 ; huggingface.co → 200 | 44 | "790faf216e7e3f490e7 | small files may be served without the CDN hop |
| Poly Haven API | api.polyhaven.com | api.polyhaven.com → 200 |  | W/"106abb-wfGmttITuR | asset catalogue |
| Poly Haven file listing | api.polyhaven.com | api.polyhaven.com → 200 |  | W/"758-2e0rP/ZVw3wYU | per-asset file list with md5 |
| Poly Haven download host | dl.polyhaven.org | dl.polyhaven.org → 200 | 1615248 |  | HDRI bytes |
| GitHub raw font file | raw.githubusercontent.com | raw.githubusercontent.com → 200 | 1953 | W/"f3140e10635b304bd | OFL fonts and license text |
| GitHub "raw" link on github.com | github.com | github.com → 302 ; raw.githubusercontent.com → 200 | 1953 | W/"f3140e10635b304bd | github.com redirects raw links elsewhere |
| GitHub release asset | github.com | github.com → 302 ; release-assets.githubusercontent.com → 200 | 72311515 | "0x8DD5DFF2B28A57A" | release downloads redirect to a storage host |
| npm registry tarball | registry.npmjs.org | registry.npmjs.org → 200 |  | "2750ecdea53e4b9c11e | npm tarballs |

## Hosts touched per initial host

| Initial host | All hosts in chain |
| --- | --- |
| huggingface.co | huggingface.co, us.aws.cdn.hf.co |
| api.polyhaven.com | api.polyhaven.com |
| dl.polyhaven.org | dl.polyhaven.org |
| raw.githubusercontent.com | raw.githubusercontent.com |
| github.com | github.com, raw.githubusercontent.com, release-assets.githubusercontent.com |
| registry.npmjs.org | registry.npmjs.org |

## Not verified

- Redirect targets can change over time; the allowlist should match wildcard subdomains per initial host and the downloader must log every hop.
