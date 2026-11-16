import { describe, expect, it } from 'vitest';
import { commerceCss } from './commerce-ui.js';
import { ownerLayoutCss } from './owner-layout.js';

describe('commerce layout readability styles', () => {
  it('ships explicit summary grid and card primitives to commerce pages', () => {
    expect(commerceCss).toContain('.workspace .stat-grid{display:grid;');
    expect(commerceCss).toContain('.workspace .stat{min-width:0;background:var(--surface);');
    expect(commerceCss).toContain('grid-template-columns:repeat(2,minmax(0,1fr))');
  });
  it('protects table and evidence width instead of squeezing values into a narrow grid track', () => {
    expect(commerceCss).toContain('.workspace .table-wrap table{min-width:760px}');
    expect(commerceCss).toContain('.workspace td details{width:26rem;min-width:26rem;max-width:none}');
    expect(commerceCss).toContain('.workspace td details dl{display:block;margin:0}');
    expect(commerceCss).toContain('white-space:normal;word-break:normal;overflow-wrap:anywhere;line-height:1.5');
  });
  it('contains narrow-screen filters and a scrollable owner sidebar', () => {
    expect(ownerLayoutCss).toContain('@media(max-width:600px){.workspace .prospect-form{grid-template-columns:minmax(0,1fr)}');
    expect(ownerLayoutCss).toContain('.sidebar{overflow-y:auto}');
  });
});
