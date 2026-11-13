import { describe, expect, it } from 'vitest';
import { proposedServices } from '../agent-services/registry.js';
import { ownerConsole, ownerLogin, ownerOverview } from './owner-console.js';
const data = () => ownerOverview('owner', '43dba41dffc44295fca86cfdb43f8b166f265769', 1000, 901000);
describe('owner operational console rendering', () => {
  it('uses the registry and real process data rather than invented readiness', () => {
    expect(data().services).toEqual(proposedServices);
    expect(data().runtime.node).toBe(process.version);
    expect(data().runtime.rssBytes).toBeGreaterThan(0);
    expect(data().taskDispatch).toBe(false);
    expect(data().backlogBasis).toContain('not a fresh scan');
  });
  it('renders navigation, refresh, export and protected logout form', () => {
    const html = ownerConsole(data(), 'test-csrf', {});
    for (const text of ['Overview','Services','Blockers','Runtime','Refresh snapshot','Export snapshot JSON','action=/logout','name=csrf value="test-csrf"']) expect(html).toContain(text);
  });
  it('filters services and renders an explicit empty state', () => {
    const html = ownerConsole(data(), 'csrf', { view: 'services', q: 'document_extract' });
    expect(html).toContain('1 matching records'); expect(html).not.toContain('<code>codex_pricing_snapshot</code>');
    expect(ownerConsole(data(), 'csrf', { view: 'services', q: 'no-such-tool' })).toContain('No matching services');
  });
  it('offers expandable source-attributed blocker acceptance criteria', () => {
    const html = ownerConsole(data(), 'csrf', { view: 'blockers', q: 'Original-source' });
    expect(html).toContain('<details>'); expect(html).toContain('Acceptance criteria');
    expect(html).toContain('src/agent-services/snapshot-provider.ts');
  });
  it('escapes query and CSRF text instead of injecting HTML', () => {
    const html = ownerConsole(data(), '"><script>bad</script>', { view: 'services', q: '"><script>bad</script>' });
    expect(html).not.toContain('<script>bad</script>'); expect(html).toContain('&lt;script&gt;');
  });
  it('keeps failures in a usable login form without echoing passwords or raw error values', () => {
    expect(ownerLogin('unauthorized')).toContain('role=alert');
    expect(ownerLogin('private-marker')).not.toContain('private-marker');
    expect(ownerLogin()).toContain('autocomplete=current-password');
  });
});
