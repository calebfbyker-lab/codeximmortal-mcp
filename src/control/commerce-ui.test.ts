import { describe, expect, it } from 'vitest';
import { commerceCss, commercePage, assessmentDetails } from './commerce-ui.js';
import { prospectIntake } from './prospect-assistant.js';
describe('commercial workspace presentation', () => {
  it('uses the same shell, title and active navigation for both commercial pages', () => {
    for (const key of ['pipeline','orders'] as const) {
      const html = commercePage('Example <title>', key, '<p>trusted renderer content</p>');
      expect(html).toContain('<title>Example &lt;title&gt; | CodexImmortal</title>');
      expect(html).toContain('href="/assets/commerce.css"');
      expect(html).toContain('href="#main-content"');
      expect(html).toContain('id="main-content"');
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      expect(html).toContain('Local console');
    }
  });
  it('renders current assessments as fields and a draft instead of raw JSON', () => {
    const assessment = prospectIntake({ name: 'Synthetic', source: 'manual', need: 'Compare pricing changes <script>bad</script>' });
    const html = assessmentDetails(assessment.notes);
    expect(html).toContain('Expressed need'); expect(html).toContain('Suggested next step');
    expect(html).toContain('Response draft'); expect(html).toContain('Nothing has been sent');
    expect(html).not.toContain('<script>bad</script>'); expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('"schema":');
  });
  it('preserves legacy and unexpected notes as escaped expandable evidence', () => {
    for (const notes of ['<script>legacy</script>', '{"schema":"other","draft":"<img>"}', 'null']) {
      const html = assessmentDetails(notes);
      expect(html).toContain('<pre>'); expect(html).not.toContain('<script>legacy</script>');
      expect(html).not.toContain('<img>');
    }
  });
  it('includes narrow-screen, focus and reduced-motion rules without external assets', () => {
    expect(commerceCss).toContain('@media(max-width:800px)');
    expect(commerceCss).toContain(':focus-visible');
    expect(commerceCss).toContain('prefers-reduced-motion');
    expect(commerceCss).not.toContain('url(');
  });
});
