/**
 * The shared axis mapping (src/shared/camera/blender-axes.ts) as the
 * document writes it. The mapping negates one component, so a shared
 * z of 0 becomes a negative zero; JSON has no negative zero and writes
 * it as 0, which would make the file differ from the document in memory
 * and a strict comparison of the two fail. Adding 0 to every component
 * turns a negative zero into zero and changes nothing else. Pure.
 */
import { blenderQuaternionFields, toBlenderQuaternion, toBlenderVector } from '../../shared/camera/blender-axes.ts';
import type { Quaternion as SharedQuaternion, Vector3 } from '../../shared/camera/types.ts';
import type { Quaternion, Vector } from '../../shared/contracts/blender-scene.ts';

/** A number with a negative zero turned into zero. */
function plain(value: number): number {
  return value + 0;
}

/** A shared-world point or direction in Blender's axes, written as the document holds it. */
export function blenderPoint(point: Vector3): Vector {
  const mapped = toBlenderVector(point);
  return { x: plain(mapped.x), y: plain(mapped.y), z: plain(mapped.z) };
}

/** A shared-world orientation in Blender's axes and (w, x, y, z) field order, written as the document holds it. */
export function blenderRotation(rotation: SharedQuaternion): Quaternion {
  const mapped = blenderQuaternionFields(toBlenderQuaternion(rotation));
  return { w: plain(mapped.w), x: plain(mapped.x), y: plain(mapped.y), z: plain(mapped.z) };
}
