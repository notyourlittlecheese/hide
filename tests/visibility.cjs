const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../index.js'), 'utf8');
const state = { chat: [], limit: 4 };
const sandbox = {
    state, performance, Set, WeakSet,
    Logger: { debug() {}, warn() {}, error() {} },
    saveChatDebounced() {}, scheduleFullHideCheck() {},
    shouldProcessHiding: () => true,
    getContextOptimized: () => state,
    getCurrentHideSettings: () => ({ hideLastN: state.limit, userConfigured: true }),
    isMessageEditActive: () => false,
    saveCurrentHideSettings() {}, updateVisibleFloorDisplay() {},
    extension_settings: { hide: { enabled: true } }, extensionName: 'hide',
    // Deliberately stale DOM: rendering must never manufacture manual overrides.
    $: () => ({ length: 1, attr: () => 'false' }),
};
vm.createContext(sandbox);
vm.runInContext(source.slice(source.indexOf('const HIDE_HELPER_AUTO_FLAG'), source.indexOf('// 检查是否应该执行隐藏/取消隐藏操作')), sandbox);
vm.runInContext(source.slice(source.indexOf('async function runFullHideCheck()'), source.indexOf('// 全部取消隐藏功能')), sandbox);
vm.runInContext(source.slice(source.indexOf('globalThis.HideHelper_interceptGeneration =')), sandbox);
const run = () => sandbox.runFullHideCheck();
const add = (end) => {
    while (state.chat.length < end) state.chat.push({ floor: state.chat.length + 1, is_system: false });
    sandbox.syncManualVisibilityOverrides(state.chat);
};
const hide = (start, end) => {
    for (let floor = start; floor <= end; floor++) state.chat[floor - 1].is_system = true;
};
const visible = () => state.chat.filter(msg => !msg.is_system).map(msg => msg.floor);
(async () => {
    add(120);
    await run();
    await run();
    assert.deepEqual(visible(), [117, 118, 119, 120]);
    for (let end = 122; end <= 200; end += 2) {
        add(end);
        await run();
        hide(end - 1, end);
        await run();
        assert.deepEqual(visible(), [117, 118, 119, 120]);
    }
    state.chat[99].is_system = false;
    await run();
    assert.deepEqual(visible(), [100, 118, 119, 120]);
    const request = JSON.parse(JSON.stringify(state.chat));
    sandbox.HideHelper_interceptGeneration(request);
    assert.deepEqual(request.map(msg => msg.floor), [100, 118, 119, 120]);
    sandbox.HideHelper_interceptGeneration(state.chat);
    assert.equal(state.chat.length, 200);
    hide(1, 200);
    await run();
    assert.deepEqual(visible(), []);
    // Serialized overrides survive reload, including same-value hide writes.
    state.chat = JSON.parse(JSON.stringify(state.chat));
    await run();
    assert.deepEqual(visible(), []);
    for (let end = 201; end <= 206; end++) {
        add(end);
        await run();
        assert.deepEqual(visible(), Array.from({ length: Math.min(4, end - 200) }, (_, i) => Math.max(201, end - 3) + i));
    }
    state.chat[99].is_system = false;
    await run();
    assert.deepEqual(visible(), [100, 204, 205, 206]);
    // Explicit unhide remains authoritative even if manual pins exceed N.
    for (let floor = 1; floor <= 5; floor++) state.chat[floor - 1].is_system = false;
    await run();
    assert.deepEqual(visible(), [1, 2, 3, 4, 5, 100]);
    console.log('PASS: repeated hides, stale DOM, manual quota, hide-all, reload, new floors, request filtering');
})().catch(error => { console.error(error); process.exitCode = 1; });
