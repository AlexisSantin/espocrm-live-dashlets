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

import DashboardView from 'views/dashboard';
import {findTopPosition} from 'live-dashlets:helpers/grid-position';
import {isNativeLook, watchLook} from 'live-dashlets:helpers/look';

/**
 * The home dashboard, with a visible "Add" button that opens the gallery of ready-made
 * indicators. "Add Dashlet" in the dashboard menu opens the same gallery, which still links
 * to EspoCRM's full dashlet list.
 */
class LiveDashletsDashboardView extends DashboardView {

    events = {
        ...(this.events || {}),
        /** @this LiveDashletsDashboardView */
        'click .dashboard-buttons [data-action="addDashlet"]': function () {
            this.openGallery();
        },
        /** @this LiveDashletsDashboardView */
        'click [data-action="liveDashletsGallery"]': function () {
            this.openGallery();
        },
    }

    setup() {
        super.setup();

        // The EspoCRM style keeps EspoCRM's own button.
        watchLook(this, () => this.element?.querySelector('.live-dashlets-add')
            ?.classList.toggle('live-dashlets-add-pill', !isNativeLook(this)));
    }

    afterRender() {
        super.afterRender();

        this.addGalleryButton();
    }

    /** @private */
    canAdd() {
        return !this.layoutReadOnly && !this.getPreferences().get('dashboardLocked');
    }

    /** @private */
    addGalleryButton() {
        const group = this.element ? this.element.querySelector('.dashboard-buttons') : null;

        if (!group || !this.canAdd() || this.element.querySelector('.live-dashlets-add')) {
            return;
        }

        const button = document.createElement('button');

        button.type = 'button';
        button.className = 'btn btn-default btn-sm pull-right live-dashlets-add' +
            (isNativeLook(this) ? '' : ' live-dashlets-add-pill');
        button.dataset.action = 'liveDashletsGallery';
        button.title = this.translate('galleryTitle', 'labels', 'LiveDashlets');

        const icon = document.createElement('span');

        icon.className = 'fas fa-plus';
        icon.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');

        text.className = 'live-dashlets-add-text';
        text.textContent = this.translate('add', 'labels', 'LiveDashlets');

        button.append(icon, text);

        // Both float right: placed after the menu, the button shows on its left.
        group.after(button);
    }

    /** @private */
    openGallery() {
        if (!this.canAdd()) {
            return;
        }

        const addedIdList = [];

        this.createView('liveDashletsGallery', 'live-dashlets:views/modals/gallery', {
            canConfigure: !this.dashletsReadOnly,
        }, view => {
            view.render();

            this.listenTo(view, 'add-preset', (preset, title) => {
                const id = this.addConfiguredDashlet(preset, title);

                if (id) {
                    addedIdList.push(id);
                }
            });

            this.listenToOnce(view, 'add-dashlet', name => this.addCustomDashlet(name));
            this.listenToOnce(view, 'native', () => this.openNativeList());

            // Once every addition is placed.
            this.listenToOnce(view, 'close', () => {
                this.getAddQueue().then(() => this.highlightDashlets(addedIdList));
            });
        });
    }

    /** @private */
    getAddQueue() {
        return this.addQueue || Promise.resolve();
    }

    removeDashlet(id) {
        if (this.addedOptions) {
            delete this.addedOptions[id];
        }

        super.removeDashlet(id);
    }

    /**
     * An empty KPI or goal, at the size of the ready-made ones, then its options.
     *
     * @private
     */
    addCustomDashlet(name) {
        if (!['LiveDashletsKpi', 'LiveDashletsGoal'].includes(name)) {
            this.addDashlet(name);

            return;
        }

        const id = this.addConfiguredDashlet(
            {dashlet: name, width: name === 'LiveDashletsGoal' ? 2 : 1, height: 1, options: {}},
            this.translate(name, 'dashlets')
        );

        if (!id) {
            return;
        }

        this.getAddQueue().then(() => {
            const dashletView = this.getView(`dashlet-${id}`);
            const bodyView = dashletView ? dashletView.getBodyView() : null;

            if (bodyView && bodyView.afterAdding) {
                bodyView.afterAdding();
            }
        });
    }

    /** @private */
    openNativeList() {
        this.createView('addDashlet', 'views/modals/add-dashlet', {}, view => {
            view.render();

            this.listenToOnce(view, 'add', name => this.addDashlet(name));
        });
    }

    /**
     * Adds a dashlet with its options already set, in the band of small tiles at the top.
     *
     * The options are saved first, the dashlet is placed after: every layout save of the grid
     * returns the whole preferences, and a response arriving in between would otherwise drop
     * options that only exist in the browser. Additions run one after the other.
     *
     * @private
     * @param {{dashlet: string, width?: number, height?: number, options: Object}} preset
     * @param {string} title
     * @return {string|null} The new dashlet id.
     */
    addConfiguredDashlet(preset, title) {
        if (this.dashletsReadOnly || !this.getMetadata().get(['dashlets', preset.dashlet])) {
            return null;
        }

        const id = 'd' + Math.floor(Math.random() * 1000001).toString();

        this.addedOptions = this.addedOptions || {};
        this.addedOptions[id] = {...Espo.Utils.cloneDeep(preset.options || {}), title: title};

        this.addQueue = this.getAddQueue()
            .then(() => this.saveAddedOptions())
            .then(() => this.placeDashlet(id, preset))
            .catch(error => console.error('Live Dashlets: the dashlet could not be added.', error));

        return id;
    }

    /**
     * @private
     * @return {Promise}
     */
    saveAddedOptions() {
        const dashletsOptions = {
            ...Espo.Utils.cloneDeep(this.getPreferences().get('dashletsOptions') || {}),
            ...Espo.Utils.cloneDeep(this.addedOptions || {}),
        };

        return this.getPreferences().save({dashletsOptions: dashletsOptions}, {patch: true});
    }

    /**
     * @private
     * @return {Promise}
     */
    placeDashlet(id, preset) {
        return new Promise(resolve => {
            let revertToFallback = false;

            if (this.isFallbackMode()) {
                this.initGridstack();

                revertToFallback = true;
            }

            const name = preset.dashlet;
            const w = (preset.width || 1) * this.WIDTH_MULTIPLIER;
            const h = (preset.height || 1) * this.HEIGHT_MULTIPLIER;
            const position = findTopPosition(this.grid, w, h, this.HEIGHT_MULTIPLIER);

            const $item = this.prepareGridstackItem(id, name);

            this.grid.addWidget($item.get(0), {x: position.x, y: position.y, w: w, h: h});

            this.createDashletView(id, name, name, () => {
                this.fetchLayout();
                this.saveLayout();
                this.setupCurrentTabLayout();

                if (revertToFallback) {
                    this.initFallbackMode();
                }

                resolve();
            });
        });
    }

    /** @private */
    highlightDashlets(idList) {
        const panels = idList
            .map(id => this.element && this.element.querySelector(`.dashlet[data-id="${CSS.escape(id)}"]`))
            .filter(panel => panel);

        if (!panels.length) {
            return;
        }

        panels[0].scrollIntoView({block: 'nearest', behavior: 'smooth'});

        panels.forEach(panel => {
            panel.classList.add('live-dashlet-just-added');

            setTimeout(() => panel.classList.remove('live-dashlet-just-added'), 2200);
        });
    }
}

export default LiveDashletsDashboardView;
