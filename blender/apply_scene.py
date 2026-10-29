# The one Python file (AGENTS.md): applies a fully resolved scene.json to a
# fresh Blender scene and renders it. Every value comes from the file, which
# schemas/blender-scene.schema.json closes; this file makes bpy calls in
# order and takes no decision, does no arithmetic and knows no default.
# Run by src/lanes/blender/ as
#   blender.exe -b --factory-startup --disable-autoexec -noaudio --offline-mode
#     --gpu-backend <opengl|vulkan> --python-exit-code 3 -P blender/apply_scene.py -- <scene.json> <outdir>
# A Python exception exits 3 (ADR 0004 decision 7). One comment per bpy call.

import json
import sys

import bpy
from mathutils import Quaternion, Vector

# The two arguments after "--": the scene file and the frames directory.
scene_path = sys.argv[-2]
frames_dir = sys.argv[-1]

with open(scene_path, encoding="utf-8") as handle:
    doc = json.load(handle)

# Reset to the factory scene so nothing from a user file or a previous run survives.
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
# Keep the cycles add-on enabled after the reset so its engine and preferences exist.
bpy.ops.preferences.addon_enable(module="cycles")

# New keyframes interpolate linearly, as ADR 0004 decision 8 asks.
bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"


def vector(value):
    # A schema Vector as a Blender Vector.
    return Vector((value["x"], value["y"], value["z"]))


def quaternion(value):
    # A schema Quaternion (w, x, y, z) as a Blender Quaternion.
    return Quaternion((value["w"], value["x"], value["y"], value["z"]))


def rgb(value):
    # A schema LinearRgb as a three-tuple.
    return (value["r"], value["g"], value["b"])


def rgba(value):
    # A schema LinearRgb as a four-tuple with full alpha, which colour sockets take.
    return (value["r"], value["g"], value["b"], 1.0)


# ---- output -----------------------------------------------------------------
output = doc["output"]
# The frames are written as <outdir>/<stem><frame>.png.
scene.render.filepath = frames_dir.rstrip("/") + "/" + output["fileStem"]
# The media type must be set before the file format on 5.x.
scene.render.image_settings.media_type = "IMAGE"
# PNG frames.
scene.render.image_settings.file_format = "PNG"
# Three channels, no alpha.
scene.render.image_settings.color_mode = "RGB"
# Bits per channel.
scene.render.image_settings.color_depth = output["colorDepth"]
# Frame range and rate.
scene.frame_start = output["frameStart"]
scene.frame_end = output["frameEnd"]
scene.render.fps = output["fps"]
scene.render.fps_base = 1.0
# Size at 100 percent.
scene.render.resolution_x = output["width"]
scene.render.resolution_y = output["height"]
scene.render.resolution_percentage = 100
# The background is part of the picture.
scene.render.film_transparent = False

# ---- render engine ------------------------------------------------------------
render = doc["render"]
# The engine the attempt ladder chose.
scene.render.engine = render["engine"]
# EEVEE samples (set for both engines; Cycles ignores it).
scene.eevee.taa_render_samples = render["eeveeSamples"]
cycles = render["cycles"]
# Cycles samples and denoising (set for both engines; EEVEE ignores them).
scene.cycles.samples = cycles["samples"]
scene.cycles.use_denoising = cycles["useDenoising"]
scene.cycles.denoiser = cycles["denoiser"]
scene.cycles.device = cycles["device"]
cycles_preferences = bpy.context.preferences.addons["cycles"].preferences
# The compute backend of the GPU devices.
cycles_preferences.compute_device_type = cycles["computeDeviceType"]
# Re-read the device list for that backend.
cycles_preferences.refresh_devices()
for device in cycles_preferences.devices:
    # A device is used when the scene lists its type; the list is the decision, made in TypeScript.
    device.use = device.type in cycles["deviceTypes"]
motion_blur = render["motionBlur"]
# Motion blur across the shutter window (shared by both engines).
scene.render.use_motion_blur = motion_blur["enabled"]
scene.render.motion_blur_shutter = motion_blur["shutter"]

# ---- colour management ----------------------------------------------------------
color_management = doc["colorManagement"]
# sRGB display, the chosen view transform, no look, the exposure in EV.
scene.display_settings.display_device = "sRGB"
scene.view_settings.view_transform = color_management["viewTransform"]
scene.view_settings.look = "None"
scene.view_settings.exposure = color_management["exposure"]
scene.view_settings.gamma = 1.0

# ---- world ----------------------------------------------------------------------
world_doc = doc["world"]
# A fresh world with nodes.
world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
world_nodes = world.node_tree.nodes
world_links = world.node_tree.links
background_node = world_nodes["Background"]
# The background colour and its strength.
background_node.inputs["Color"].default_value = rgba(world_doc["color"])
background_node.inputs["Strength"].default_value = world_doc["strength"]
for hdri_path in [path for path in [world_doc["hdriPath"]] if path]:
    # The HDRI image, loaded once.
    image = bpy.data.images.load(hdri_path)
    # An environment texture node showing it.
    environment_node = world_nodes.new("ShaderNodeTexEnvironment")
    environment_node.image = image
    # A mapping node turning it about Z.
    mapping_node = world_nodes.new("ShaderNodeMapping")
    mapping_node.inputs["Rotation"].default_value = (0.0, 0.0, world_doc["hdriRotationZRad"])
    # Texture coordinates feeding the mapping.
    coordinates_node = world_nodes.new("ShaderNodeTexCoord")
    world_links.new(coordinates_node.outputs["Generated"], mapping_node.inputs["Vector"])
    world_links.new(mapping_node.outputs["Vector"], environment_node.inputs["Vector"])
    # The HDRI replaces the plain colour at its own strength.
    world_links.new(environment_node.outputs["Color"], background_node.inputs["Color"])
    background_node.inputs["Strength"].default_value = world_doc["hdriStrength"]

# ---- camera ---------------------------------------------------------------------
camera_doc = doc["camera"]
# The camera data and object.
camera_data = bpy.data.cameras.new("camera")
camera_object = bpy.data.objects.new("camera", camera_data)
scene.collection.objects.link(camera_object)
scene.camera = camera_object
# A 36 mm sensor on the larger axis.
camera_data.sensor_fit = "AUTO"
camera_data.sensor_width = camera_doc["sensorWidthMm"]
camera_data.lens_unit = "MILLIMETERS"
camera_data.clip_start = camera_doc["clipStartM"]
camera_data.clip_end = camera_doc["clipEndM"]
camera_data.dof.use_dof = camera_doc["useDof"]
camera_object.rotation_mode = "QUATERNION"
for keyframe in camera_doc["keyframes"]:
    # Position, orientation, lens and focus at this frame.
    camera_object.location = vector(keyframe["location"])
    camera_object.keyframe_insert(data_path="location", frame=keyframe["frame"])
    camera_object.rotation_quaternion = quaternion(keyframe["rotationQuaternion"])
    camera_object.keyframe_insert(data_path="rotation_quaternion", frame=keyframe["frame"])
    camera_data.lens = keyframe["lensMm"]
    camera_data.keyframe_insert(data_path="lens", frame=keyframe["frame"])
    camera_data.dof.aperture_fstop = keyframe["fStop"]
    camera_data.dof.keyframe_insert(data_path="aperture_fstop", frame=keyframe["frame"])
    camera_data.dof.focus_distance = keyframe["focusDistanceM"]
    camera_data.dof.keyframe_insert(data_path="focus_distance", frame=keyframe["frame"])

# ---- materials ------------------------------------------------------------------
materials = {}
for material_doc in doc["materials"]:
    # A node material whose Principled BSDF takes every socket from the file.
    material = bpy.data.materials.new(material_doc["name"])
    material.use_nodes = True
    principled = material.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = rgba(material_doc["baseColor"])
    principled.inputs["Metallic"].default_value = material_doc["metallic"]
    principled.inputs["Roughness"].default_value = material_doc["roughness"]
    principled.inputs["IOR"].default_value = material_doc["ior"]
    principled.inputs["Transmission Weight"].default_value = material_doc["transmission"]
    principled.inputs["Coat Weight"].default_value = material_doc["coatWeight"]
    principled.inputs["Coat Roughness"].default_value = material_doc["coatRoughness"]
    principled.inputs["Emission Color"].default_value = rgba(material_doc["emissionColor"])
    principled.inputs["Emission Strength"].default_value = material_doc["emissionStrength"]
    materials[material_doc["name"]] = material

# ---- empties ---------------------------------------------------------------------
empties = {}
for empty_doc in doc["empties"]:
    # An empty at its location, turning about Z when keyframed.
    empty = bpy.data.objects.new(empty_doc["name"], None)
    scene.collection.objects.link(empty)
    empty.location = vector(empty_doc["location"])
    empty.rotation_mode = "XYZ"
    for keyframe in empty_doc["rotationZKeyframes"]:
        empty.rotation_euler = (0.0, 0.0, keyframe["radians"])
        empty.keyframe_insert(data_path="rotation_euler", frame=keyframe["frame"])
    empties[empty_doc["name"]] = empty

# ---- objects ---------------------------------------------------------------------
primitive_operators = {
    "cube": lambda item: bpy.ops.mesh.primitive_cube_add(size=item["sizeM"]),
    "cylinder": lambda item: bpy.ops.mesh.primitive_cylinder_add(radius=item["radiusM"], depth=item["depthM"], vertices=item["vertices"]),
    "uv-sphere": lambda item: bpy.ops.mesh.primitive_uv_sphere_add(radius=item["radiusM"], segments=item["vertices"], ring_count=item["vertices"]),
    "torus": lambda item: bpy.ops.mesh.primitive_torus_add(major_radius=item["majorRadiusM"], minor_radius=item["minorRadiusM"], major_segments=item["vertices"], minor_segments=item["vertices"]),
    "plane": lambda item: bpy.ops.mesh.primitive_plane_add(size=item["sizeM"]),
}


def add_mesh_object(item):
    # An explicit mesh from the file's vertices and faces.
    mesh = bpy.data.meshes.new(item["name"])
    mesh.from_pydata([vector(point) for point in item["meshVertices"]], [], item["meshFaces"])
    mesh.update()
    mesh_object = bpy.data.objects.new(item["name"], mesh)
    scene.collection.objects.link(mesh_object)
    bpy.context.view_layer.objects.active = mesh_object


creators = dict(primitive_operators)
creators["mesh"] = add_mesh_object

for object_doc in doc["objects"]:
    # The object through its creator; the active object is then the new one.
    creators[object_doc["kind"]](object_doc)
    scene_object = bpy.context.view_layer.objects.active
    scene_object.name = object_doc["name"]
    scene_object.location = vector(object_doc["location"])
    scene_object.rotation_mode = "XYZ"
    scene_object.rotation_euler = vector(object_doc["rotationEulerRad"])
    scene_object.scale = vector(object_doc["scale"])
    # Its material.
    scene_object.data.materials.append(materials[object_doc["material"]])
    # Smooth or flat shading on every face.
    for polygon in scene_object.data.polygons:
        polygon.use_smooth = object_doc["shadeSmooth"]
    for parent_name in [name for name in [object_doc["parent"]] if name]:
        # Parented to the named empty, keeping its own location as the local offset.
        scene_object.parent = empties[parent_name]

# ---- lights ------------------------------------------------------------------------
for light_doc in doc["lights"]:
    # An area light with the cookbook's shape, size, power and colour.
    light_data = bpy.data.lights.new(light_doc["name"], "AREA")
    light_data.shape = light_doc["shape"]
    light_data.size = light_doc["sizeM"]
    light_data.size_y = light_doc["sizeYM"]
    light_data.energy = light_doc["powerW"]
    light_data.use_temperature = light_doc["useTemperature"]
    light_data.temperature = light_doc["temperatureK"]
    light_data.color = rgb(light_doc["color"])
    light_object = bpy.data.objects.new(light_doc["name"], light_data)
    scene.collection.objects.link(light_object)
    light_object.rotation_mode = "QUATERNION"
    light_object.location = vector(light_doc["location"])
    light_object.rotation_quaternion = quaternion(light_doc["rotationQuaternion"])
    for keyframe in light_doc["locationKeyframes"]:
        # The light's position and aim at this frame (the light sweep).
        light_object.location = vector(keyframe["location"])
        light_object.keyframe_insert(data_path="location", frame=keyframe["frame"])
        light_object.rotation_quaternion = quaternion(keyframe["rotationQuaternion"])
        light_object.keyframe_insert(data_path="rotation_quaternion", frame=keyframe["frame"])

# ---- render -------------------------------------------------------------------------
# Every frame of the range, to the files named above.
bpy.ops.render.render(animation=True, write_still=False)
sys.stdout.flush()
