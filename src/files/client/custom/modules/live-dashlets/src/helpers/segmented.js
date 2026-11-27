/************************************************************************
 * This file is part of Live Dashlets for EspoCRM.
 *
 * Copyright (C) 2026 Alexis SANTIN
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 ************************************************************************/

/**
 * One choice among a few, all visible: a segmented control with a sliding thumb or, for the
 * EspoCRM style, EspoCRM's own text buttons, the chosen one underlined as the dashboard tabs.
 * Keyboard: the arrow keys, Home and End move the choice, as in a radio group.
 *
 * @param {{
 *   label: string,
 *   options: {value: string, label: string, title?: string, attributes?: Object<string, string>}[],
 *   value: string,
 *   className?: string,
 *   native?: boolean,
 *   onChange: function(string): void,
 * }} params
 * @return {HTMLElement}
 */
export function createSegmented({label, options, value, className, native = false, onChange}) {
    const root = document.createElement('div');

    root.className = (native ? 'btn-group live-seg-native' : 'live-seg') + (className ? ' ' + className : '');
    root.setAttribute('role', 'radiogroup');
    root.setAttribute('aria-label', label);
    root.style.setProperty('--seg-count', String(options.length));

    if (!native) {
        const thumb = document.createElement('span');

        thumb.className = 'live-seg-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        root.append(thumb);
    }

    const buttons = options.map(option => {
        const button = document.createElement('button');

        button.type = 'button';
        button.className = native ? 'btn btn-text btn-sm live-seg-option' : 'live-seg-option';
        button.dataset.value = option.value;
        button.textContent = option.label;
        button.setAttribute('role', 'radio');

        if (option.title) {
            button.title = option.title;
        }

        for (const [name, attributeValue] of Object.entries(option.attributes || {})) {
            button.setAttribute(name, attributeValue);
        }

        root.append(button);

        return button;
    });

    const select = (newValue, focus = false) => {
        const index = Math.max(0, options.findIndex(option => option.value === newValue));

        root.style.setProperty('--seg-index', String(index));

        buttons.forEach((button, i) => {
            button.setAttribute('aria-checked', String(i === index));
            button.classList.toggle('active', native && i === index);
            button.tabIndex = i === index ? 0 : -1;
        });

        if (focus) {
            buttons[index].focus();
        }
    };

    root.addEventListener('click', e => {
        const button = e.target.closest('.live-seg-option');

        if (!button || button.getAttribute('aria-checked') === 'true') {
            return;
        }

        select(button.dataset.value);
        onChange(button.dataset.value);
    });

    root.addEventListener('keydown', e => {
        const index = buttons.findIndex(button => button.getAttribute('aria-checked') === 'true');
        const last = buttons.length - 1;
        const next = {
            ArrowRight: Math.min(last, index + 1),
            ArrowDown: Math.min(last, index + 1),
            ArrowLeft: Math.max(0, index - 1),
            ArrowUp: Math.max(0, index - 1),
            Home: 0,
            End: last,
        }[e.key];

        if (next === undefined) {
            return;
        }

        e.preventDefault();

        if (next !== index) {
            select(options[next].value, true);
            onChange(options[next].value);
        }
    });

    select(value);

    /** Updates the choice without drawing the control again. */
    root.liveSelect = select;

    return root;
}
