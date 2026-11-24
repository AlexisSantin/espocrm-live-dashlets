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

import LiveDashletsMetricView from 'live-dashlets:views/dashlets/abstract/metric';

/**
 * Progress toward a target, with the pace expected at this point of the period.
 */
class LiveDashletsGoalView extends LiveDashletsMetricView {

    name = 'LiveDashletsGoal'

    renderData(container, data) {
        const target = parseFloat(this.getOption('target'));

        if (!(target > 0)) {
            container.dataset.state = 'message';
            container.replaceChildren(
                this.createElement(
                    'div',
                    'live-dashlet-message text-muted',
                    this.translate('noTarget', 'messages', 'LiveDashlets')
                )
            );

            return;
        }

        const value = data.value ?? 0;
        const ratio = value / target;
        const progress = data.period ? (data.period.progress ?? null) : null;
        const status = this.getStatus(ratio, progress);

        const decimals = Math.max(this.getDecimals(value, data), this.getDecimals(target, data));
        const format = number => this.formatValue(number, data, {decimals: decimals});

        const root = this.createElement('div', `live-dashlet-goal live-dashlet-goal-${status}`);

        // Head: icon, period, status.
        const head = this.createElement('div', 'live-dashlet-head');

        head.append(this.createIcon(), this.createPeriod(data));

        this.setInfo(data, [
            this.translate('infoTarget', 'labels', 'LiveDashlets').replace('{value}', format(target)),
        ]);

        if (status !== 'none') {
            const chip = this.createElement(
                'span',
                'live-dashlet-status',
                this.translate(status, 'goalStatus', 'LiveDashlets')
            );

            if (status === 'reached') {
                const icon = this.createElement('span', 'fas fa-check');

                icon.setAttribute('aria-hidden', 'true');
                chip.prepend(icon, ' ');
            }

            head.append(chip);
        }

        // Figures.
        const figures = this.createElement('div', 'live-dashlet-goal-figures');
        const valueElement = this.createElement('span', 'live-dashlet-value');
        valueElement.style.setProperty('--ld-chars', String(format(value).length));

        const targetElement = this.createElement('span', 'live-dashlet-goal-target', '/ ' + format(target));
        const percentElement = this.createElement(
            'span',
            'live-dashlet-goal-percent',
            this.formatNumber(ratio * 100, 0) + ' %'
        );

        const arrow = this.createElement('span', 'live-dashlet-open fas fa-arrow-right');

        arrow.setAttribute('aria-hidden', 'true');

        figures.append(valueElement, ' ', targetElement, arrow, percentElement);

        // Bar with the expected pace.
        const bar = this.createElement('div', 'live-dashlet-goal-bar');

        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', String(target));
        bar.setAttribute('aria-valuenow', String(value));
        bar.setAttribute('aria-valuetext', format(value) + ' / ' + format(target));

        const fill = this.createElement('div', 'live-dashlet-goal-fill');

        bar.append(fill);

        if (progress !== null && status !== 'reached') {
            const pace = this.createElement('div', 'live-dashlet-goal-pace');

            pace.style.left = (progress * 100).toFixed(2) + '%';
            pace.title = this.translate('expectedPace', 'labels', 'LiveDashlets')
                .replace('{value}', format(target * progress));

            bar.append(pace);
        }

        root.append(head, figures, bar, this.createFoot(value, target, data, format));

        container.replaceChildren(root);

        this.animateValue(valueElement, value, format);

        // Width transition from the previous value (0 on first display).
        const width = (Math.min(1, Math.max(0, ratio)) * 100).toFixed(2) + '%';

        fill.style.width = this.displayedWidth || '0%';
        this.displayedWidth = width;

        requestAnimationFrame(() => requestAnimationFrame(() => {
            fill.style.width = width;
        }));
    }

    /**
     * @private
     * @return {'reached'|'ahead'|'behind'|'none'}
     */
    getStatus(ratio, progress) {
        if (ratio >= 1) {
            return 'reached';
        }

        if (progress === null) {
            return 'none';
        }

        return ratio >= progress ? 'ahead' : 'behind';
    }

    /** @private */
    createFoot(value, target, data, format) {
        const foot = this.createElement('div', 'live-dashlet-goal-foot');
        const parts = [];

        if (value >= target) {
            parts.push(
                this.translate('aboveTarget', 'labels', 'LiveDashlets')
                    .replace('{value}', format(value - target))
            );
        } else {
            parts.push(
                this.translate('remaining', 'labels', 'LiveDashlets')
                    .replace('{value}', format(target - value))
            );
        }

        if (data.period && data.period.daysLeft > 0) {
            const key = data.period.daysLeft === 1 ? 'dayLeft' : 'daysLeft';

            parts.push(
                this.translate(key, 'labels', 'LiveDashlets')
                    .replace('{count}', String(data.period.daysLeft))
            );
        }

        foot.textContent = parts.join(' · ');

        return foot;
    }
}

export default LiveDashletsGoalView;
