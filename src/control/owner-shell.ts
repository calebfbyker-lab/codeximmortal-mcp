/** Transitional adapter: keeps rendered owner pages consistent until all pages share one shell renderer. */
const TITLE = /(<meta name=viewport content="[^"]*">)([^<>]{1,200})(<link )/;
const HEADING = /<header class=topbar><h1>([^<>]{1,40})<\/h1>/;
const NAV = /(<nav\b[^>]*>)([\s\S]*?)(<\/nav>)/;
const ORDERS = /<a [^>]*href="?\/orders"?[^>]*>/;
const EXPORT_PRIMARY = '<a class="btn btn--primary" href="/api/overview?download=1">';
const EXPORT_SECONDARY = '<a class=btn href="/api/overview?download=1">';
const link = (href: string, label: string) => '<a href="' + href + '">' + label + '</a>';
const has = (html: string, href: string) => html.includes('href="' + href + '"') || html.includes('href=' + href + '>') || html.includes('href=' + href + ' ');

export function normalizeOwnerShell(html: string): string {
  let out = html;
  if (!out.includes('<title>')) {
    const heading = HEADING.exec(out);
    out = out.replace(TITLE, (_m, a: string, t: string, b: string) => {
      const text = t.trim();
      const name = text === 'Owner control' && heading ? heading[1][0].toUpperCase() + heading[1].slice(1) : text;
      return a + '<title>' + name + ' | CodexImmortal</title>' + b;
    });
  }
  out = out.split(EXPORT_PRIMARY).join(EXPORT_SECONDARY);
  return out.replace(NAV, (_m, open: string, inner: string, close: string) => {
    let body = inner;
    if (!has(body, '/orders')) body += link('/orders', 'Orders');
    if (!has(body, '/distribution')) {
      const match = ORDERS.exec(body);
      const anchor = link('/distribution', 'Distribution &amp; demand');
      body = match ? body.slice(0, match.index) + anchor + body.slice(match.index) : body + anchor;
    }
    return open + body + close;
  });
}
