export function attachQuickRow(row, anchor) {
    const root = anchor.parentElement;
    let fallback;
    const place = () => {
        const form = root.querySelector('#send_form');
        if (!form) return;
        const bar = Array.from(form.querySelectorAll('[id="qr--bar"]')).find(node => node !== fallback);
        let target = bar?.querySelector('.qr--buttons') || bar;
        if (!target) {
            if (!fallback) {
                fallback = document.createElement('div');
                fallback.id = 'qr--bar';
                fallback.className = 'hide-helper-qr-bar flex-container flexGap5';
            }
            if (fallback.parentElement !== form) form.prepend(fallback);
            target = fallback;
        }
        if (row.parentElement !== target) target.append(row);
        // Other plugins can adopt our fallback bar, so never remove their buttons.
        if (bar && fallback?.isConnected && !fallback.children.length) fallback.remove();
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
        observer.disconnect();
        row.remove();
        if (fallback?.isConnected && !fallback.children.length) fallback.remove();
    };
}

export function mountManualHideControls(anchor, { onHide, getSnapshot }) {
    const row = document.createElement('div');
    row.id = 'hide-helper-quick-row';
    row.innerHTML = `
        <button type="button" class="hh-quick-button qr--button menu_button" aria-haspopup="dialog" aria-expanded="false" title="隐藏最近2楼；长按选择数量">隐藏楼层</button>
        <section class="hh-quick-picker" role="dialog" aria-label="隐藏楼层" hidden>
            <div class="hh-quick-heading"><span>隐藏最近楼层</span><button type="button" data-close title="关闭" aria-label="关闭"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
            <div class="hh-quick-presets">
                <button type="button" data-count="1">1楼</button><button type="button" data-count="2">2楼</button>
                <button type="button" data-count="4">4楼</button><button type="button" data-count="6">6楼</button>
            </div>
            <div class="hh-quick-stepper">
                <button type="button" data-step="-1" aria-label="减少一楼" title="减少一楼"><i class="fa-solid fa-minus" aria-hidden="true"></i></button>
                <input type="number" min="1" step="1" value="2" inputmode="numeric" readonly aria-label="隐藏楼层数">
                <button type="button" data-step="1" aria-label="增加一楼" title="增加一楼"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
                <button type="button" data-confirm>隐藏</button>
            </div>
        </section>`;
    const detach = attachQuickRow(row, anchor);
    const button = row.querySelector('.hh-quick-button');
    const picker = row.querySelector('.hh-quick-picker');
    const input = row.querySelector('input');
    let timer, press, suppressClick = false, snapshot;
    const cancelTimer = () => { clearTimeout(timer); timer = undefined; };
    const close = () => {
        picker.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        input.blur();
        input.readOnly = true;
        snapshot = undefined;
    };
    const open = () => {
        if (!picker.hidden) return;
        snapshot = getSnapshot();
        input.value = '2';
        input.readOnly = true;
        picker.hidden = false;
        if (row.getBoundingClientRect) {
            const left = row.getBoundingClientRect().left;
            const width = picker.getBoundingClientRect().width;
            picker.style.left = Math.max(8 - left, Math.min(0, document.documentElement.clientWidth - 8 - left - width)) + 'px';
        }
        button.setAttribute('aria-expanded', 'true');
    };
    const apply = count => {
        const target = snapshot ?? getSnapshot();
        close();
        Promise.resolve(onHide(count, target)).catch(console.error);
    };
    button.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0) return;
        cancelTimer();
        suppressClick = false;
        press = { id: event.pointerId, x: event.clientX, y: event.clientY };
        button.setPointerCapture(event.pointerId);
        timer = setTimeout(() => {
            suppressClick = true;
            open();
        }, 500);
    });
    button.addEventListener('pointermove', event => {
        if (!press || press.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) {
            cancelTimer();
            suppressClick = true;
            close();
        }
    });
    const endPress = () => { cancelTimer(); press = undefined; };
    button.addEventListener('pointerup', endPress);
    button.addEventListener('pointercancel', () => { suppressClick = true; endPress(); close(); });
    button.addEventListener('lostpointercapture', endPress);
    button.addEventListener('click', event => {
        if (suppressClick && event.detail !== 0) { event.preventDefault(); return; }
        if (!picker.hidden) { close(); return; }
        apply(2);
    });
    button.addEventListener('contextmenu', event => {
        event.preventDefault();
        cancelTimer();
        suppressClick = true;
        open();
    });
    button.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            open();
        }
    });
    picker.addEventListener('click', event => {
        const target = event.target.closest('button');
        if (!target) return;
        if (target.hasAttribute('data-close')) close();
        else if (target.dataset.count) apply(Number(target.dataset.count));
        else if (target.dataset.step) {
            const value = Number(input.value);
            input.value = String(Math.max(1, Math.min(Number.MAX_SAFE_INTEGER,
                (Number.isSafeInteger(value) ? value : 2) + Number(target.dataset.step))));
        } else if (target.hasAttribute('data-confirm')) {
            const count = Number(input.value);
            if (!Number.isSafeInteger(count) || count < 1) {
                input.setCustomValidity('请输入大于0的整数');
                input.reportValidity();
                return;
            }
            apply(count);
        }
    });
    input.addEventListener('pointerdown', () => { input.readOnly = false; });
    input.addEventListener('keydown', event => {
        input.readOnly = false;
        if (event.key === 'Enter') { event.preventDefault(); picker.querySelector('[data-confirm]').click(); }
    });
    input.addEventListener('input', () => input.setCustomValidity(''));
    const outside = event => { if (!row.contains(event.target)) close(); };
    const escape = event => { if (event.key === 'Escape') close(); };
    const blur = () => { suppressClick = true; endPress(); close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('blur', blur);
    return () => {
        endPress();
        document.removeEventListener('pointerdown', outside);
        document.removeEventListener('keydown', escape);
        window.removeEventListener('blur', blur);
        detach();
    };
}
