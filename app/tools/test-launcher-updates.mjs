import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../launcher.py', import.meta.url), 'utf8').split('<script>')[1].split('</script>')[0];
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup({ ready = true, state = 'available', offline = false, pendingSettings = false } = {}) {
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, { value: '3001', style: {}, dataset: {}, hidden: true,
      classList: { toggle() {} }, handlers: {}, addEventListener(event, fn) { this.handlers[event] = fn; } });
    return nodes.get(key);
  };
  const mode = node('mode'); mode.dataset.mode = 'desktop';
  const calls = { updates: 0, launches: 0, closes: 0 };
  const api = {
    check_updates: async () => { calls.updates++; if (offline) throw new Error('offline');
      return { state, currentVersion: '0.2.9', latestVersion: '99.0.0', message: state }; },
    get_settings: () => pendingSettings ? new Promise(() => {}) : Promise.resolve({port:3001, version:'0.2.9'}),
    get_server_status: async () => ({ok:true}),
    launch: async () => { calls.launches++; return {ok:true, close:true}; },
    close: () => { calls.closes++; },
  };
  const events = {};
  const window = { addEventListener: (name, fn) => {events[name] = fn;},
    setInterval() {}, clearInterval() {}, clearTimeout() {}, setTimeout(fn) { fn(); } };
  if (ready) window.pywebview = {api};
  vm.runInNewContext(source, { window, document: {querySelector: node,
    querySelectorAll: selector => selector === '[data-mode]' ? [mode] : [...nodes.values()] } });
  return {node, calls, events, window, api, mode};
}

test('startup checks updates even while settings are pending; readiness is idempotent', async () => {
  const app = setup({pendingSettings:true}); await tick();
  assert.equal(app.calls.updates,1);
  assert.equal(app.node('#updateNotice').hidden,false);
  assert.match(app.node('#updateNotice').textContent,/99\.0\.0/);
  await app.events.pywebviewready(); assert.equal(app.calls.updates,1);
});
test('bridge becoming ready later starts the automatic check', async () => {
  const app=setup({ready:false}); assert.equal(app.calls.updates,0);
  app.window.pywebview={api:app.api}; await app.events.pywebviewready(); await tick();
  assert.equal(app.calls.updates,1);
});
test('new release remains visible after launching desktop', async () => {
  const app=setup(); await tick(); await app.mode.handlers.click();
  assert.equal(app.calls.launches,1); assert.equal(app.calls.closes,0);
});
test('offline checks do not block launch or claim the version is current', async () => {
  const app=setup({offline:true}); await tick(); await app.mode.handlers.click();
  assert.equal(app.calls.launches,1); assert.equal(app.calls.closes,1);
  assert.match(app.node('#updateStatus').textContent,/Не удалось/);
});
test('current version has no update notice and manual retry works', async () => {
  const app=setup({state:'current'}); await tick();
  assert.equal(app.node('#updateNotice').hidden,true);
  await app.node('#checkUpdates').handlers.click(); assert.equal(app.calls.updates,2);
});
