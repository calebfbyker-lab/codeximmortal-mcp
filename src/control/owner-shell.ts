/** Transitional adapter: keeps rendered owner pages consistent until all pages share one shell renderer. */
const TITLE = /(<meta name=viewport content="[^"]*">)([^<>]{1,200})(<link )/;
const NAV = /(<nav\b[^>]*>)([\s\S]*?)(<\/nav>)/;
const ORDERS = /<a [^>]*href="?\/orders"?[^>]*>/;
const link = (href: string, label: string) => '<a href="' + href + '">' + label + '</a>';
const has = (html: string, href: string) => html.includes('href="' + href + '"') || html.includes('href=' + href + '>') || html.includes('href=' + href + ' ');

export function normalizeOwnerShell(html: string): string {
  let out = html;
  if (!out.includes('<title>')) out = out.replace(TITLE, (_m, a: string, t: string, b: string) => a + '<title>' + t.trim() + ' | CodexImmortal</title>' + b);
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
