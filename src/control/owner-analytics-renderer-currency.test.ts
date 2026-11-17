import { describe, expect, it } from 'vitest';
import { ownerConsole, ownerOverview } from './owner-console.js';
import type { PipelineSummary, RevenueSummary } from './owner-analytics.js';
const overview = () => ownerOverview('owner', 'a'.repeat(40), 1000, 901000);
const pipeline = (): PipelineSummary => ({ currency: 'EUR', currencies: ['EUR', 'USD'], stages: [{ stage: 'won', count: 1, valueMinor: 12345 }], leadCount: 1, wonValueMinor: 12345, conversionPercent: 100 });
const revenue = (): RevenueSummary => ({ currency: 'EUR', currencies: ['EUR', 'USD'], grossMinor: 12345, refundMinor: 0, feeMinor: 0, netMinor: 12345, eventCount: 1, byDay: [{ day: '2026-11-15', netMinor: 12345 }] });
const renderPipeline = (p: PipelineSummary) => ownerConsole(overview(), 'csrf', { view: 'pipeline' }, undefined, { configured: true, pipeline: p });
const renderRevenue = (r: RevenueSummary) => ownerConsole(overview(), 'csrf', { view: 'revenue' }, undefined, { configured: true, revenue: r });
describe('selected-currency analytics rendering', () => {
  it('formats pipeline stage and won value in EUR, never USD', () => {
    const html = renderPipeline(pipeline());
    expect(html.match(/EUR 123.45/g)).toHaveLength(2);
    expect(html).not.toContain('$123.45');
    expect(html).toContain('Counts, tracked values, and conversion apply only to leads in this currency');
    expect(html).toContain('Won value is not proof of payment');
  });
  it('discloses selected and excluded currencies in both panels', () => {
    for (const html of [renderPipeline(pipeline()), renderRevenue(revenue())]) {
      expect(html).toContain('Showing EUR only.');
      expect(html).toContain('Other recorded currencies excluded: USD.');
      expect(html).toContain('No currency conversion applied.');
    }
  });
  it('uses selected currency for revenue cards and chart', () => {
    const html = renderRevenue(revenue());
    expect(html.match(/EUR 123.45/g)).toHaveLength(3);
    expect(html).not.toContain('$123.45');
    expect(html).toContain('Totals, event count, and daily chart apply only to this currency');
  });
  it('suppresses money when pipeline currency is missing or malformed', () => {
    const { currency: _omitted, ...legacyPipeline } = pipeline();
    for (const html of [renderPipeline(legacyPipeline), renderPipeline({ ...pipeline(), currency: 'eur' }), renderPipeline({ ...pipeline(), currency: '<script>' })]) {
      expect(html).toContain('Currency unavailable');
      expect(html).not.toContain('123.45');
      expect(html).not.toContain('<script>');
    }
  });
  it('rejects inconsistent currency coverage in either panel', () => {
    expect(renderPipeline({ ...pipeline(), currencies: ['USD'] })).toContain('Currency unavailable');
    expect(renderRevenue({ ...revenue(), currencies: ['USD'] })).toContain('Currency unavailable');
  });
  it('does not present placeholder USD as an observed empty currency', () => {
    for (const html of [renderPipeline({ ...pipeline(), currency: 'USD', currencies: [] }), renderRevenue({ ...revenue(), currency: 'USD', currencies: [] })]) {
      expect(html).toContain('No observed currency.');
      expect(html).not.toContain('Showing USD');
      expect(html).not.toContain('123.45');
    }
  });
  it('discloses unknown coverage for legacy summaries', () => {
    const { currencies: _omittedP, ...legacyPipeline } = pipeline();
    const { currencies: _omittedR, ...legacyRevenue } = revenue();
    expect(renderPipeline(legacyPipeline)).toContain('Other-currency coverage is unavailable');
    expect(renderRevenue(legacyRevenue)).toContain('Other-currency coverage is unavailable');
  });
  it('preserves USD formatting for valid USD summaries', () => {
    expect(renderPipeline({ ...pipeline(), currency: 'USD', currencies: ['USD'] })).toContain('$123.45');
    expect(renderRevenue({ ...revenue(), currency: 'USD', currencies: ['USD'] })).toContain('$123.45');
  });
});
