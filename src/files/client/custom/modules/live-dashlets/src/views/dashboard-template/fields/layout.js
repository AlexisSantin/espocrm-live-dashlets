/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

import BaseFieldView from 'views/fields/base';
import GridStack from 'gridstack';
import {findTopPosition} from 'live-dashlets:helpers/grid-position';

const WIDTH_MULTIPLIER = 3;
const HEIGHT_MULTIPLIER = 4;

/** The size of a dashlet added from the gallery or EspoCRM's list, in dashboard units. */
const SIZES = {
    LiveDashletsActions: [2, 3],
    LiveDashletsRecent: [2, 3],
    LiveDashletsKpi: [1, 1],
    LiveDashletsGoal: [2, 1],
};

const DEFAULT_SIZE = [2, 2];

/**
 * The layout of a dashboard template, shown as the dashboard itself: the same grid, the dashlets
 * with their figures (computed for the administrator, as a preview), the same + Add gallery.
 *
 * It replaces EspoCRM's editor for templates only. EspoCRM's own windows (tabs, dashlet options,
 * full dashlet list) are opened by name, so that nothing from the administration is loaded with
 * the dashboard.
 *
 * The dashlets are read-only views: EspoCRM then reads their options from the
 * `forcedDashletsOptions` setting, which this field fills with the template's options for as long
 * as it is shown (a setting otherwise only used for portals).
 */
class LiveDashletsTemplateLayoutFieldView extends BaseFieldView {

    detailTemplateContent = `
        <div class="live-template-layout">
            <div class="live-template-bar">
                {{#unless isEmpty}}<span class="text-muted live-template-note">{{note}}</span>{{/unless}}
                {{#if hasTabs}}
                <div class="btn-group dashboard-tabs live-template-tabs">
                    {{#each dashboardLayout}}
                    <button
                        type="button"
                        class="btn btn-text{{#ifEqual @index ../currentTab}} active{{/ifEqual}}"
                        data-action="selectTab"
                        data-tab="{{@index}}"
                    >{{name}}</button>
                    {{/each}}
                </div>
                {{/if}}
            </div>
            {{#if isEmpty}}<span class="none-value">{{translate 'None'}}</span>{{/if}}
            <div class="dashlets grid-stack grid-stack-12"></div>
        </div>
    `

    editTemplateContent = `
        <div class="live-template-layout live-template-editing">
            <div class="live-template-bar">
                <button
                    type="button"
                    class="btn btn-default btn-sm live-dashlets-add"
                    data-action="liveTemplateAdd"
                ><span class="fas fa-plus" aria-hidden="true"></span><span
                    class="live-dashlets-add-text">{{addLabel}}</span></button>
                <button
                    type="button"
                    class="btn btn-default btn-sm btn-icon"
                    data-action="editTabs"
                    title="{{translate 'Edit Dashboard'}}"
                    aria-label="{{translate 'Edit Dashboard'}}"
                ><span class="fas fa-pencil-alt fa-sm" aria-hidden="true"></span></button>
                <span class="text-muted live-template-note">{{note}}</span>
                {{#if hasTabs}}
                <div class="btn-group dashboard-tabs live-template-tabs">
                    {{#each dashboardLayout}}
                    <button
                        type="button"
                        class="btn btn-text{{#ifEqual @index ../currentTab}} active{{/ifEqual}}"
                        data-action="selectTab"
                        data-tab="{{@index}}"
                    >{{name}}</button>
                    {{/each}}
                </div>
                {{/if}}
            </div>
            <div class="dashlets grid-stack grid-stack-12"></div>
        </div>
    `

    validationElementSelector = '[data-action="liveTemplateAdd"]'

    data() {
        return {
            dashboardLayout: this.dashboardLayout,
            currentTab: this.currentTab,
            hasTabs: this.dashboardLayout.length > 1,
            isEmpty: this.isEmpty(),
            addLabel: this.translate('add', 'labels', 'LiveDashlets'),
            note: this.translate('templatePreview', 'labels', 'LiveDashlets'),
        };
    }

    setup() {
        super.setup();

        this.addActionHandler('selectTab', (e, target) => this.selectTab(parseInt(target.dataset.tab)));
        this.addActionHandler('removeDashlet', (e, target) => this.removeDashlet(target.dataset.id));
        this.addActionHandler('editDashlet', (e, target) => this.editDashlet(target.dataset.id, target.dataset.name));
        this.addActionHandler('editTabs', () => this.editTabs());
        this.addActionHandler('liveTemplateAdd', () => this.openGallery());

        /** @type {string[]} */
        this.dashletIdList = [];
        this.currentTab = 0;
        this.grid = null;
        this.addQueue = Promise.resolve();

        this.readValue();

        this.listenTo(this.model, 'change', () => {
            if (!this.model.hasChanged(this.name) && !this.model.hasChanged('dashletsOptions')) {
                return;
            }

            this.readValue();

            if (this.isDetailMode() && this.isRendered()) {
                this.reRender();
            }
        });

        this.once('remove', () => this.releaseOptions());
    }

    /** @private */
    readValue() {
        this.dashboardLayout = Espo.Utils.cloneDeep(this.model.get(this.name) || []);
        this.dashletsOptions = Espo.Utils.cloneDeep(this.model.get('dashletsOptions') || {});

        if (!Array.isArray(this.dashboardLayout)) {
            this.dashboardLayout = [];
        }

        this.currentTab = this.dashboardLayout.length ?
            Math.min(Math.max(this.currentTab, 0), this.dashboardLayout.length - 1) :
            -1;

        this.setupCurrentTabLayout();
    }

    /** @private */
    setupCurrentTabLayout() {
        this.currentTabLayout = this.currentTab >= 0 ?
            GridStack.Utils.sort([...(this.dashboardLayout[this.currentTab].layout || [])]) :
            null;
    }

    /** @private */
    selectTab(tab) {
        this.currentTab = tab;
        this.setupCurrentTabLayout();

        if (this.isRendered()) {
            this.reRender().then(() => {
                this.element?.querySelector(`[data-action="selectTab"][data-tab="${tab}"]`)?.focus();
            });
        }
    }

    // -----------------------------------------------------------------------------------------
    // Grid.
    // -----------------------------------------------------------------------------------------

    afterRender() {
        super.afterRender();

        this.clearDashlets();
        this.grid = null;
        this.initGrid();
    }

    /**
     * The grid of the current tab, without rendering the field again: the gallery, opened from
     * this field, stays open while a first tab is created.
     *
     * @private
     */
    initGrid() {
        const gridElement = this.getGridElement();

        if (!gridElement || !this.currentTabLayout) {
            return;
        }

        const themeManager = this.getThemeManager();
        const factor = themeManager.getFontSizeFactor();
        const editable = this.isEditMode();

        // The dashboard's own grid, for tiles of the same size.
        this.margin = Math.round(factor * themeManager.getParam('dashboardCellMargin') / 2);

        const grid = this.grid = GridStack.init({
            cellHeight: Math.ceil(factor * themeManager.getParam('dashboardCellHeight') * 1.14),
            margin: this.margin,
            column: 12,
            handle: '.panel-heading',
            staticGrid: !editable,
            disableDrag: !editable,
            disableResize: !editable,
            disableOneColumnMode: true,
            draggable: {distance: 10},
            resizable: {handles: 'se'},
            float: false,
            animate: false,
        }, gridElement);

        grid.removeAll();

        this.currentTabLayout.forEach(item => {
            grid.addWidget(this.createItem(item.id, item.name), {
                x: item.x * WIDTH_MULTIPLIER,
                y: item.y * HEIGHT_MULTIPLIER,
                w: item.width * WIDTH_MULTIPLIER,
                h: item.height * HEIGHT_MULTIPLIER,
            });
        });

        gridElement.querySelectorAll(':scope > .grid-stack-item').forEach(element => {
            element.style.position = 'absolute';
        });

        this.currentTabLayout.forEach(item => this.createDashlet(item.id, item.name));

        if (!editable) {
            return;
        }

        grid.on('change', () => {
            this.fetchLayout();
            this.trigger('change');
        });

        grid.on('resizestop', e => {
            const id = e.target?.dataset?.id;

            this.getView(`dashlet-${id}`)?.trigger('resize');
        });
    }

    /**
     * @private
     * @return {HTMLElement|null}
     */
    getGridElement() {
        return this.element?.querySelector('.live-template-layout > .grid-stack') || null;
    }

    /**
     * @private
     * @return {HTMLElement}
     */
    createItem(id, name) {
        const item = document.createElement('div');

        item.className = 'grid-stack-item';
        item.dataset.id = id;
        item.dataset.name = name;

        const content = document.createElement('div');

        content.className = 'grid-stack-item-content dashlet-container';
        content.dataset.id = id;
        content.dataset.name = name;

        // A dashlet that no longer exists keeps its place and its title, as in EspoCRM.
        if (!this.getMetadata().get(['dashlets', name])) {
            const panel = document.createElement('div');
            const heading = document.createElement('div');
            const title = document.createElement('h4');

            panel.className = 'panel panel-default dashlet';
            heading.className = 'panel-heading';
            title.className = 'panel-title';
            title.textContent = this.getDashletTitle(id, name);

            heading.append(title);
            panel.append(heading);
            content.append(panel);
        }

        item.append(content);

        if (this.isEditMode()) {
            item.append(this.createTools(id, name));
        }

        return item;
    }

    /**
     * Edit and remove, over the dashlet's heading.
     *
     * @private
     * @return {HTMLElement}
     */
    createTools(id, name) {
        const tools = document.createElement('div');

        tools.className = 'live-template-tools';
        tools.style.top = `${this.margin + 7}px`;
        tools.style.right = `${this.margin + 8}px`;

        const button = (action, icon, label) => {
            const element = document.createElement('button');
            const iconElement = document.createElement('span');

            element.type = 'button';
            element.className = 'btn btn-default btn-sm btn-icon';
            element.dataset.action = action;
            element.dataset.id = id;
            element.dataset.name = name;
            element.title = label;
            element.setAttribute('aria-label', `${label} · ${this.getDashletTitle(id, name)}`);

            iconElement.className = icon;
            iconElement.setAttribute('aria-hidden', 'true');
            element.append(iconElement);

            return element;
        };

        if (this.getMetadata().get(['dashlets', name])) {
            tools.append(button('editDashlet', 'fas fa-pencil-alt fa-sm', this.translate('Edit')));
        }

        tools.append(button('removeDashlet', 'fas fa-times', this.translate('Remove')));

        return tools;
    }

    /** @private */
    getDashletTitle(id, name) {
        return (this.dashletsOptions[id] || {}).title || this.translate(name, 'dashlets');
    }

    /**
     * The dashlet itself, with the template's options.
     *
     * @private
     */
    createDashlet(id, name) {
        if (!this.getMetadata().get(['dashlets', name])) {
            return;
        }

        const key = `dashlet-${id}`;

        this.clearView(key);
        this.shareOptions();

        this.createView(key, 'views/dashlet', {
            selector: `.live-template-layout > .grid-stack .dashlet-container[data-id="${CSS.escape(id)}"]`,
            id: id,
            name: name,
            label: name,
            readOnly: true,
            locked: true,
        }, view => {
            if (!this.dashletIdList.includes(id)) {
                this.dashletIdList.push(id);
            }

            view.render();
        });
    }

    /** @private */
    clearDashlets() {
        this.dashletIdList.forEach(id => this.clearView(`dashlet-${id}`));
        this.dashletIdList = [];
    }

    /**
     * Read-only dashlets read their options from this setting.
     *
     * @private
     */
    shareOptions() {
        this.sharedOptions = this.dashletsOptions;
        this.getConfig().set('forcedDashletsOptions', this.dashletsOptions, {silent: true});
    }

    /** @private */
    releaseOptions() {
        if (this.sharedOptions && this.getConfig().get('forcedDashletsOptions') === this.sharedOptions) {
            this.getConfig().set('forcedDashletsOptions', null, {silent: true});
        }

        this.sharedOptions = null;
    }

    /** @private */
    fetchLayout() {
        const gridElement = this.getGridElement();

        if (this.currentTab < 0 || !gridElement) {
            return;
        }

        const items = gridElement.querySelectorAll(':scope > .grid-stack-item');

        this.dashboardLayout[this.currentTab].layout = [...items].map(element => {
            const node = element.gridstackNode || {};
            const attribute = (name, fallback) => Number(element.getAttribute(name) ?? fallback);

            return {
                id: element.dataset.id,
                name: element.dataset.name,
                x: (node.x ?? attribute('gs-x', 0)) / WIDTH_MULTIPLIER,
                y: (node.y ?? attribute('gs-y', 0)) / HEIGHT_MULTIPLIER,
                width: (node.w ?? attribute('gs-w', WIDTH_MULTIPLIER)) / WIDTH_MULTIPLIER,
                height: (node.h ?? attribute('gs-h', HEIGHT_MULTIPLIER)) / HEIGHT_MULTIPLIER,
            };
        });

        this.setupCurrentTabLayout();
    }

    // -----------------------------------------------------------------------------------------
    // Editing.
    // -----------------------------------------------------------------------------------------

    /** @private */
    removeDashlet(id) {
        const item = this.getGridElement()?.querySelector(`:scope > .grid-stack-item[data-id="${CSS.escape(id)}"]`);

        this.clearView(`dashlet-${id}`);
        this.dashletIdList = this.dashletIdList.filter(other => other !== id);

        if (item && this.grid) {
            this.grid.removeWidget(item, true);
        }

        if (this.currentTab >= 0) {
            const tab = this.dashboardLayout[this.currentTab];

            tab.layout = (tab.layout || []).filter(dashlet => dashlet.id !== id);
        }

        delete this.dashletsOptions[id];

        this.setupCurrentTabLayout();
        this.trigger('change');
    }

    /** @private */
    editDashlet(id, name) {
        const options = Espo.Utils.cloneDeep(this.dashletsOptions[id] || {});
        const defaults = this.getMetadata().get(['dashlets', name, 'options', 'defaults']) || {};

        Object.keys(defaults).forEach(key => {
            if (!(key in options)) {
                options[key] = Espo.Utils.cloneDeep(defaults[key]);
            }
        });

        if (!('title' in options)) {
            options.title = this.translate(name, 'dashlets');
        }

        const optionsView = this.getMetadata().get(['dashlets', name, 'options', 'view']) ||
            'views/dashlets/options/base';

        this.createView('options', optionsView, {
            name: name,
            optionsData: options,
            fields: this.getMetadata().get(['dashlets', name, 'options', 'fields']) || {},
            userId: null,
        }, view => {
            view.render();

            this.listenToOnce(view, 'save', attributes => {
                this.dashletsOptions[id] = attributes;

                view.close();

                this.createDashlet(id, name);
                this.trigger('change');
            });
        });
    }

    /** @private */
    editTabs() {
        this.createView('editTabs', 'views/modals/edit-dashboard', {
            dashboardLayout: this.dashboardLayout,
            tabListIsNotRequired: true,
        }, view => {
            view.render();

            this.listenToOnce(view, 'after:save', data => {
                view.close();

                const layout = [];

                data.dashboardTabList.forEach(name => {
                    const existing = this.dashboardLayout.find(tab => tab.name === name);

                    layout.push({
                        name: name in data.renameMap ? data.renameMap[name] : name,
                        layout: existing ? existing.layout : [],
                        id: existing && existing.id ? existing.id : this.generateTabId(),
                    });
                });

                this.dashboardLayout = layout;
                this.removeUnusedOptions();
                this.trigger('change');
                this.selectTab(layout.length ? 0 : -1);
            });
        });
    }

    /** @private */
    generateTabId() {
        return Math.floor(Math.random() * 10000001).toString();
    }

    /** @private */
    removeUnusedOptions() {
        const used = new Set();

        this.dashboardLayout.forEach(tab => (tab.layout || []).forEach(item => used.add(item.id)));

        Object.keys(this.dashletsOptions).forEach(id => {
            if (!used.has(id)) {
                delete this.dashletsOptions[id];
            }
        });
    }

    // -----------------------------------------------------------------------------------------
    // Adding.
    // -----------------------------------------------------------------------------------------

    /** @private */
    openGallery() {
        const addedIdList = [];

        this.createView('liveGallery', 'live-dashlets:views/modals/gallery', {
            canConfigure: true,
        }, view => {
            view.render();

            this.listenTo(view, 'add-preset', (preset, title) => {
                const id = this.addTile(preset, title);

                if (id) {
                    addedIdList.push(id);
                }
            });

            this.listenToOnce(view, 'add-dashlet', name => this.addByName(name));
            this.listenToOnce(view, 'native', () => this.openNativeList());

            this.listenToOnce(view, 'close', () => {
                this.addQueue.then(() => this.highlight(addedIdList));
            });
        });
    }

    /** @private */
    openNativeList() {
        this.createView('addDashlet', 'views/modals/add-dashlet', {
            parentType: this.model.entityType,
        }, view => {
            view.render();

            this.listenToOnce(view, 'add', name => this.addByName(name));
        });
    }

    /**
     * A dashlet chosen by its name: a KPI or a goal opens its options right away.
     *
     * @private
     */
    addByName(name) {
        const [width, height] = SIZES[name] || DEFAULT_SIZE;
        const configurable = ['LiveDashletsKpi', 'LiveDashletsGoal'].includes(name);

        const id = this.addTile(
            {dashlet: name, width: width, height: height, options: {}},
            configurable ? this.translate(name, 'dashlets') : null
        );

        if (id && configurable) {
            this.addQueue.then(() => this.editDashlet(id, name));
        }
    }

    /**
     * Adds a dashlet with its options, in the band of small tiles at the top.
     *
     * @private
     * @param {{dashlet: string, width?: number, height?: number, options?: Object}} preset
     * @param {string|null} title
     * @return {string|null}
     */
    addTile(preset, title) {
        if (!this.getMetadata().get(['dashlets', preset.dashlet])) {
            return null;
        }

        const id = 'd' + Math.floor(Math.random() * 1000001).toString();

        this.addQueue = this.addQueue
            .then(() => this.ensureGrid())
            .then(() => this.placeTile(id, preset, title))
            .catch(error => console.error('Live Dashlets: the dashlet could not be added.', error));

        return id;
    }

    /**
     * A template without a tab gets one first.
     *
     * @private
     */
    ensureGrid() {
        if (this.grid && this.currentTab >= 0) {
            return;
        }

        if (!this.dashboardLayout.length) {
            this.dashboardLayout.push({
                name: this.translate('My Espo'),
                layout: [],
                id: this.generateTabId(),
            });
        }

        this.currentTab = Math.max(this.currentTab, 0);
        this.setupCurrentTabLayout();
        this.initGrid();
    }

    /** @private */
    placeTile(id, preset, title) {
        if (!this.grid) {
            return;
        }

        const options = Espo.Utils.cloneDeep(preset.options || {});

        if (title) {
            options.title = title;
        }

        if (Object.keys(options).length) {
            this.dashletsOptions[id] = options;
        }

        const w = (preset.width || 1) * WIDTH_MULTIPLIER;
        const h = (preset.height || 1) * HEIGHT_MULTIPLIER;
        const position = findTopPosition(this.grid, w, h, HEIGHT_MULTIPLIER);

        this.grid.addWidget(this.createItem(id, preset.dashlet), {x: position.x, y: position.y, w: w, h: h});

        this.fetchLayout();
        this.createDashlet(id, preset.dashlet);
        this.trigger('change');
    }

    /** @private */
    highlight(idList) {
        const panels = idList
            .map(id => this.getGridElement()?.querySelector(`.dashlet-container[data-id="${CSS.escape(id)}"]`))
            .filter(panel => panel);

        if (!panels.length) {
            return;
        }

        panels[0].scrollIntoView({block: 'nearest', behavior: 'smooth'});

        panels.forEach(panel => {
            const dashlet = panel.querySelector('.dashlet') || panel;

            dashlet.classList.add('live-dashlet-just-added');

            setTimeout(() => dashlet.classList.remove('live-dashlet-just-added'), 2200);
        });
    }

    // -----------------------------------------------------------------------------------------
    // Value.
    // -----------------------------------------------------------------------------------------

    /** @private */
    isEmpty() {
        return !this.dashboardLayout.some(tab => (tab.layout || []).length);
    }

    validateRequired() {
        if (!this.isRequired() || !this.isEmpty()) {
            return false;
        }

        const message = this.translate('fieldIsRequired', 'messages').replace('{field}', this.getLabelText());

        this.showValidationMessage(message);

        return true;
    }

    fetch() {
        if (!this.dashboardLayout.length) {
            return {[this.name]: null, dashletsOptions: {}};
        }

        return {
            [this.name]: Espo.Utils.cloneDeep(this.dashboardLayout),
            dashletsOptions: Espo.Utils.cloneDeep(this.dashletsOptions),
        };
    }
}

export default LiveDashletsTemplateLayoutFieldView;
