const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../index.js'), 'utf8');
const AUTO = 'hideHelperAutoHidden', HIDE = 'hideHelperManuallyHidden', SHOW = 'hideHelperManuallyShown';
const clone = value => JSON.parse(JSON.stringify(value));
const floors = chat => Array.from(chat, msg => msg.floor);
const messages = count => Array.from({ length: count }, (_, i) => ({
    floor: i + 1, name: i % 2 ? 'AI' : 'USER', is_user: i % 2 === 0,
    mes: 'message ' + (i + 1), is_system: false, extra: {},
}));

function harness(count = 100, limit = 4) {
    const state = { chat: messages(count), chatId: 'a', entity: 'character-a' };
    const settings = { enabled: true, useGlobalSettings: true,
        globalHideSettings: { hideLastN: limit, userConfigured: true, lastProcessedLength: count },
        settings_by_entity: {} };
    const timers = new Map(), dom = new Map(), handlers = new Map(), events = new Map();
    const event_types = Object.fromEntries(['CHAT_CHANGED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED',
        'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED',
        'GENERATION_AFTER_COMMANDS', 'GENERATION_ENDED'].map(name => [name, name]));
    const eventSource = {
        on(name, fn) { events.set(name, fn); },
        async emit(name, ...args) { return events.get(name)?.(...args); },
    };
    let nextTimer = 0;
    const counters = { saves: 0, settings: 0, domWrites: 0 };
    const document = {};
    const $ = selector => {
        if (selector === document) return {
            off() { return this; },
            on(event, target, handler) { handlers.set(target, handler); return this; },
        };
        if (typeof selector === 'object') return { closest: () => ({ attr: () => String(selector.index) }) };
        const ids = [...selector.matchAll(/mesid="(\d+)"/g)].map(match => Number(match[1]));
        return { length: ids.length, attr(name, value) {
            if (value === undefined) return dom.get(ids[0]) ?? 'false';
            for (const id of ids) dom.set(id, value);
            counters.domWrites++;
            return this;
        } };
    };
    const stringToRange = (value, min, max) => {
        const match = /^(\d+)(?:-(\d+))?$/.exec(value);
        return match ? { start: Math.max(min, +match[1]), end: Math.min(max, +(match[2] ?? match[1])) } : null;
    };
    const commands = {};
    for (const name of ['hide', 'unhide']) commands[name] = { callback: async (args, value) => {
        const range = value ? stringToRange(value, 0, state.chat.length - 1)
            : { start: state.chat.length - 1, end: state.chat.length - 1 };
        if (!range) return '';
        for (let i = range.start; i <= range.end; i++) {
            const msg = state.chat[i];
            if (msg && (!args.name || msg.name === args.name)) msg.is_system = name === 'hide';
        }
        return '';
    } };
    const sandbox = {
        POPUP_TYPE: { INPUT: 'input' }, callGenericPopup: async () => '2',
        toastr: { warning() {}, success() {}, error() {} },
        performance, document, $, stringToRange, SlashCommandParser: { commands }, eventSource, event_types,
        Logger: { debug() {}, warn() {}, error() {} },
        getContext: () => state, getCurrentEntityId: () => state.entity,
        saveChatDebounced: () => counters.saves++,
        saveSettingsDebounced: () => counters.settings++,
        updateVisibleFloorDisplay() {}, isMessageEditActive: () => false,
        updateCurrentHideSettingsDisplay() {},
        setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; },
        clearTimeout: id => timers.delete(id),
        extension_settings: { hide: settings }, extensionName: 'hide',
    };
    vm.createContext(sandbox);
    const load = (start, end) => {
        const from = source.indexOf(start), to = end ? source.indexOf(end, from) : source.length;
        assert.ok(from >= 0 && to > from, start);
        vm.runInContext(source.slice(from, to), sandbox);
    };
    vm.runInContext('let cachedContext = null;', sandbox);
    load('function getContextOptimized()', '// 辅助函数：获取当前上下文');
    load('function getCurrentHideSettings()', '// 更新当前');
    load('const runFullHideCheckDebounced', 'function updateVisibleFloorDisplay');
    load('const HIDE_HELPER_AUTO_FLAG', '// 检查是否应该执行隐藏/取消隐藏操作');
    load('function shouldProcessHiding()', '// 全部取消隐藏功能');
    load('    eventSource.on(event_types.CHAT_CHANGED, (data)', "    const chatElement = document.getElementById('chat');");
    load('globalThis.HideHelper_interceptGeneration =');
    return { sandbox, state, settings, counters, timers, dom, commands, eventSource,
        run: () => sandbox.runFullHideCheck(),
        visible: () => floors(state.chat.filter(msg => !msg.is_system)),
        click: (index, hidden) => handlers.get(hidden ? '.mes_hide' : '.mes_unhide').call({ index }),
        flush: async () => {
            const pending = [...timers.values()]; timers.clear();
            for (const fn of pending) await fn();
        },
        add: () => { const msg = messages(state.chat.length + 1).at(-1); state.chat.push(msg); return msg; },
    };
}

test('A: N=1/4/10/17/150; repeated checks are idempotent', async () => {
    for (const n of [1, 4, 10, 17, 150]) {
        const h = harness(100, n);
        await h.run();
        assert.deepEqual(h.visible(), floors(h.state.chat.slice(-n)));
        const before = clone(h.state.chat), saves = h.counters.saves;
        await h.run(); await h.run();
        assert.deepEqual(clone(h.state.chat), before);
        assert.equal(h.counters.saves, saves);
    }
});
test('B: four historical shows do not displace recent USER/AI', async () => {
    const h = harness(); await h.run();
    for (const floor of [10, 20, 30, 40]) h.click(floor - 1, false);
    for (let i = 0; i < 2; i++) {
        const msg = h.add(); await h.run(); assert.equal(msg.is_system, false);
    }
    assert.deepEqual(h.visible(), [10, 20, 30, 40, 99, 100, 101, 102]);
    const request = h.state.chat.slice();
    h.sandbox.HideHelper_interceptGeneration(request);
    assert.deepEqual(floors(request), h.visible());
});
test('C: repeated explicit hides, hide-all, reload and new floors', async () => {
    const h = harness(120); await h.run();
    for (let end = 122; end <= 200; end += 2) {
        h.add(); h.add(); await h.run();
        h.click(end - 2, true); h.click(end - 1, true); await h.run();
        assert.deepEqual(h.visible(), [117, 118, 119, 120]);
    }
    h.sandbox.installVisibilityCommandHooks();
    await h.commands.hide.callback({}, '0-199'); await h.run();
    assert.deepEqual(h.visible(), []);
    h.state.chat = clone(h.state.chat); await h.run();
    assert.deepEqual(h.visible(), []);
    h.add(); await h.run(); assert.deepEqual(h.visible(), [201]);
});
test('D: alternating new USER/AI never acquires manual flags', async () => {
    const h = harness(10, 3);
    for (let i = 0; i < 8; i++) {
        h.add(); await h.run();
        assert.deepEqual(h.visible(), floors(h.state.chat.slice(-3)));
        assert.ok(h.state.chat.every(msg => !msg.extra[HIDE] && !msg.extra[SHOW]));
    }
});
test('E: streaming/metadata DOM churn does not save or mutate visibility', async () => {
    const h = harness(); h.add(); h.add(); await h.run();
    const saves = h.counters.saves, domWrites = h.counters.domWrites;
    for (let i = 0; i < 100; i++) {
        h.state.chat.at(-1).mes += ' token';
        h.sandbox.handleVisibilityDomMutations([{ type: 'childList', addedNodes: [
            { nodeType: 1, matches: () => false, querySelector: () => null },
        ] }]);
        await h.run();
    }
    assert.equal(h.counters.saves, saves);
    assert.equal(h.counters.domWrites, domWrites);
    assert.equal(h.timers.size, 0);
    assert.equal(h.state.chat.at(-1).is_system, false);
    assert.ok(h.state.chat.every(msg => !msg.extra[HIDE]));
    h.dom.clear();
    h.sandbox.handleVisibilityDomMutations([{ type: 'childList', addedNodes: [
        { nodeType: 1, matches: () => true },
    ] }]);
    assert.equal(h.counters.saves, saves);
    assert.equal(h.dom.get(0), 'true');
});
test('F: unknown assignments are not manual actions or accessors; buttons still work', async () => {
    const h = harness(); await h.run();
    const msg = h.state.chat.at(-1);
    msg.is_system = true; msg.is_system = true; await h.run();
    assert.equal(msg.extra[HIDE], undefined);
    assert.equal(msg.extra[SHOW], undefined);
    assert.equal(msg.is_system, true);
    assert.equal(Object.getOwnPropertyDescriptor(msg, 'is_system').set, undefined);
    msg.is_system = false; await h.run();
    assert.equal(msg.extra[SHOW], undefined);
    h.click(99, true); await h.run(); assert.equal(msg.extra[HIDE], true);
    h.click(99, false); await h.run(); assert.equal(msg.extra[SHOW], true);
});
test('G: legacy markers are preserved; targeted Unhide repairs selected floor', async () => {
    const h = harness();
    for (const i of [98, 99]) Object.assign(h.state.chat[i], { is_system: true, extra: { [HIDE]: true } });
    const old = clone(h.state.chat[98]);
    await h.run();
    assert.deepEqual(h.state.chat[98].extra, old.extra);
    assert.equal(h.state.chat[98].is_system, old.is_system);
    const migrated = clone(h.state.chat[98]);
    h.click(99, false); await h.run();
    assert.deepEqual(clone(h.state.chat[98]), migrated);
    assert.equal(h.state.chat[99].is_system, false);
    assert.equal(h.state.chat[99].extra[HIDE], undefined);
});
test('H: Continue/Swipe/edit payload and shallow/deep requests leave originals intact', async () => {
    const h = harness(8); await h.run(); h.click(7, true);
    h.state.chat[6].mes += ' continued';
    h.state.chat[6].swipes = ['first', 'second']; h.state.chat[6].swipe_id = 1;
    const original = clone(h.state.chat), shallow = h.state.chat.slice();
    h.sandbox.HideHelper_interceptGeneration(shallow);
    assert.deepEqual(floors(shallow), [4, 5, 6, 7]);
    assert.equal(shallow[0].is_system, false);
    assert.notEqual(shallow[0], h.state.chat[3]);
    assert.deepEqual(clone(h.state.chat), original);
    const deep = clone(h.state.chat);
    h.sandbox.HideHelper_interceptGeneration(deep);
    assert.deepEqual(floors(deep), [4, 5, 6, 7]);
    h.sandbox.HideHelper_interceptGeneration(h.state.chat);
    assert.deepEqual(clone(h.state.chat), original);
    await h.run();
    assert.equal(h.state.chat[6].mes, original[6].mes);
    assert.deepEqual(h.state.chat[6].swipes, original[6].swipes);
});
test('H: delayed checks coalesce and cannot cross chat identity/epoch', async () => {
    const h = harness();
    for (let i = 0; i < 30; i++) h.sandbox.scheduleFullHideCheck('MESSAGE_UPDATED', [100, 500, 1500]);
    assert.equal(h.timers.size, 1);
    h.state.chatId = 'b'; h.state.chat = messages(20);
    await h.flush(); assert.equal(h.counters.saves, 0);
    h.sandbox.scheduleFullHideCheck('MESSAGE_SENT');
    h.sandbox.cancelScheduledHideChecks();
    assert.equal(h.timers.size, 0);
    h.sandbox.scheduleFullHideCheck('MESSAGE_RECEIVED'); await h.flush();
    assert.deepEqual(h.visible(), [17, 18, 19, 20]);
});
test('global and character configuration choose effective N', async () => {
    const h = harness(100, 10);
    h.settings.settings_by_entity['character-a'] = { hideLastN: 3, userConfigured: true };
    await h.run(); assert.equal(h.visible().length, 10);
    h.settings.useGlobalSettings = false;
    await h.run(); assert.deepEqual(h.visible(), [98, 99, 100]);
    h.settings.settings_by_entity['character-b'] = { hideLastN: 7, userConfigured: true };
    h.state.entity = 'character-b'; await h.run();
    assert.equal(h.visible().length, 7);
    assert.equal(h.settings.globalHideSettings.hideLastN, 10);
    assert.equal(h.settings.settings_by_entity['character-a'].hideLastN, 3);
});
test('explicit commands: same-value intent, name filter, returns, single wrapping', async () => {
    const h = harness(10, 2); await h.run();
    h.sandbox.installVisibilityCommandHooks();
    const callback = h.commands.hide.callback;
    h.sandbox.installVisibilityCommandHooks(); assert.equal(h.commands.hide.callback, callback);
    assert.equal(await h.commands.hide.callback({ name: 'USER' }, '0-7'), '');
    assert.equal(h.state.chat[0].extra[HIDE], true);
    assert.equal(h.state.chat[1].extra[HIDE], undefined);
    await h.commands.unhide.callback({}, '0'); await h.run();
    assert.deepEqual(h.visible(), [1, 9, 10]);
    const saves = h.counters.saves;
    await h.commands.unhide.callback({}, '0'); await h.run();
    assert.equal(h.counters.saves, saves);
});

test('real data-event handlers settle USER visibility before native prompt filtering', async () => {
    const h = harness();
    await h.run();
    for (const i of [9, 19, 29, 39]) h.click(i, false);
    h.add();
    await h.eventSource.emit('MESSAGE_SENT');
    const nativeRequest = h.state.chat.filter(msg => !msg.is_system)
        .map(msg => ({ ...msg, mes: 'promptOnly:' + msg.mes }));
    const body = nativeRequest.at(-1).mes;
    h.sandbox.HideHelper_interceptGeneration(nativeRequest);
    assert.deepEqual(floors(nativeRequest), [10, 20, 30, 40, 98, 99, 100, 101]);
    assert.equal(nativeRequest.at(-1).mes, body);
    const ai = h.add();
    await h.eventSource.emit('MESSAGE_RECEIVED');
    await h.flush();
    for (let i = 0; i < 20; i++) {
        ai.mes += ' streaming';
        await h.eventSource.emit('MESSAGE_UPDATED');
    }
    await h.eventSource.emit('GENERATION_ENDED');
    await h.flush();
    assert.deepEqual(h.visible(), [10, 20, 30, 40, 99, 100, 101, 102]);
    assert.equal(ai.extra[HIDE], undefined);
});

test('Continue/Swipe/edit and CHAT_CHANGED event handlers retain content and cancel old work', async () => {
    const h = harness();
    await h.run();
    const last = h.state.chat.at(-1);
    last.mes += ' continued';
    last.swipes = [last.mes, 'alternate'];
    last.swipe_id = 1;
    await h.eventSource.emit('GENERATION_AFTER_COMMANDS', 'continue', {}, false);
    await h.eventSource.emit('MESSAGE_SWIPED');
    await h.eventSource.emit('MESSAGE_EDITED');
    await h.flush();
    assert.equal(last.mes, 'message 100 continued');
    assert.equal(last.swipe_id, 1);
    assert.deepEqual(last.swipes, ['message 100 continued', 'alternate']);
    await h.eventSource.emit('MESSAGE_UPDATED');
    h.state.chat = messages(20); h.state.chatId = 'b';
    await h.eventSource.emit('CHAT_CHANGED');
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.visible(), [17, 18, 19, 20]);
    const saved = h.counters.saves;
    await h.flush();
    assert.equal(h.counters.saves, saved);
});

test('DOM-only mismatch and missing DOM do not cause a chat save', async () => {
    const h = harness();
    await h.run();
    h.dom.clear();
    const saves = h.counters.saves;
    await h.run();
    assert.equal(h.counters.saves, saves);
});

test('disabled, unconfigured and zero N do not filter or mutate chat', async () => {
    for (const mode of ['disabled', 'autoDisabled', 'unconfigured', 'zero']) {
        const h = harness();
        if (mode === 'disabled') h.settings.enabled = false;
        if (mode === 'autoDisabled') h.settings.autoHideEnabled = false;
        if (mode === 'unconfigured') h.settings.globalHideSettings.userConfigured = false;
        if (mode === 'zero') h.settings.globalHideSettings.hideLastN = 0;
        const before = clone(h.state.chat), request = h.state.chat.slice();
        await h.run(); h.sandbox.HideHelper_interceptGeneration(request);
        assert.deepEqual(h.state.chat, before);
        assert.equal(request.length, 100);
        assert.equal(h.counters.saves, 0);
    }
});

test('same-length request replacements do not mutate shared auto flags', () => {
    const h = harness(2, 4);
    h.state.chat[0].is_system = true; h.state.chat[0].extra[AUTO] = true;
    const before = clone(h.state.chat), request = h.state.chat.slice();
    h.sandbox.HideHelper_interceptGeneration(request);
    assert.equal(request.length, 2);
    assert.equal(request[0].is_system, false);
    assert.equal(request[0].extra[AUTO], undefined);
    assert.deepEqual(h.state.chat, before);
});

test('manual hide survives native extra replacement on swipe and generation', async () => {
    const h = harness(10);
    await h.run();
    h.click(9, true);
    await h.run();
    assert.deepEqual(h.visible(), [6, 7, 8, 9]);
    h.state.chat[9].extra = { [AUTO]: true };
    await h.eventSource.emit('MESSAGE_SWIPED', 9);
    await h.flush();
    h.add();
    await h.eventSource.emit('MESSAGE_SENT');
    assert.equal(h.state.chat[9].is_system, true);
    assert.equal(h.state.chat[9].extra[HIDE], true);
    assert.deepEqual(h.visible(), [7, 8, 9, 11]);
});

test('old swipe metadata cannot revive a superseded manual hide', async () => {
    const h = harness(10);
    await h.run();
    h.click(9, true);
    const oldSwipeExtra = clone(h.state.chat[9].extra);
    h.click(9, false);
    await h.run();
    h.state.chat[9].extra = oldSwipeExtra;
    await h.eventSource.emit('MESSAGE_SWIPED', 9);
    await h.flush();
    await h.eventSource.emit('GENERATION_ENDED');
    await h.flush();
    assert.equal(h.state.chat[9].is_system, false);
    assert.equal(h.state.chat[9].extra[HIDE], undefined);
    assert.deepEqual(h.visible(), [7, 8, 9, 10]);
});

test('persisted floor state survives reload and extra reset without touching swipe text', async () => {
    const h = harness(10);
    await h.run();
    h.click(9, true); await h.run();
    const msg = h.state.chat[9];
    msg.swipes = ['original', 'alternative'];
    msg.swipe_info = [{ extra: {} }, { extra: { [AUTO]: true } }];
    h.state.chat = clone(h.state.chat);
    h.state.chat[9].extra = clone(h.state.chat[9].swipe_info[1].extra);
    await h.run();
    assert.equal(h.state.chat[9].is_system, true);
    assert.deepEqual(h.state.chat[9].swipes, ['original', 'alternative']);
    const before = clone(h.state.chat);
    const saves = h.counters.saves;
    await h.run();
    assert.deepEqual(clone(h.state.chat), before);
    assert.equal(h.counters.saves, saves);
});

test('built-in hide button records manual intent before new USER and AI generation', async () => {
    for (const count of [0, 1, 10]) {
        const h = harness(count);
        await h.run();
        if (count) { h.click(count - 1, false); await h.run(); }
        await h.sandbox.showManualHideDialog(); await h.flush();
        for (let i = Math.max(0, count - 2); i < count; i++) {
            assert.equal(h.state.chat[i].extra[HIDE], true);
        }
        h.add(); await h.eventSource.emit('MESSAGE_SENT');
        h.add(); await h.eventSource.emit('MESSAGE_RECEIVED'); await h.flush();
        await h.eventSource.emit('GENERATION_ENDED'); await h.flush();
        for (let i = Math.max(0, count - 2); i < count; i++) assert.equal(h.state.chat[i].is_system, true);
        assert.equal(h.state.chat.at(-1).is_system, false);
        if (count === 10) assert.deepEqual(h.visible(), [7, 8, 11, 12]);
    }
});

test('newest neutral floor ignores stale swipe flags and ordinary replies stay visible', async () => {
    const h = harness(10); await h.run();
    h.state.chat[9].extra = { [HIDE]: true };
    await h.eventSource.emit('MESSAGE_UPDATED'); await h.flush();
    assert.equal(h.state.chat[9].is_system, false);
    h.add(); await h.eventSource.emit('MESSAGE_SENT');
    const last = h.add();
    await h.eventSource.emit('MESSAGE_RECEIVED'); await h.flush();
    await h.eventSource.emit('GENERATION_ENDED'); await h.flush();
    assert.equal(last.is_system, false);
    assert.deepEqual(h.visible(), [9, 10, 11, 12]);
});

test('single hide button: default 2, custom N, cancellation, invalid input and chat switch', async () => {
    for (const answer of ['2', '5', '100', '', false, null, '0', '-2', '1.5', 'abc', 'switch', 'append']) {
        const h = harness(10);
        h.sandbox.callGenericPopup = async (title, type, value) => {
            assert.equal(value, '2');
            if (answer === 'switch') { h.state.chatId = 'b'; return '2'; }
            if (answer === 'append') { h.add(); return '2'; }
            return answer;
        };
        await h.sandbox.showManualHideDialog();
        const hidden = floors(h.state.chat.filter(msg => msg.extra[HIDE]));
        if (['2', '5', '100'].includes(answer)) {
            assert.deepEqual(hidden, floors(h.state.chat.slice(-Number(answer))));
        } else assert.deepEqual(hidden, []);
    }
});

test('built-in dialog ignores duplicate clicks and works with auto hiding disabled', async () => {
    const h = harness(10);
    h.settings.autoHideEnabled = false;
    let resolve, opened = 0;
    h.sandbox.callGenericPopup = () => { opened++; return new Promise(done => { resolve = done; }); };
    const pending = h.sandbox.showManualHideDialog();
    await h.sandbox.showManualHideDialog();
    assert.equal(opened, 1);
    resolve('2'); await pending;
    assert.deepEqual(h.visible(), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(h.state.chat.slice(-2).every(msg => msg.extra[HIDE] === true));
});
