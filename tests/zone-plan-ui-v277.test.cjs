'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { productionContext, extractFunction } = require('./production-harness.cjs');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('compact Plan picker keeps both calculation modes and accessible label without explanatory text', () => {
  const ctx = productionContext(['summaryZonePlanControlV276']);
  for (const mode of ['central', 'imported']) {
    const markup = ctx.summaryZonePlanControlV276(mode);
    assert.match(markup, /aria-label="ฐาน Plan ของ Session"/);
    assert.match(markup, /onchange="setSummaryZonePlanModeV276\(this.value\)"/);
    assert.match(markup, new RegExp(`value="${mode}" selected`));
    assert.equal((markup.match(/<option /g) || []).length, 2);
    assert.doesNotMatch(markup, /<label|<small|<span|รวม|Plan Location เดิม|1 งาน =|จำตัวเลือก/);
  }
});

test('Plan picker renders beside the Zone picker in the same heading action group', () => {
  assert.match(html, /<div class="summary-zone-heading-actions-v128">\s*\$\{zoneSelectorHtml\}\s*\$\{summaryZonePlanControlV276\(zonePlanModeV276\)\}\s*<\/div>/);
  assert.equal((html.match(/\$\{summaryZonePlanControlV276\(/g) || []).length, 1);
});

test('this UI-only revision leaves V2.76 calculation and Session preference functions unchanged', () => {
  const baseline = fs.readFileSync(path.join(__dirname, '../../../outputs/Cycle_Count_V2.76.html'), 'utf8');
  for (const name of ['buildSummaryZoneProgressV276', 'summaryZonePlanModeV276', 'setSummaryZonePlanModeV276']) {
    assert.ok(baseline.includes(extractFunction(name).code), `${name} must retain its exact calculation logic`);
  }
});
