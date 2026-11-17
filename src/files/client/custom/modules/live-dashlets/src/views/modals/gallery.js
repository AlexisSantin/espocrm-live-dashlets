/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

import ModalView from 'views/modal';
import LiveDashletsFormatter from 'live-dashlets:helpers/formatter';
import {createSparkline} from 'live-dashlets:helpers/sparkline';

const CONCURRENCY = 4;

/**
 * Ready-made indicators, each previewed with the user's real figure: one click adds it to the
 * dashboard, already configured. Only indicators on data the user can read are offered.
 *
 * Events: `add-preset` (preset, title), `add-dashlet` (dashlet name), `native` (open EspoCRM's list).
 */
class LiveDashletsGalleryModalView extends ModalView {

    templateContent = '<div class="live-gallery"></div>'

    className = 'dialog dialog-record live-gallery-dialog'

    backdrop = true

    events = {
        ...(this.events || {}),
        /** @this LiveDashletsGalleryModalView */
        'click .live-gallery-card[data-preset]': function (e) {
            this.addPreset(e.currentTarget);
        },
        /** @this LiveDashletsGalleryModalView */
        'click .live-gallery-card[data-dashlet]': function (e) {
            this.trigger('add-dashlet', e.currentTarget.dataset.dashlet);
            this.close();
        },
        /** @this LiveDashletsGalleryModalView */
        'click [data-action="nativeList"]': function () {
            this.trigger('native');
            this.close();
        },
    }

    setup() {
        super.setup();

        this.headerText = this.translate('galleryTitle', 'labels', 'LiveDashlets');

        this.buttonList = [
            {
                name: 'close',
                label: this.translate('done', 'labels', 'LiveDashlets'),
                style: 'primary',
            },
        ];

        this.formatter = new LiveDashletsFormatter(this);
        this.presetList = this.options.canConfigure ? this.getAvailablePresets() : [];
    }

    /**
     * Presets on entities and fields the user can read.
     *
     * @private
     * @return {Object[]}
     */
    getAvailablePresets() {
        const list = this.getMetadata().get(['app', 'liveDashlets', 'presetList']) || [];

        return list.filter(preset => {
            const options = preset.options || {};
            const entityType = options.entityType;

            if (!preset.name || !this.getMetadata().get(['dashlets', preset.dashlet])) {
                return false;
            }

            if (
                !entityType ||
                !this.getMetadata().get(['scopes', entityType, 'entity']) ||
                this.getMetadata().get(['scopes', entityType, 'disabled']) ||
                !this.getAcl().checkScope(entityType, 'read')
            ) {
                return false;
            }

            const forbiddenList = this.getAcl().getScopeForbiddenFieldList(entityType);

            return ![options.valueField, options.dateField]
                .some(field => field && forbiddenList.includes(field));
        });
    }

    afterRender() {
        const root = this.element.querySelector('.live-gallery');

        if (!root) {
            return;
        }

        const fragment = document.createDocumentFragment();

        if (this.presetList.length) {
            fragment.append(this.createElement(
                'p',
                'live-gallery-intro',
                this.translate('galleryIntro', 'messages', 'LiveDashlets')
            ));
        }

        const groupList = this.getMetadata().get(['app', 'liveDashlets', 'galleryGroupList']) || [];

        groupList.forEach(group => {
            const presets = this.presetList.filter(preset => preset.group === group);

            if (!presets.length) {
                return;
            }

            fragment.append(this.createGroup(
                this.translate(group, 'presetGroups', 'LiveDashlets'),
                presets.map(preset => this.createPresetCard(preset)),
                group
            ));
        });

        fragment.append(this.createGroup(
            this.translate('custom', 'presetGroups', 'LiveDashlets'),
            this.createCustomCards(),
            'custom'
        ));

        root.replaceChildren(fragment);

        this.loadPreviews();
    }

    /** @private */
    createGroup(label, cards, name) {
        const section = this.createElement('section', 'live-gallery-group');

        section.dataset.group = name;

        const grid = this.createElement('div', 'live-gallery-grid');

        grid.append(...cards);
        section.append(this.createElement('h5', 'live-gallery-group-title', label), grid);

        return section;
    }

    /** @private */
    getPresetTitle(preset) {
        return this.translate(preset.name, 'presets', 'LiveDashlets');
    }

    /** @private */
    createPresetCard(preset) {
        const options = preset.options || {};
        const accent = options.accentColor || 'primary';
        const style = options.tileStyle || 'soft';

        const card = this.createElement(
            'button',
            `live-gallery-card live-dashlet-accent-${accent} live-dashlet-style-${style}` +
            (preset.dashlet === 'LiveDashletsGoal' ? ' live-gallery-card-goal' : '')
        );

        card.type = 'button';
        card.dataset.preset = preset.name;

        const head = this.createElement('span', 'live-gallery-card-head');

        head.append(
            this.createIcon(options.entityType),
            this.createElement('span', 'live-gallery-card-title', this.getPresetTitle(preset))
        );

        const period = this.createElement(
            'span',
            'live-gallery-card-period',
            this.translate(options.period || 'ever', 'periods', 'LiveDashlets')
        );

        const preview = this.createElement('span', 'live-gallery-card-preview');

        preview.append(this.createElement('span', 'live-gallery-skeleton'));

        const add = this.createElement('span', 'live-gallery-card-add');
        const plus = this.createElement('span', 'fas fa-plus');

        plus.setAttribute('aria-hidden', 'true');
        add.append(plus, ' ', this.translate('add', 'labels', 'LiveDashlets'));

        card.append(head, period, preview, add);

        return card;
    }

    /** @private */
    createCustomCards() {
        const cards = [];

        if (this.options.canConfigure) {
            [
                ['LiveDashletsKpi', 'fas fa-hashtag', 'customKpi'],
                ['LiveDashletsGoal', 'fas fa-bullseye', 'customGoal'],
            ].forEach(([dashlet, iconClass, key]) => {
                const card = this.createElement('button', 'live-gallery-card live-gallery-card-custom');

                card.type = 'button';
                card.dataset.dashlet = dashlet;

                const icon = this.createElement('span', 'live-dashlet-icon');

                icon.setAttribute('aria-hidden', 'true');
                icon.append(this.createElement('span', iconClass));

                const head = this.createElement('span', 'live-gallery-card-head');

                head.append(icon, this.createElement('span', 'live-gallery-card-title', this.translate(dashlet, 'dashlets')));

                card.append(
                    head,
                    this.createElement('span', 'live-gallery-card-description', this.translate(key, 'messages', 'LiveDashlets'))
                );

                cards.push(card);
            });
        }

        const native = this.createElement('button', 'live-gallery-card live-gallery-card-custom');

        native.type = 'button';
        native.dataset.action = 'nativeList';

        const icon = this.createElement('span', 'live-dashlet-icon');

        icon.setAttribute('aria-hidden', 'true');
        icon.append(this.createElement('span', 'fas fa-th-large'));

        const head = this.createElement('span', 'live-gallery-card-head');

        head.append(icon, this.createElement('span', 'live-gallery-card-title', this.translate('nativeDashlets', 'labels', 'LiveDashlets')));

        native.append(
            head,
            this.createElement('span', 'live-gallery-card-description', this.translate('nativeDashlets', 'messages', 'LiveDashlets'))
        );

        cards.push(native);

        return cards;
    }

    /** @private */
    createIcon(entityType) {
        const icon = this.createElement('span', 'live-dashlet-icon');
        const iconClass = this.getMetadata().get(['clientDefs', entityType, 'iconClass']);

        icon.setAttribute('aria-hidden', 'true');

        if (iconClass) {
            icon.append(this.createElement('span', iconClass));
        } else {
            icon.textContent = this.translate(entityType, 'scopeNames').charAt(0);
        }

        return icon;
    }

    /**
     * Real figures, a few requests at a time. A preset refused by the server disappears.
     *
     * @private
     */
    loadPreviews() {
        const queue = [...this.presetList];

        const next = () => {
            const preset = queue.shift();

            if (!preset || !this.element) {
                return Promise.resolve();
            }

            const options = preset.options || {};
            const period = options.period || 'ever';

            const params = {
                entityType: options.entityType,
                metric: options.metric || 'count',
                valueField: options.valueField || null,
                primaryFilter: options.primaryFilter || null,
                boolFilterList: options.boolFilterList || [],
                dateField: period === 'ever' ? null : options.dateField,
                period: period,
                comparison: preset.dashlet === 'LiveDashletsKpi' && period !== 'ever' ?
                    (options.comparison || 'toDate') : 'none',
                series: preset.dashlet === 'LiveDashletsKpi' && period !== 'ever' ? 'true' : null,
            };

            return Espo.Ajax.getRequest('LiveDashlets/metric', params)
                .then(data => this.renderPreview(preset, data))
                .catch(xhr => {
                    if (xhr) {
                        xhr.errorIsHandled = true;
                    }

                    this.removeCard(preset.name);
                })
                .then(next);
        };

        for (let i = 0; i < CONCURRENCY; i++) {
            next();
        }
    }

    /** @private */
    getCard(name) {
        return this.element ?
            this.element.querySelector(`.live-gallery-card[data-preset="${CSS.escape(name)}"]`) :
            null;
    }

    /** @private */
    removeCard(name) {
        const card = this.getCard(name);

        if (!card) {
            return;
        }

        const section = card.closest('.live-gallery-group');

        card.remove();

        if (section && !section.querySelector('.live-gallery-card')) {
            section.remove();
        }
    }

    /** @private */
    renderPreview(preset, data) {
        const card = this.getCard(preset.name);

        if (!card) {
            return;
        }

        const preview = card.querySelector('.live-gallery-card-preview');
        const options = preset.options || {};

        const value = this.createElement(
            'span',
            'live-gallery-card-value',
            this.formatter.formatValue(data.value ?? 0, data, {compact: true})
        );

        preview.replaceChildren(value);

        if (preset.dashlet === 'LiveDashletsGoal') {
            const target = parseFloat(options.target) || 0;
            const ratio = target > 0 ? Math.min(1, (data.value || 0) / target) : 0;

            value.append(this.createElement(
                'span',
                'live-gallery-card-target',
                ' / ' + this.formatter.formatValue(target, data, {compact: true})
            ));

            const bar = this.createElement('span', 'live-gallery-card-bar');
            const fill = this.createElement('span', 'live-gallery-card-bar-fill');

            fill.style.width = (ratio * 100).toFixed(1) + '%';
            bar.append(fill);
            preview.append(bar);

            return;
        }

        if (data.previousValue !== null && data.previousValue !== undefined && data.previousValue !== 0) {
            const percent = (data.value - data.previousValue) / Math.abs(data.previousValue) * 100;
            const flat = Math.abs(percent) < 0.05;
            const up = percent > 0;
            const good = up !== !!options.lowerIsBetter;

            preview.append(this.createElement(
                'span',
                'live-gallery-card-trend live-dashlet-trend-' + (flat ? 'neutral' : (good ? 'good' : 'bad')),
                flat ?
                    this.translate('stable', 'labels', 'LiveDashlets') :
                    (up ? '+' : '') + this.formatter.formatNumber(percent, Math.abs(percent) < 10 ? 1 : 0) + ' %'
            ));
        }

        const sparkline = createSparkline(data.series);

        if (sparkline) {
            card.append(sparkline);
        }
    }

    /** @private */
    addPreset(card) {
        const preset = this.presetList.find(item => item.name === card.dataset.preset);

        if (!preset || card.classList.contains('live-gallery-card-added')) {
            return;
        }

        this.trigger('add-preset', preset, this.getPresetTitle(preset));

        card.classList.add('live-gallery-card-added');
        card.setAttribute('aria-pressed', 'true');

        const add = card.querySelector('.live-gallery-card-add');
        const check = this.createElement('span', 'fas fa-check');

        check.setAttribute('aria-hidden', 'true');
        add.replaceChildren(check, ' ', this.translate('added', 'labels', 'LiveDashlets'));
    }

    /** @private */
    createElement(tag, className, text) {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        if (text !== undefined && text !== null) {
            element.textContent = text;
        }

        return element;
    }
}

export default LiveDashletsGalleryModalView;
