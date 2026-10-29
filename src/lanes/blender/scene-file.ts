/**
 * Writes a resolved scene document beside the frames it will produce:
 * validated against schemas/blender-scene.schema.json first, so nothing
 * the applier cannot read reaches Blender, written atomically, and hashed
 * (the content hash of src/shared/sha256.ts) for the render manifest.
 */
import { join } from 'node:path';
import { writeJsonAtomic } from '../../fs/atomic-json.ts';
import { validateDocument } from '../../schema/validator.ts';
import type { BlenderScene } from '../../shared/contracts/blender-scene.ts';
import { contentHash } from '../../shared/sha256.ts';

/** The file name of the scene document inside its directory. */
export const sceneFileName = 'scene.json';

/** Where the scene document and the hash it carries end up. */
export interface WrittenScene {
  /** The absolute path of scene.json. */
  readonly path: string;
  /** The SHA-256 of the document's canonical JSON, 64 lowercase hex characters. */
  readonly hash: string;
}

/** Validates the scene, writes it as `<dir>/scene.json` atomically (creating the directory) and returns the path with the document's content hash. */
export async function writeSceneDocument(dir: string, scene: BlenderScene): Promise<WrittenScene> {
  validateDocument('blender-scene', scene);
  const path = join(dir, sceneFileName);
  writeJsonAtomic(path, scene);
  return { path, hash: await contentHash(scene) };
}
