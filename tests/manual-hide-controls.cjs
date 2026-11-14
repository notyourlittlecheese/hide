const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../manual-hide-controls.js'), 'utf8').replace('export function', 'function');

function setup() {
    class Element {
        constructor() { this.listeners = new Map(); this.attributes = {}; this.dataset = {}; this.hidden = true; }
        addEventListener(name, fn) { this.listeners.set(name, fn); }
        removeEventListener(name) { this.listeners.delete(name); }
        emit(name, fields = {}) {
            const event = { isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 10,
                detail: 1, target: this, preventDefault() { this.prevented = true; }, ...fields };
            this.listeners.get(name)?.(event);
        }
        setAttribute(name, value) { this.attributes[name] = value; }
        hasAttribute(name) { return name in this.attributes; }
        setPointerCapture() {}
        blur() {}
        setCustomValidity(value) { this.validity = value; }
        reportValidity() {}
        remove() { this.removed = true; }
        closest() { return this; }
    }
    const button = new Element(), picker = new Element(), input = new Element(), row = new Element();
    row.querySelector = selector => ({ '.hh-quick-button': button, '.hh-quick-picker': picker, input })[selector];
    row.contains = target => [button, picker, input, row].includes(target);
    const document = new Element(), window = new Element(), calls = [], timers = new Map();
    document.createElement = () => row;
    let timerId = 0, snapshot = 'a';
    const sandbox = { document, window, console,
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
        clearTimeout: id => timers.delete(id) };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    const destroy = sandbox.mountManualHideControls({ before() {} }, {
        onHide: (count, target) => calls.push({ count, target }), getSnapshot: () => snapshot,
    });
    const choose = (kind, value) => {
        const target = new Element();
        if (kind === 'count' || kind === 'step') target.dataset[kind] = value;
        else target.attributes['data-' + kind] = '';
        picker.emit('click', { target });
    };
    return { button, picker, input, document, window, calls, row, destroy, choose,
        tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
        switchChat() { snapshot = 'b'; },
    };
}

test('tap hides two immediately; long press opens without input focus and suppresses release click', () => {
    const h = setup();
    h.button.emit('pointerdown'); h.button.emit('pointerup'); h.button.emit('click');
    assert.deepEqual(h.calls, [{ count: 2, target: 'a' }]);
    h.button.emit('pointerdown'); h.tick(); h.button.emit('pointerup'); h.button.emit('click');
    assert.equal(h.picker.hidden, false);
    assert.equal(h.input.readOnly, true);
    assert.equal(h.calls.length, 1);
    h.choose('count', '6');
    assert.equal(h.calls.at(-1).count, 6);
    h.button.emit('pointerdown'); h.button.emit('pointerup'); h.button.emit('click');
    assert.equal(h.calls.at(-1).count, 2);
});

test('drag and pointer cancellation never trigger hide or open picker', () => {
    const h = setup();
    h.button.emit('pointerdown'); h.button.emit('pointermove', { clientX: 40 }); h.tick();
    h.button.emit('pointerup'); h.button.emit('click');
    assert.equal(h.calls.length, 0);
    assert.equal(h.picker.hidden, true);
    h.button.emit('pointerdown'); h.button.emit('pointercancel'); h.tick(); h.button.emit('click');
    assert.equal(h.calls.length, 0);
});

test('presets, stepper, explicit input, cancellation and captured chat', () => {
    const h = setup();
    h.button.emit('keydown', { key: 'ArrowDown' });
    h.choose('step', '-1'); h.choose('step', '-1');
    assert.equal(h.input.value, '1');
    h.choose('step', '1'); h.choose('step', '1');
    h.switchChat(); h.choose('confirm');
    assert.deepEqual(h.calls, [{ count: 3, target: 'a' }]);
    h.button.emit('contextmenu');
    assert.equal(h.input.value, '2');
    h.input.emit('pointerdown');
    assert.equal(h.input.readOnly, false);
    h.input.value = '0'; h.choose('confirm');
    assert.equal(h.calls.length, 1);
    h.input.value = '7'; h.choose('confirm');
    assert.deepEqual(h.calls.at(-1), { count: 7, target: 'b' });
    h.button.emit('contextmenu'); h.document.emit('keydown', { key: 'Escape' });
    assert.equal(h.picker.hidden, true);
    h.button.emit('contextmenu'); h.document.emit('pointerdown');
    assert.equal(h.picker.hidden, true);
    h.destroy();
    assert.equal(h.row.removed, true);
    assert.equal(h.document.listeners.size, 0);
    assert.equal(h.window.listeners.size, 0);
});
