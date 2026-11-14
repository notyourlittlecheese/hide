const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../manual-hide-controls.js'), 'utf8')
    .split('export function mountManualHideControls')[0].replace('export function', 'function');

test('QR mounting follows late creation, combined groups, removal and form replacement', () => {
    class Element {
        constructor(id = '', className = '') { this.id = id; this.className = className; this.children = []; }
        get isConnected() { return this === root || !!this.parentElement?.isConnected; }
        append(child) { child.remove(); this.children.push(child); child.parentElement = this; }
        prepend(child) { child.remove(); this.children.unshift(child); child.parentElement = this; }
        remove() {
            if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
            this.parentElement = null;
        }
        querySelectorAll(selector) {
            return this.children.flatMap(node => [node, ...node.querySelectorAll('*')]).filter(node =>
                selector === '*' || (selector === '#send_form' && node.id === 'send_form')
                || (selector === '[id="qr--bar"]' && node.id === 'qr--bar')
                || (selector === '.qr--buttons' && node.className === 'qr--buttons'));
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    }
    const root = new Element(), form = new Element('send_form'), row = new Element('hide-helper-quick-row');
    root.append(form);
    let update, disconnected = false;
    const sandbox = { document: { createElement: () => new Element() },
        MutationObserver: class {
            constructor(callback) { update = callback; }
            observe(target) { assert.equal(target, root); }
            disconnect() { disconnected = true; }
        } };
    vm.createContext(sandbox); vm.runInContext(code, sandbox);
    const cleanup = sandbox.attachQuickRow(row, form);
    assert.equal(row.parentElement.id, 'qr--bar');
    assert.equal(row.parentElement.parentElement, form);
    const bar = new Element('qr--bar'), group = new Element('', 'qr--buttons');
    bar.append(group); form.prepend(bar); update();
    assert.equal(row.parentElement, group);
    assert.equal(form.querySelectorAll('[id="qr--bar"]').length, 1);
    update(); assert.equal(group.children.length, 1);
    group.remove(); update(); assert.equal(row.parentElement, bar);
    bar.remove(); update(); assert.equal(row.parentElement.parentElement, form);
    const otherButton = new Element(); row.parentElement.append(otherButton);
    form.prepend(bar); update(); assert.equal(otherButton.isConnected, true);
    form.remove(); update();
    const replacement = new Element('send_form'); root.append(replacement); update();
    assert.equal(row.parentElement.parentElement, replacement);
    assert.equal(row.isConnected, true);
    cleanup(); assert.equal(row.isConnected, false); assert.equal(disconnected, true);
});
