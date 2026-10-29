/**
 * The DirectML check of ADR 0007: onnxruntime-node ships DirectML.dll, a
 * proprietary Microsoft redistributable, and THIRD-PARTY.md says it is not
 * used on the CPU path. Node's diagnostic report lists every shared
 * library mapped into the process, so after one synthesis the list says
 * whether onnxruntime loaded it. The parsing is pure; `currentMappedLibraries`
 * is the one call into Node.
 */

/** The file name of the library the check looks for. */
export const directMlLibraryName = 'DirectML.dll';

/** The paths of the shared libraries a diagnostic report lists; an empty list when the report has none. */
export function mappedLibraries(report: unknown): readonly string[] {
  if (typeof report !== 'object' || report === null) return [];
  const shared = (report as { readonly sharedObjects?: unknown }).sharedObjects;
  if (!Array.isArray(shared)) return [];
  return shared.filter((entry): entry is string => typeof entry === 'string');
}

/** True when a library's file name is DirectML.dll, whatever its folder or case. */
export function isDirectMlMapped(libraries: readonly string[]): boolean {
  return libraries.some((path) => (path.split(/[\\/]/).pop() ?? '').toLowerCase() === directMlLibraryName.toLowerCase());
}

/** The libraries mapped into this process right now, from `process.report`; empty where the report is unavailable. */
export function currentMappedLibraries(): readonly string[] {
  const report = process.report;
  if (report === undefined) return [];
  return mappedLibraries(report.getReport());
}
