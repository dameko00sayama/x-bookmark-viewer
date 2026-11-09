// Regression check: execute the real route and viewer against synthetic local pages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks, globals = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: name => {
    if (!(name in mocks)) throw new Error('Unmocked import: ' + name);
    return mocks[name];
  }, URL, URLSearchParams, console, ...globals }, { filename: file });
  return exports;
}
const tag = { id: 1, name: 'target', color: '#38bdf8', sortOrder: 0 };
const tweets = Array.from({ length: 120 }, (_, i) => ({
  id: String(i), text: i === 119 ? 'needle' : 'post ' + i, author: null,
  media: [], tags: i === 119 ? [tag] : [], note: null, collapsed: false, quotedTweet: null
}));
let xCalls = [], savedOffsets = [], failCache = false;
const db = {
  getAuth: () => ({ userId: 'test' }),
  getActiveCachedBookmarkCount: () => tweets.length,
  getBookmarkNextXToken: () => 'remote cursor',
  getEstimatedApiUsageUsd: () => xCalls.length * .05,
  getCachedBookmarkPage: (offset = 0, size = 50) => {
    if (failCache && offset > 0) throw new Error('Simulated DB failure');
    return { items: tweets.slice(offset, offset + size), nextToken: offset + size < tweets.length ? 'cache:' + (offset + size) : null };
  },
  saveCachedBookmarkPage: (items, offset) => { savedOffsets.push(offset); return items; }
};
class AuthRequiredError extends Error {}
class BudgetExceededError extends Error {}
class XApiError extends Error {}
const xApi = {
  AuthRequiredError, BudgetExceededError, XApiError, getApiChargeUsd: () => 5,
  fetchBookmarks: async token => { xCalls.push(token); return { items: tweets.slice(0, 50), nextToken: 'remote next' }; }
};
const next = { NextResponse: { json: (body, opts) => ({ body, status: opts?.status ?? 200 }) } };
const route = load('app/api/bookmarks/route.ts', { 'next/server': next, '@/lib/db': db, '@/lib/x-api': xApi });
async function get(query = '') { return route.GET({ url: 'http://localhost:8181/api/bookmarks' + query }); }
function renderer() {
  const slots = []; let cursor = 0, dirty = true, effects = [], tree;
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }];
    },
    useRef(initial) { const i = cursor++; if (!slots[i]) slots[i] = { current: initial }; return slots[i]; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } }
  };
  const requests = [];
  const jsx = (type, props) => ({ type, props });
  const Component = load('components/BookmarkViewer.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, '@/package.json': { default: { version: 'test' } },
    './BookmarkCard': { default: 'BookmarkCard' }, './ImageModal': { default: 'ImageModal' }, './LoginPanel': { default: 'LoginPanel' }
  }, {
    fetch: async url => {
      requests.push(url);
      let result;
      if (url === '/api/auth/me') result = { status: 200, body: { authenticated: true, accounts: [] } };
      else if (url === '/api/tags') result = { status: 200, body: { tags: [tag] } };
      else if (url.startsWith('/api/bookmarks')) result = await get(url.slice('/api/bookmarks'.length));
      else throw new Error('Unexpected request: ' + url);
      return { ok: result.status < 400, json: async () => result.body };
    },
    window: { location: { search: '' }, confirm: () => true },
    document: { addEventListener() {}, removeEventListener() {} },
    setTimeout: () => 1, clearTimeout() {}
  }).default;
  async function settle() {
    for (let i = 0; i < 80; i++) {
      if (dirty) { dirty = false; cursor = 0; tree = Component(); const queue = effects; effects = []; queue.forEach(fn => fn()); }
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty && !effects.length) return;
    }
    throw new Error('Viewer did not settle (possible automatic request loop)');
  }
  function nodes(node) {
    if (arguments.length === 0) node = tree;
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children)];
  }
  const text = node => {
    if (Array.isArray(node)) return node.map(text).join('');
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node !== 'object') return String(node);
    return text(node.props?.children);
  };
  function button(label) { const b = nodes().find(n => n.type === 'button' && text(n) === label); assert.ok(b, 'Button not found: ' + label); return b; }
  return { settle, nodes, button, requests };
}
(async () => {
  for (const query of ['', '?pagination_token=cache:50', '?pagination_token=cache:100']) {
    const r = await get(query); assert.equal(r.status, 200); assert.equal(r.body.source, 'cache');
    assert.ok(r.body.nextToken === null || r.body.nextToken.startsWith('cache:'));
  }
  assert.equal((await get('?pagination_token=x:remote')).status, 400);
  assert.equal(xCalls.length, 0, 'Ordinary endpoint called X');
  await get('?refresh=1'); await get('?refresh=1&pagination_token=x:remote%20cursor');
  assert.deepEqual(xCalls, [null, 'remote cursor']); assert.deepEqual(savedOffsets, [0, 120]);
  xCalls = []; savedOffsets = [];
  for (const mode of ['tag', 'search', 'untagged', 'manual']) {
    const ui = renderer(); await ui.settle();
    assert.equal(ui.nodes().filter(n => n.type === 'BookmarkCard').length, 50);
    if (mode === 'manual') {
      await ui.button('もっと読む').props.onClick(); await ui.settle();
      await ui.button('もっと読む').props.onClick(); await ui.settle();
    } else {
      // Open the appropriate panel through the actual event callbacks.
      const menu = ui.nodes().find(n => n.type === 'button' && n.props['aria-label'] === 'メニュー');
      assert.ok(menu, 'Menu toggle not found'); menu.props.onClick(); await ui.settle();
      ui.button(mode === 'search' ? '検索' : 'タグフィルター').props.onClick(); await ui.settle();
      if (mode === 'search') {
        const input = ui.nodes().find(n => n.type === 'input' && n.props.placeholder === '本文、投稿者、メモ、タグを検索');
        assert.ok(input); input.props.onChange({ target: { value: 'needle' } });
      } else {
        const inputs = ui.nodes().filter(n => n.type === 'input' && n.props.type === 'checkbox');
        inputs[mode === 'tag' ? 1 : 0].props.onChange({ target: { checked: true } });
      }
      await ui.settle();
    }
    assert.equal(xCalls.length, 0, mode + ' unexpectedly called X');
    assert.ok(ui.requests.includes('/api/bookmarks?pagination_token=cache%3A100'), mode + ' did not reach final local page');
    const cards = ui.nodes().filter(n => n.type === 'BookmarkCard');
    assert.equal(cards.length, mode === 'manual' ? 120 : mode === 'untagged' ? 119 : 1);
    if (mode === 'tag' || mode === 'search') assert.equal(cards[0].props.tweet.id, '119');
    await ui.button('続きを取得').props.onClick(); await ui.settle();
    assert.equal(xCalls.length, 1, 'Explicit acquisition should call X once');
    xCalls = [];
    console.log('PASS ' + mode + ': full local results, zero automatic X calls; explicit acquisition works');
  }
  failCache = true;
  const failedUi = renderer(); await failedUi.settle();
  failedUi.nodes().find(n => n.type === 'button' && n.props['aria-label'] === 'メニュー').props.onClick();
  await failedUi.settle(); failedUi.button('タグフィルター').props.onClick(); await failedUi.settle();
  failedUi.nodes().filter(n => n.type === 'input' && n.props.type === 'checkbox')[1].props.onChange({ target: { checked: true } });
  await failedUi.settle();
  assert.equal(failedUi.requests.filter(u => u.includes('pagination_token')).length, 1, 'Failed local page must not retry indefinitely');
  assert.equal(xCalls.length, 0);
  failCache = false;
  const syncRoute = load('app/api/bookmarks/sync/route.ts', {
    'next/server': next, '@/lib/x-api': xApi,
    '@/lib/db': { ...db, getActiveCachedBookmarkIds: () => ['0'], saveSyncedBookmarkPage() {}, markBookmarksNotSeenOnX: () => 0 }
  });
  const synced = await syncRoute.POST();
  assert.equal(synced.status, 200); assert.equal(xCalls.length, 1);
  assert.equal(synced.body.nextToken, 'cache:50'); assert.ok(synced.body.nextXToken.startsWith('x:'));
  console.log('PASS local page failure: no request loop or X fallback');
  console.log('PASS explicit sync: X call retained, local pagination remains separate');
  console.log('PASS route: cache boundary, legacy X-token rejection, latest and continuation acquisition');
})().catch(error => { console.error(error); process.exitCode = 1; });
