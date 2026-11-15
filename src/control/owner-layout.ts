/** Presentation-only overrides. Existing renderers, security and data contracts stay intact. */
export const ownerLayoutCss = `
/* owner-layout-v1 */
:root{--bg:#f5f7fa;--surface:#fff;--surface-2:#f8fafc;--border:#dce4ee;--border-2:#b8c6d6;--text:#172638;--muted:#526579;--accent:#1959bc;--accent-soft:#eaf1fc;--accent-text:#164a96;--ok:#14734c;--ok-soft:#eaf7f0;--warn:#805600;--warn-soft:#fff7e5;--danger:#b42332;--danger-soft:#fff0f1;--info:#185d90;--info-soft:#edf6fd;--radius:12px;--radius-sm:7px;--shadow:0 3px 14px rgba(23,38,56,.04)}
html{color-scheme:light}body{background:var(--bg);color:var(--text)}
.shell{grid-template-columns:248px minmax(0,1fr)}
.sidebar{background:var(--surface);padding:28px 18px;gap:28px}
.brand{color:var(--text)}.brand:hover{text-decoration:none}.brand-mark{background:var(--accent);border-radius:10px}
.nav a{min-height:44px;padding:10px 12px}.nav a:hover{background:var(--surface-2);color:var(--text)}.nav a[aria-current=page]{background:var(--accent-soft);color:var(--accent-text)}
.topbar{min-height:68px;padding:14px 32px;background:var(--surface);backdrop-filter:none}
.content{width:100%;max-width:1480px;margin:0 auto;padding:32px}
.page-head{margin-bottom:28px}.page-head h1,.page-head h2{margin:0 0 10px;font-size:clamp(24px,2.5vw,32px);line-height:1.2;letter-spacing:-.035em}
.panel,.stat{box-shadow:var(--shadow)}.panel-head{padding:16px 20px}.panel-body{padding:20px}
.stat-grid{gap:18px;margin-bottom:24px}.stat{padding:20px}.stat-value{font-size:28px;letter-spacing:-.03em}
input,select,textarea{max-width:100%;background:var(--surface);color:var(--text);border:1px solid var(--border-2);border-radius:var(--radius-sm);padding:10px 12px;font:inherit}
input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.btn{min-height:40px}.btn--small{min-height:36px}.btn:disabled{opacity:.55;cursor:not-allowed}
.flash{color:var(--danger);border-color:#f0bac0}.flash--warn{color:var(--warn);border-color:#e9d29b}
.count,.badge--neutral{background:var(--surface-2)}tbody tr:hover{background:#f3f7fc}th{background:var(--surface-2)}
.badge--queued{color:var(--accent-text)}.badge--verified{color:var(--ok)}.badge--running,.badge--awaiting_verification{color:var(--warn)}
.bar-fill--pos{background:var(--ok)}.bar-fill--neg{background:var(--danger)}
.login-shell{background:var(--bg)}.login-card{box-shadow:var(--shadow)}.login-card input{width:100%}
.table-wrap{max-width:100%;overflow:auto}td code{overflow-wrap:anywhere}.num{font-variant-numeric:tabular-nums}
@media(max-width:900px){.shell{grid-template-columns:1fr}.sidebar{position:static;height:auto;padding:16px;gap:16px}.sidebar-foot{flex-wrap:wrap}.topbar{position:static;padding:12px 16px;flex-wrap:wrap}.content{padding:24px 16px}}
@media(max-width:480px){.stat-grid{grid-template-columns:1fr}.search{min-width:0;width:100%}.toolbar{align-items:stretch}.brand{padding:0}.nav a{padding:9px}.bar-row{grid-template-columns:80px minmax(0,1fr) 90px}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
