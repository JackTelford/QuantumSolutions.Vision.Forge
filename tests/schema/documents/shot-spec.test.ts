import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runSemanticChecks } from '../../../src/schema/checks/index.ts';
import { isJsonObject, schemaFor } from '../../../src/schema/schema-registry.ts';
import type { JsonObject } from '../../../src/schema/schema-registry.ts';
import { validateDocument } from '../../../src/schema/validator.ts';
import { mutated, schemaProblems, shotSpecExample } from './examples.ts';

const noDataDir = { dataDir: undefined };

describe('shot-spec documents', () => {
  it('the example validates against the schema and passes every semantic check', () => {
    validateDocument('shot-spec', shotSpecExample);
    assert.deepEqual(runSemanticChecks('shot-spec', shotSpecExample, noDataDir), []);
  });

  it('keeps RenderProfile, Shot.renderProfile and the render manifest profile the same shape', () => {
    const shot = schemaFor('shot-spec');
    const pick = (node: unknown): { readonly required: unknown; readonly properties: unknown } | undefined => (isJsonObject(node) ? { required: node['required'], properties: node['properties'] } : undefined);
    const defs = shot['$defs'] as JsonObject;
    const inline = ((defs['Shot'] as JsonObject)['properties'] as JsonObject)['renderProfile'];
    assert.ok(pick(inline) !== undefined, 'Shot.properties.renderProfile must be an object schema');
    assert.deepEqual(pick(inline), pick(defs['RenderProfile']));
    assert.deepEqual(pick(inline), pick((schemaFor('render-manifest')['properties'] as JsonObject)['renderProfile']));
  });

  it('accepts a shot with an asset subject, a narration event and a software render profile', () => {
    validateDocument('shot-spec', mutated(shotSpecExample, (copy) => {
      const shot = copy.shots[0];
      if (shot === undefined) return;
      shot.subject.assetId = 'model:bottle';
      shot.narrationEvent = 'n1';
      shot.renderProfile = { engine: 'cycles', backend: 'CPU', renderer: 'software' };
    }));
  });

  it('rejects a focal length outside the lens family and names /shots/0/lens/focalMm', () => {
    const problems = schemaProblems('shot-spec', mutated(shotSpecExample, (copy) => { (copy.shots[0]?.lens as { focalMm: number }).focalMm = 70; }));
    assert.deepEqual(problems, ['/shots/0/lens/focalMm: must be equal to one of the allowed values (allowed: 14, 18, 24, 28, 35, 50, 65, 85, 100, 135, 200)']);
  });

  it('rejects values outside their stated ranges, naming each path', () => {
    const problems = schemaProblems('shot-spec', mutated(shotSpecExample, (copy) => {
      const shot = copy.shots[1];
      if (shot === undefined) return;
      shot.dutchDegrees = 20;
      shot.lens.fStop = 1;
      shot.move.amplitude = 1.5;
      shot.lighting.kelvin = 500;
      shot.exposureOffsetEv = -3;
      shot.composition.headroomPct = 31;
      shot.atmosphere.haze = 2;
    }));
    assert.deepEqual(problems, [
      '/shots/1/dutchDegrees: must be <= 15',
      '/shots/1/lens/fStop: must be >= 1.4',
      '/shots/1/move/amplitude: must be <= 1',
      '/shots/1/lighting/kelvin: must be >= 1000',
      '/shots/1/exposureOffsetEv: must be >= -2',
      '/shots/1/composition/headroomPct: must be <= 30',
      '/shots/1/atmosphere/haze: must be <= 1',
    ]);
  });

  it('rejects a text box fraction above 1 and a negative stagger, naming /shots/2/text/0', () => {
    const problems = schemaProblems('shot-spec', mutated(shotSpecExample, (copy) => {
      const text = copy.shots[2]?.text[0];
      if (text === undefined) return;
      text.box.w = 1.2;
      text.staggerMs = -1;
    }));
    assert.deepEqual(problems, ['/shots/2/text/0/box/w: must be <= 1', '/shots/2/text/0/staggerMs: must be >= 0']);
  });

  it('rejects a render profile that is neither an object nor null, and a fractional end frame', () => {
    const problems = schemaProblems('shot-spec', mutated(shotSpecExample, (copy) => {
      (copy.shots[0] as { renderProfile: unknown }).renderProfile = 'hardware';
      (copy.shots[1]?.move as { endFrame: number }).endFrame = 80.5;
    }));
    assert.deepEqual(problems, ['/shots/0/renderProfile: must be object,null', '/shots/1/move/endFrame: must be integer,null']);
  });

  it('rejects a transition of zero frames and an unknown transition type', () => {
    const problems = schemaProblems('shot-spec', mutated(shotSpecExample, (copy) => {
      (copy.transitions[0] as { frames: number }).frames = 0;
      (copy.transitions[1] as { type: string }).type = 'star-wipe';
    }));
    assert.deepEqual(problems, [
      '/transitions/0/frames: must be >= 1',
      '/transitions/1/type: must be equal to one of the allowed values (allowed: cut, dissolve, fade-black, fade-white, wipe-left, wipe-right, wipe-up, wipe-down, slide-left, slide-right)',
    ]);
  });
});
