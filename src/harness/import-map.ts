/**
 * The import map every harness page carries, so that bare `three` imports,
 * including the addons' own, resolve to the served copy of the installed
 * package (ADR 0005).
 */
import { threeVendorPrefix } from './static-roots.ts';

/** Bare specifiers, or specifier prefixes ending in a slash, mapped to served URLs. */
export const importMap: { readonly imports: Readonly<Record<string, string>> } = {
  imports: {
    three: `${threeVendorPrefix}build/three.module.js`,
    'three/addons/': `${threeVendorPrefix}examples/jsm/`,
  },
};

/** The import map as JSON, two-space indented. */
export function importMapJson(): string {
  return JSON.stringify(importMap, null, 2);
}

/** The `<script type="importmap">` tag; it must come before the first module script of the page. */
export function importMapScriptTag(): string {
  return `<script type="importmap">\n${importMapJson()}\n</script>`;
}
