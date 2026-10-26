# P3: TypeScript served to the browser with an import map

Generated 2026-10-26T20:15:29.192Z by `node scripts/probes/run.ts p3-tsserve`.

Static server on http://127.0.0.1:56560: `.ts` files are stripped with `node:module` `stripTypeScriptTypes` and served as `text/javascript` with `nosniff`; `/vendor/three/` maps to the real `node_modules/three` directory.

## Server behavior

| Check | Result |
| --- | --- |
| GET /site/app/main.ts content-type | text/javascript; charset=utf-8 |
| stripped output keeps .ts specifiers | true |
| stripped output erases import type | true |
| path traversal /site/..%2F..%2Fpackage.json | 404 |
| ExperimentalWarning from stripTypeScriptTypes | stripTypeScriptTypes is an experimental feature and might change at any time |

## Browser results

| Channel | Version | Case | document.title | Time | Errors |
| --- | --- | --- | --- | --- | --- |
| msedge | 156.0.4314.42 | http import map + real three | OK 1 r186 function function | 193 ms | none |
| msedge | 156.0.4314.42 | file:// module load | loading |  | console: Access to script at 'file:///C:/site/app/main.ts' from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol schemes: chrome-experimental-site-token-provider, chrome-extension, chrome-untrusted, data, edge, http, https, isolated-app. \| console: Failed to load resource: net::ERR_FAILED |
| msedge | 156.0.4314.42 | decorator through strip-on-serve | loading |  | pageerror: Invalid or unexpected token |
| chrome | 156.0.8078.47 | http import map + real three | OK 1 r186 function function | 380 ms | none |
| chrome | 156.0.8078.47 | file:// module load | loading |  | console: Access to script at 'file:///C:/site/app/main.ts' from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol schemes: chrome, chrome-experimental-site-token-provider, chrome-extension, chrome-untrusted, data, http, https, isolated-app. \| console: Failed to load resource: net::ERR_FAILED |
| chrome | 156.0.8078.47 | decorator through strip-on-serve | loading |  | pageerror: Invalid or unexpected token |

## Conclusion

Every available channel executed shared TypeScript stripped on the fly and imported three plus two addons through the import map.

Probe site: `.tmp\p3\site`.

## Not verified

- The harness server will run as its own child process with --disable-warning=ExperimentalWarning; this probe ran the server in-process to capture the warning.
