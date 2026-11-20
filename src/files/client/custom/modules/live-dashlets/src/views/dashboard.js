/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

import DashboardView from 'views/dashboard';
import {getCompanyLook, getLook, LOOK_COLORS, LOOK_EVENTS, LOOK_STYLES} from 'live-dashlets:helpers/look';

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
        /** @this LiveDashletsDashboardView */
        'click [data-action="liveDashletsLook"]': function (e) {
            this.lookPanel ? this.closeLook() : this.openLook(e.currentTarget);
        },
    }

    /** @type {HTMLElement|null} The open style panel. */
    lookPanel = null

    setup() {
        super.setup();

        this.listenTo(this.getPreferences(), LOOK_EVENTS, () => this.renderLook());
        this.listenTo(this.getConfig(), LOOK_EVENTS, () => this.renderLook());
        this.once('remove', () => this.closeLook());
    }

    afterRender() {
        super.afterRender();

        this.addGalleryButton();
        this.addLookButton();
    }

    /** @private */
    t(key, values = {}) {
        let text = this.translate(key, 'look', 'LiveDashlets');

        for (const [name, value] of Object.entries(values)) {
            text = text.replace(`{${name}}`, value);
        }

        return text;
    }

    /**
     * One style and one color for every tile, chosen here: no setting per tile.
     *
     * @private
     */
    addLookButton() {
        const group = this.element ? this.element.querySelector('.dashboard-buttons') : null;

        if (!group || this.element.querySelector('.live-dashlets-look')) {
            return;
        }

        const button = document.createElement('button');
        const icon = document.createElement('span');
        const text = document.createElement('span');

        button.type = 'button';
        button.className = 'btn btn-default btn-sm pull-right live-dashlets-look';
        button.dataset.action = 'liveDashletsLook';
        button.title = this.t('title');
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');

        icon.className = 'fas fa-palette';
        icon.setAttribute('aria-hidden', 'true');
        text.className = 'live-dashlets-add-text';
        text.textContent = this.t('button');

        button.append(icon, text);

        // Both float right: placed after "Add", it shows on its left.
        (this.element.querySelector('.live-dashlets-add') || group).after(button);
    }

    /** @private */
    openLook(button) {
        const panel = document.createElement('div');

        panel.className = 'live-look';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', this.t('title'));

        this.lookPanel = panel;
        this.lookButton = button;
        button.setAttribute('aria-expanded', 'true');

        panel.addEventListener('click', e => this.onLookClick(e));
        panel.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                this.closeLook(true);
            }
        });

        this.onOutsideLook = e => {
            if (!panel.contains(e.target) && !button.contains(e.target)) {
                this.closeLook();
            }
        };

        this.onResizeLook = () => this.closeLook();

        document.addEventListener('pointerdown', this.onOutsideLook, true);
        window.addEventListener('resize', this.onResizeLook);

        document.body.append(panel);
        this.renderLook();
        this.placeLook();

        panel.querySelector('[aria-pressed="true"]')?.focus();
    }

    /** @private */
    closeLook(returnFocus = false) {
        if (!this.lookPanel) {
            return;
        }

        document.removeEventListener('pointerdown', this.onOutsideLook, true);
        window.removeEventListener('resize', this.onResizeLook);

        this.lookPanel.remove();
        this.lookPanel = null;

        if (this.lookButton) {
            this.lookButton.setAttribute('aria-expanded', 'false');

            if (returnFocus) {
                this.lookButton.focus();
            }
        }
    }

    /** @private */
    placeLook() {
        const rect = this.lookButton.getBoundingClientRect();
        const panel = this.lookPanel;

        panel.style.top = Math.round(rect.bottom + 6) + 'px';
        panel.style.right = Math.max(8, Math.round(window.innerWidth - rect.right)) + 'px';
    }

    /**
     * The panel shows the current choice; it is drawn again after every change.
     *
     * @private
     */
    renderLook() {
        const panel = this.lookPanel;

        if (!panel) {
            return;
        }

        const look = getLook(this);
        const company = getCompanyLook(this.getConfig());
        const make = (tag, className, text) => {
            const element = document.createElement(tag);

            element.className = className;

            if (text !== undefined) {
                element.textContent = text;
            }

            return element;
        };

        const focused = document.activeElement && panel.contains(document.activeElement) ?
            document.activeElement.dataset.lookStyle || document.activeElement.dataset.lookColor : null;

        panel.className = `live-look live-dashlet-accent-${look.color}`;

        const styles = make('div', 'live-look-styles');

        styles.setAttribute('role', 'group');
        styles.setAttribute('aria-label', this.t('style'));

        LOOK_STYLES.forEach(style => {
            const option = make('button', 'live-look-style');
            const sample = make('span', `live-look-sample live-look-sample-${style}`);

            option.type = 'button';
            option.dataset.lookStyle = style;
            option.setAttribute('aria-pressed', String(style === look.style));

            sample.append(make('span', 'live-look-sample-value', '27'), make('span', 'live-look-sample-line'));
            option.append(sample, make('span', 'live-look-name', this.t('styles')[style]));
            styles.append(option);
        });

        const colors = make('div', 'live-look-colors');

        colors.setAttribute('role', 'group');
        colors.setAttribute('aria-label', this.t('color'));

        LOOK_COLORS.forEach(color => {
            const option = make('button', `live-look-color live-dashlet-accent-${color}`);
            const name = this.t('colors')[color];

            option.type = 'button';
            option.dataset.lookColor = color;
            option.title = name;
            option.setAttribute('aria-label', name);
            option.setAttribute('aria-pressed', String(color === look.color));
            colors.append(option);
        });

        const companyText = this.t('company', {
            style: this.t('styles')[company.style],
            color: this.t('colors')[company.color],
        });

        const note = make('p', 'live-look-note', look.personal ? this.t('personal') + ' ' + companyText : companyText);
        const actions = make('div', 'live-look-actions');

        if (look.personal) {
            const follow = make('button', 'btn btn-default btn-sm', this.t('follow'));

            follow.type = 'button';
            follow.dataset.lookFollow = '1';
            actions.append(follow);
        }

        if (this.getUser().isAdmin() && (look.style !== company.style || look.color !== company.color)) {
            const apply = make('button', 'btn btn-primary btn-sm', this.t('applyCompany'));

            apply.type = 'button';
            apply.dataset.lookCompany = '1';
            actions.append(apply);
        }

        panel.replaceChildren(
            make('div', 'live-look-heading', this.t('style')),
            styles,
            make('div', 'live-look-heading', this.t('color')),
            colors,
            note,
            ...(actions.children.length ? [actions] : [])
        );

        if (focused) {
            panel.querySelector(`[data-look-style="${focused}"], [data-look-color="${focused}"]`)?.focus();
        }
    }

    /** @private */
    onLookClick(e) {
        const target = e.target.closest('button');

        if (!target) {
            return;
        }

        const preferences = this.getPreferences();

        if (target.dataset.lookStyle) {
            preferences.save({liveDashletsStyle: target.dataset.lookStyle}, {patch: true});
        } else if (target.dataset.lookColor) {
            preferences.save({liveDashletsColor: target.dataset.lookColor}, {patch: true});
        } else if (target.dataset.lookFollow) {
            preferences.save({liveDashletsStyle: '', liveDashletsColor: ''}, {patch: true});
        } else if (target.dataset.lookCompany) {
            this.applyCompanyLook(target);
        }
    }

    /**
     * For administrators: the current look becomes everyone's, and theirs follows it again.
     *
     * @private
     */
    async applyCompanyLook(button) {
        const {style, color} = getLook(this);

        button.disabled = true;

        try {
            await Espo.Ajax.putRequest('Settings', {liveDashletsStyle: style, liveDashletsColor: color});
        } catch (e) {
            button.disabled = false;

            return;
        }

        this.getConfig().set({liveDashletsStyle: style, liveDashletsColor: color});

        await this.getPreferences().save({liveDashletsStyle: '', liveDashletsColor: ''}, {patch: true});

        Espo.Ui.success(this.t('companySaved'));
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
        button.className = 'btn btn-default btn-sm pull-right live-dashlets-add';
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
            const position = this.findTopPosition(w, h);

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

    /**
     * Where a new tile goes: right after the small tiles at the top of the dashboard, filling
     * rows from left to right. A tall dashlet (stream, lists…) in the way moves down; a small
     * tile never does. The grid has gravity, so empty cells only exist at the bottom of columns.
     *
     * @private
     * @return {{x: number, y: number}}
     */
    findTopPosition(w, h) {
        const nodes = (this.grid.engine && this.grid.engine.nodes) || [];
        const columns = 12;

        const isTall = node => node.h > this.HEIGHT_MULTIPLIER;

        const tallTopList = nodes.filter(isTall).map(node => node.y);
        const bottom = nodes.reduce((max, node) => Math.max(max, node.y + node.h), 0);
        const limit = tallTopList.length ? Math.min(...tallTopList) : bottom;

        const unique = list => [...new Set(list)].sort((a, b) => a - b);

        const yList = unique([0, ...nodes.map(node => node.y), ...nodes.map(node => node.y + node.h)])
            .filter(y => y <= limit);

        const xList = unique([0, 3, 6, 9, ...nodes.map(node => node.x + node.w)])
            .filter(x => x + w <= columns);

        for (const y of yList) {
            for (const x of xList) {
                const blockerList = nodes.filter(node =>
                    node.x < x + w && x < node.x + node.w &&
                    node.y < y + h && y < node.y + node.h
                );

                if (blockerList.every(node => isTall(node) && node.y >= y)) {
                    return {x: x, y: y};
                }
            }
        }

        return {x: 0, y: limit};
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
