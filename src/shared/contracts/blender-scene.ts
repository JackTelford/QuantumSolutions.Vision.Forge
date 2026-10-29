/** @generated from schemas/blender-scene.schema.json by scripts/gen-types.ts. Do not edit. */

/**
 * Bits per channel of the PNG frames, as Blender's color_depth names them.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "ColorDepth".
 */
export type ColorDepth = '8' | '16';
/**
 * The render engine identifier of Blender 5.x: BLENDER_EEVEE or CYCLES.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "BlenderEngine".
 */
export type BlenderEngine = 'BLENDER_EEVEE' | 'CYCLES';
/**
 * The Cycles denoiser: OPTIX on an RTX GPU, OPENIMAGEDENOISE elsewhere.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "Denoiser".
 */
export type Denoiser = 'OPTIX' | 'OPENIMAGEDENOISE';
/**
 * Whether Cycles renders on the CPU or on the enabled GPU devices.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "CyclesDevice".
 */
export type CyclesDevice = 'CPU' | 'GPU';
/**
 * The Cycles preferences' compute device type; NONE for a CPU render.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "ComputeDeviceType".
 */
export type ComputeDeviceType = 'NONE' | 'CUDA' | 'OPTIX' | 'HIP' | 'ONEAPI' | 'METAL';
/**
 * The view transform of the output: AgX for the agx tone mapping token, Standard for the standard token.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "ViewTransform".
 */
export type ViewTransform = 'AgX' | 'Standard';
/**
 * How an object is created: a Blender primitive operator (cube, cylinder, uv-sphere, torus, plane) or an explicit mesh from vertices and faces.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "ObjectKind".
 */
export type ObjectKind = 'cube' | 'cylinder' | 'uv-sphere' | 'torus' | 'plane' | 'mesh';
/**
 * The shape of an area light.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "LightShape".
 */
export type LightShape = 'RECTANGLE' | 'SQUARE' | 'DISK';

/**
 * A fully resolved Blender scene for one shot (ADR 0004): every object, material, light, camera keyframe and render setting as a value, in Blender's own units and axes (metres, Z up, degrees in rotation fields named so), so that blender/apply_scene.py makes bpy calls and takes no decision. Written by src/lanes/blender/ as scene.json beside the frames; the applier reads it and renders.
 */
export interface BlenderScene {
  /**
   * Document kind; always "blender-scene".
   */
  kind: 'blender-scene';
  /**
   * Version of this document kind; always 1.
   */
  version: 1;
  /**
   * The shot the scene renders, as the shot spec names it, for example "s01".
   */
  shotId: string;
  /**
   * Where and how the frames are written.
   */
  output: {
    /**
     * Absolute directory the PNG frames go to, with forward slashes, for example C:/vf/cache/<key>/frames.
     */
    directory: string;
    /**
     * The file name prefix Blender appends the four-digit frame number and .png to, for example "f" gives f0001.png for frame 1.
     */
    fileStem: string;
    /**
     * First Blender frame to render, 1 or more (Blender frame k + 1 is shot frame k), for example 1.
     */
    frameStart: number;
    /**
     * Last Blender frame to render, inclusive, at or above frameStart, for example 120.
     */
    frameEnd: number;
    /**
     * Frames per second of the scene's timeline, for example 30.
     */
    fps: number;
    /**
     * Frame width in pixels, for example 1920.
     */
    width: number;
    /**
     * Frame height in pixels, for example 1080.
     */
    height: number;
    colorDepth: ColorDepth;
  };
  /**
   * The engine and its sampling; both engines' settings are given so the applier sets them without choosing.
   */
  render: {
    engine: BlenderEngine;
    /**
     * EEVEE render samples (taa_render_samples), for example 64.
     */
    eeveeSamples: number;
    /**
     * Cycles sampling and the compute device.
     */
    cycles: {
      /**
       * Path-tracing samples per pixel, for example 128.
       */
      samples: number;
      /**
       * True to denoise the render.
       */
      useDenoising: boolean;
      denoiser: Denoiser;
      device: CyclesDevice;
      computeDeviceType: ComputeDeviceType;
      /**
       * The preference device types to enable, for example ["OPTIX", "CPU"]; every device whose type is listed is used.
       *
       * Items: A device type as Cycles names it, for example "OPTIX".
       */
      deviceTypes: string[];
    };
    /**
     * Motion blur across the shutter window.
     */
    motionBlur: {
      /**
       * True to render motion blur.
       */
      enabled: boolean;
      /**
       * Shutter time in frames: the shutter angle divided by 360, so 0.5 is a 180-degree shutter.
       */
      shutter: number;
    };
  };
  /**
   * The view transform and exposure of the output (ADR 0008 decision 2).
   */
  colorManagement: {
    viewTransform: ViewTransform;
    /**
     * Exposure in EV stops applied by the view, for example -0.3.
     */
    exposure: number;
  };
  /**
   * The world: a background colour and, optionally, an HDRI environment.
   */
  world: {
    color: LinearRgb;
    /**
     * Strength of the background colour's light, for example 0.2.
     */
    strength: number;
    /**
     * Absolute path of the .hdr environment image with forward slashes, or null for the plain colour.
     */
    hdriPath: string | null;
    /**
     * Strength of the environment image's light, for example 0.6.
     */
    hdriStrength: number;
    /**
     * Rotation of the environment about Blender's Z axis in radians (converted from degrees in TypeScript, since the applier does no arithmetic), for example 0.
     */
    hdriRotationZRad: number;
  };
  /**
   * The one camera, keyframed per frame from the shared camera model.
   */
  camera: {
    /**
     * Sensor width in millimetres with sensor_fit AUTO (the larger image axis), always 36.
     */
    sensorWidthMm: number;
    /**
     * Near clip distance in metres, for example 0.02.
     */
    clipStartM: number;
    /**
     * Far clip distance in metres, for example 100.
     */
    clipEndM: number;
    /**
     * True to render depth of field from the keyframed f-stop and focus distance.
     */
    useDof: boolean;
    /**
     * One keyframe per Blender frame from frameStart to frameEnd, in order; linear interpolation between them.
     */
    keyframes: CameraKeyframe[];
  };
  /**
   * Principled BSDF materials, created before the objects that name them.
   */
  materials: Material[];
  /**
   * Empties used as pivots (the turntable), created before the objects that name them as parent.
   */
  empties: Empty[];
  /**
   * The meshes in creation order: primitives from Blender's own operators and explicit meshes from vertices.
   */
  objects: SceneObject[];
  /**
   * Area lights, placed and keyframed in Blender's axes.
   */
  lights: AreaLight[];
}
/**
 * A colour in linear light, each channel 0 to 1 (Blender's colour sockets), for example red 0.8, green 0.6, blue 0.2.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "LinearRgb".
 */
export interface LinearRgb {
  /**
   * Red, 0 to 1 (an emission may exceed 1).
   */
  r: number;
  /**
   * Green, 0 to 1.
   */
  g: number;
  /**
   * Blue, 0 to 1.
   */
  b: number;
}
/**
 * The camera at one Blender frame.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "CameraKeyframe".
 */
export interface CameraKeyframe {
  /**
   * The Blender frame number, 1 or more.
   */
  frame: number;
  location: Vector;
  rotationQuaternion: Quaternion;
  /**
   * Focal length in millimetres, for example 85.
   */
  lensMm: number;
  /**
   * Aperture f-number, for example 2.8.
   */
  fStop: number;
  /**
   * Distance to the focus plane in metres, for example 1.2.
   */
  focusDistanceM: number;
}
/**
 * A point, offset, scale or XYZ Euler rotation (radians) in Blender's axes (X right, Y into the screen, Z up), in metres for positions and sizes, for example x 0, y -2.2, z 0.3.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "Vector".
 */
export interface Vector {
  /**
   * X component.
   */
  x: number;
  /**
   * Y component.
   */
  y: number;
  /**
   * Z component.
   */
  z: number;
}
/**
 * A unit rotation quaternion in Blender's (w, x, y, z) order, the same rotation the shared camera model bakes, mapped to Z up.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "Quaternion".
 */
export interface Quaternion {
  /**
   * Scalar part.
   */
  w: number;
  /**
   * X of the vector part.
   */
  x: number;
  /**
   * Y of the vector part.
   */
  y: number;
  /**
   * Z of the vector part.
   */
  z: number;
}
/**
 * One Principled BSDF material, every socket given.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "Material".
 */
export interface Material {
  /**
   * Unique material name, for example "body".
   */
  name: string;
  baseColor: LinearRgb;
  /**
   * Metallic, 0 to 1.
   */
  metallic: number;
  /**
   * Roughness, 0 to 1.
   */
  roughness: number;
  /**
   * Index of refraction, 1 or more, for example 1.45.
   */
  ior: number;
  /**
   * Transmission weight, 0 (opaque) to 1 (glass).
   */
  transmission: number;
  /**
   * Clearcoat weight, 0 to 1.
   */
  coatWeight: number;
  /**
   * Clearcoat roughness, 0 to 1.
   */
  coatRoughness: number;
  emissionColor: LinearRgb;
  /**
   * Emission strength, 0 for none.
   */
  emissionStrength: number;
}
/**
 * An empty object used as a pivot, with its rotation about Z keyframed.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "Empty".
 */
export interface Empty {
  /**
   * Unique object name, for example "turntable".
   */
  name: string;
  location: Vector;
  /**
   * The pivot's rotation about Z per Blender frame; empty when it never turns.
   */
  rotationZKeyframes: RotationZKeyframe[];
}
/**
 * A rotation about Z at one Blender frame.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "RotationZKeyframe".
 */
export interface RotationZKeyframe {
  /**
   * The Blender frame number.
   */
  frame: number;
  /**
   * Rotation about Z in radians, counter-clockwise seen from above (converted from degrees in TypeScript).
   */
  radians: number;
}
/**
 * One mesh object: a primitive from its operator parameters, or an explicit mesh from vertices and faces; every field is given for every kind and the applier passes the ones its kind reads.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "SceneObject".
 */
export interface SceneObject {
  /**
   * Unique object name, for example "body".
   */
  name: string;
  kind: ObjectKind;
  location: Vector;
  rotationEulerRad: Vector;
  scale: Vector;
  /**
   * Name of one of the scene's materials.
   */
  material: string;
  /**
   * Name of the empty the object is parented to, or null.
   */
  parent: string | null;
  /**
   * True to shade the mesh smooth.
   */
  shadeSmooth: boolean;
  /**
   * Radius in metres for a cylinder or a uv-sphere; 0 for other kinds.
   */
  radiusM: number;
  /**
   * Depth (height) in metres for a cylinder; 0 for other kinds.
   */
  depthM: number;
  /**
   * Segment count for a cylinder or a uv-sphere's segments; 3 or more for every kind (unused kinds pass 3).
   */
  vertices: number;
  /**
   * Major radius in metres for a torus; 0 for other kinds.
   */
  majorRadiusM: number;
  /**
   * Minor (tube) radius in metres for a torus; 0 for other kinds.
   */
  minorRadiusM: number;
  /**
   * Edge length in metres for a cube or a plane; 0 for other kinds.
   */
  sizeM: number;
  /**
   * The vertices of an explicit mesh, in metres relative to the object's location; empty for primitives.
   */
  meshVertices: Vector[];
  /**
   * The faces of an explicit mesh as lists of vertex indices into meshVertices, counter-clockwise seen from outside; empty for primitives.
   */
  meshFaces: number[][];
}
/**
 * One area light with its location keyframed when it moves (the light sweep).
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "AreaLight".
 */
export interface AreaLight {
  /**
   * Unique object name, for example "key".
   */
  name: string;
  shape: LightShape;
  /**
   * Width in metres.
   */
  sizeM: number;
  /**
   * Height in metres (read for RECTANGLE; given for every shape).
   */
  sizeYM: number;
  /**
   * Power in watts (Blender's energy), for example 150.
   */
  powerW: number;
  /**
   * True to colour the light by temperatureK (Blender's use_temperature); false to use color (a tinted rim).
   */
  useTemperature: boolean;
  /**
   * Colour temperature in kelvin, 800 to 12000 (Blender's range), for example 5600.
   */
  temperatureK: number;
  color: LinearRgb;
  location: Vector;
  rotationQuaternion: Quaternion;
  /**
   * The light's location per Blender frame when it moves; empty for a static light.
   */
  locationKeyframes: LocationKeyframe[];
}
/**
 * A location at one Blender frame.
 *
 * This interface was referenced by `BlenderScene`'s JSON-Schema
 * via the `definition` "LocationKeyframe".
 */
export interface LocationKeyframe {
  /**
   * The Blender frame number.
   */
  frame: number;
  location: Vector;
  rotationQuaternion: Quaternion;
}

/** Every ColorDepth value the schema allows, in schema order. */
export const ColorDepthValues = ['8', '16'] as const;

/** Every BlenderEngine value the schema allows, in schema order. */
export const BlenderEngineValues = ['BLENDER_EEVEE', 'CYCLES'] as const;

/** Every Denoiser value the schema allows, in schema order. */
export const DenoiserValues = ['OPTIX', 'OPENIMAGEDENOISE'] as const;

/** Every CyclesDevice value the schema allows, in schema order. */
export const CyclesDeviceValues = ['CPU', 'GPU'] as const;

/** Every ComputeDeviceType value the schema allows, in schema order. */
export const ComputeDeviceTypeValues = ['NONE', 'CUDA', 'OPTIX', 'HIP', 'ONEAPI', 'METAL'] as const;

/** Every ViewTransform value the schema allows, in schema order. */
export const ViewTransformValues = ['AgX', 'Standard'] as const;

/** Every LightShape value the schema allows, in schema order. */
export const LightShapeValues = ['RECTANGLE', 'SQUARE', 'DISK'] as const;

/** Every ObjectKind value the schema allows, in schema order. */
export const ObjectKindValues = ['cube', 'cylinder', 'uv-sphere', 'torus', 'plane', 'mesh'] as const;
