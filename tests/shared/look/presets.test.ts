import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runSemanticChecks } from '../../../src/schema/checks/index.ts';
import { validateDocument } from '../../../src/schema/validator.ts';
import { contrastRatio } from '../../../src/shared/color/contrast.ts';
import { LookPresetValues } from '../../../src/shared/contracts/look-bible.ts';
import { lookPresetNames, lookPresets, neutralGrade, presetsCreatedAt } from '../../../src/shared/look/presets.ts';

const noDataDir = { dataDir: undefined };

describe('the seven look presets', () => {
  it('cover every LookPreset of the schema except custom, in the look bible\'s order', () => {
    assert.deepEqual([...lookPresetNames], LookPresetValues.filter((name) => name !== 'custom'));
    assert.deepEqual(Object.keys(lookPresets).sort(), [...lookPresetNames].sort());
  });

  for (const name of lookPresetNames) {
    const look = lookPresets[name];

    it(`${name} validates against the look-bible schema and passes every semantic check`, () => {
      validateDocument('look-bible', look);
      assert.deepEqual(runSemanticChecks('look-bible', look, noDataDir), []);
    });

    it(`${name}'s text reaches 4.5:1 over its background and over its surface`, () => {
      assert.ok(contrastRatio(look.palette.text, look.palette.background) >= 4.5, `over background: ${contrastRatio(look.palette.text, look.palette.background).toFixed(2)}`);
      assert.ok(contrastRatio(look.palette.text, look.palette.surface) >= 4.5, `over surface: ${contrastRatio(look.palette.text, look.palette.surface).toFixed(2)}`);
    });

    it(`${name} is named after itself and carries the fixed timestamp`, () => {
      assert.equal(look.id, name);
      assert.equal(look.preset, name);
      assert.equal(look.createdAt, presetsCreatedAt);
    });
  }

  it('reads the table\'s tone mapping: standard for the two graphic looks, agx for the five photographic ones', () => {
    assert.equal(lookPresets['studio-clean'].toneMapping, 'standard');
    assert.equal(lookPresets['paper-flat'].toneMapping, 'standard');
    for (const name of ['obsidian', 'warm-editorial', 'neon-tech', 'noir-title', 'sunset-gradient'] as const) assert.equal(lookPresets[name].toneMapping, 'agx');
  });

  it('gives paper-flat the grade that changes nothing', () => {
    assert.deepEqual(lookPresets['paper-flat'].grade, neutralGrade);
    assert.equal(neutralGrade.saturation, 1);
    assert.equal(neutralGrade.contrast, 1);
    assert.equal(neutralGrade.vignetteAmount, 0);
    assert.equal(neutralGrade.grainAmount, 0);
  });

  it('reads the table\'s lighting defaults and QA bands', () => {
    assert.equal(lookPresets.obsidian.lightingDefault, 'low-key');
    assert.equal(lookPresets['sunset-gradient'].lightingDefault, 'golden-hour');
    assert.deepEqual(lookPresets['noir-title'].qa, { yavgMin: 20, yavgMax: 50 });
    assert.deepEqual(lookPresets['studio-clean'].qa, { yavgMin: 170, yavgMax: 200 });
  });
});
