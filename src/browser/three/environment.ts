/**
 * The scene's environment map: the installed Poly Haven HDRI the spec
 * names (served by the harness under /assets/, loaded by three's
 * HDRLoader from the loopback server and nowhere else) run through a
 * PMREMGenerator, or three's RoomEnvironment when the shot has none. It
 * is awaited inside init, so render(frame) never loads anything.
 */
import { EquirectangularReflectionMapping, PMREMGenerator } from 'three';
import type { DataTexture, Scene, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { EnvironmentRef } from '../../shared/harness/protocol.ts';

/** Which environment the scene ended up with. */
export type EnvironmentSource = 'hdri' | 'room';

/** The blur of the room environment's PMREM, three's own example value. */
const roomEnvironmentSigma = 0.04;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Loads the HDRI (or builds the room), sets scene.environment and reports which; throws a sentence when the HDRI does not load. */
export async function installEnvironment(renderer: WebGLRenderer, scene: Scene, environment: EnvironmentRef | null): Promise<EnvironmentSource> {
  const pmrem = new PMREMGenerator(renderer);
  try {
    if (environment !== null) {
      let texture: DataTexture;
      try {
        texture = await new HDRLoader().loadAsync(environment.url);
      } catch (error: unknown) {
        throw new Error(`The environment map ${environment.id} at ${environment.url} did not load: ${messageOf(error)}`);
      }
      texture.mapping = EquirectangularReflectionMapping;
      scene.environment = pmrem.fromEquirectangular(texture).texture;
      texture.dispose();
      return 'hdri';
    }
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, roomEnvironmentSigma).texture;
    room.dispose();
    return 'room';
  } finally {
    // Frees the generator's own buffers; the prefiltered texture on the scene stays.
    pmrem.dispose();
  }
}
