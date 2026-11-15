import { describe, expect, it } from 'vitest';
import { assessmentDetails, commerceCss, commercePage } from './commerce-ui.js';
import { ownerLayoutCss } from './owner-layout.js';

describe('commercial workspace layout', () => {
  it('includes owner styling before the commercial shell adapters', () => {
    expect(commerceCss).toContain(ownerLayoutCss);
    expect(commerceCss.indexOf('/* commerce-layout-v1')).toBeGreaterThan(commerceCss.indexOf('/* owner-layout-v1'));
    expect(commerceCss).toContain('248px minmax(0,1fr)');
  });
  it.each(['orders','pipeline'] as const)('renders one active navigation item for %s', active => {
    const html = commercePage('Workspace', active, '<p>Content</p>');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('tabindex="-1"');
    const href = active === 'orders' ? '/orders' : '/?view=pipeline';
    expect(html).toContain('<a href="' + href + '" aria-current="page">');
  });
  it('escapes titles and descriptions while retaining trusted renderer output', () => {
    const html = commercePage('<unsafe>', 'orders', '<p>Trusted output</p>', { description: 'A "quoted" <description>' });
    expect(html).not.toContain('<unsafe>'); expect(html).toContain('&lt;unsafe&gt;');
    expect(html).toContain('&lt;description&gt;'); expect(html).toContain('&quot;quoted&quot;');
    expect(html).toContain('<p>Trusted output</p>');
  });
  it.each(['/orders','/?view=pipeline'] as const)('renders one refresh action for %s without scripts', refreshHref => {
    const html = commercePage('Workspace', 'orders', '<p>Content</p>', { refreshHref });
    expect(html.match(/>Refresh view<\/a>/g)).toHaveLength(1);
    expect(html).toContain('href="' + refreshHref + '">Refresh view</a>');
    expect(html).not.toContain('<script');
  });
  it('rejects unsupported refresh routes even if a caller bypasses TypeScript', () => {
    const options = { refreshHref: 'javascript:alert(1)' } as unknown as NonNullable<Parameters<typeof commercePage>[3]>;
    expect(() => commercePage('Workspace','orders','',options)).toThrow('invalid_commerce_refresh_route');
  });
  it('preserves escaping of recorded assessment evidence', () => {
    expect(assessmentDetails('<script>alert(1)</script>')).not.toContain('<script>');
    expect(assessmentDetails('<script>alert(1)</script>')).toContain('&lt;script&gt;');
  });
});
