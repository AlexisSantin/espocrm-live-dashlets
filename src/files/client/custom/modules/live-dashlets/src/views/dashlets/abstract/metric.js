/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

import BaseDashletView from 'views/dashlets/abstract/base';
import LiveDashletsFormatter from 'live-dashlets:helpers/formatter';

export const STYLE_LIST = ['soft', 'minimal', 'solid', 'outline', 'big'];
export const ACCENT_LIST = ['primary', 'success', 'info', 'warning', 'danger', 'default'];

/**
 * Shared logic of the KPI and goal dashlets: options, server request, number formatting and
 * the style of the whole dashlet panel.
 *
 * The figure comes from LiveDashlets/metric, computed with the viewer's own access rights.
 */
class LiveDashletsMetricView extends BaseDashletView {

    templateContent = '<div class="live-dashlet" aria-live="polite"></div>'

    // The padding is in the stylesheet, so that the sparkline can reach the edges of the panel.
    noPadding = true

    /** @type {Object|null} */
    lastData = null

    requestNumber = 0

    /** Value shown before the current one, for the count-up animation. */
    displayedValue = null

    /** @protected */
    withSeries = false

    events = {
        ...(this.events || {}),
        /** @this LiveDashletsMetricView */
        'click .live-dashlet-clickable': function (e) {
            if (e.target.closest('a, button')) {
                return;
            }

            this.openRecordList();
        },
        /** @this LiveDashletsMetricView */
        'click .live-dashlet-info': function (e) {
            const wrap = e.target.closest('.live-dashlet-info-wrap');

            if (wrap) {
                wrap.classList.toggle('live-dashlet-info-open');
            }
        },
        /** @this LiveDashletsMetricView */
        'focusout .live-dashlet-info': function (e) {
            const wrap = e.target.closest('.live-dashlet-info-wrap');

            if (wrap) {
                wrap.classList.remove('live-dashlet-info-open');
            }
        },
        /** @this LiveDashletsMetricView */
        'keydown .live-dashlet-clickable': function (e) {
            if (e.target.closest('.live-dashlet-info')) {
                if (e.key === 'Escape') {
                    e.target.closest('.live-dashlet-info-wrap').classList.remove('live-dashlet-info-open');
                }

                return;
            }

            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();

                this.openRecordList();
            }
        },
    }

    setup() {
        super.setup();

        this.formatter = new LiveDashletsFormatter(this);
    }

    /** @protected */
    getComparison() {
        return 'none';
    }

    afterAdding() {
        this.getContainerView().actionOptions();
    }

    afterRender() {
        this.applyPanelStyle();
        this.load();
    }

    actionRefresh() {
        this.load();
    }

    autoRefresh() {
        this.load();
    }

    /**
     * The tint, the color and the style apply to the whole dashlet, header included.
     *
     * @private
     */
    applyPanelStyle() {
        const panel = this.element ? this.element.closest('.dashlet') : null;

        if (!panel) {
            return;
        }

        const style = this.getTileStyle();
        const accent = ACCENT_LIST.includes(this.getOption('accentColor')) ? this.getOption('accentColor') : 'primary';

        [...panel.classList]
            .filter(name => name.startsWith('live-dashlet-style-') || name.startsWith('live-dashlet-accent-'))
            .forEach(name => panel.classList.remove(name));

        panel.classList.add('live-dashlet-panel', 'live-dashlet-style-' + style, 'live-dashlet-accent-' + accent);
    }

    /**
     * @protected
     * @return {string}
     */
    getTileStyle() {
        return STYLE_LIST.includes(this.getOption('tileStyle')) ? this.getOption('tileStyle') : 'soft';
    }

    /** @private */
    getContainer() {
        return this.element ? this.element.querySelector('.live-dashlet') : null;
    }

    /** @protected */
    getRequestParams() {
        const metric = this.getOption('metric') || 'count';
        const period = this.getOption('period') || 'ever';

        return {
            entityType: this.getOption('entityType'),
            metric: metric,
            valueField: metric === 'count' ? null : this.getOption('valueField'),
            primaryFilter: this.getOption('primaryFilter') || null,
            boolFilterList: this.getOption('boolFilterList') || [],
            dateField: period === 'ever' ? null : (this.getOption('dateField') || 'createdAt'),
            period: period,
            comparison: period === 'ever' ? 'none' : this.getComparison(),
            series: this.withSeries && period !== 'ever' ? 'true' : null,
        };
    }

    /** @private */
    load() {
        const container = this.getContainer();

        if (!container) {
            return;
        }

        const params = this.getRequestParams();

        if (!params.entityType || (params.metric !== 'count' && !params.valueField)) {
            this.renderMessage(this.translate('notConfigured', 'messages', 'LiveDashlets'), 'muted');

            return;
        }

        // Same rules as the server, checked first to spare a refused request. Comes before the
        // metadata check: EspoCRM leaves the scopes a user can't access out of their metadata.
        if (!this.hasAccess(params)) {
            this.renderMessage(this.translate('noAccess', 'messages', 'LiveDashlets'), 'muted');

            return;
        }

        if (!this.getMetadata().get(['scopes', params.entityType, 'entity'])) {
            this.renderMessage(this.translate('badConfiguration', 'messages', 'LiveDashlets'), 'danger');

            return;
        }

        const number = ++this.requestNumber;

        if (!this.lastData) {
            container.dataset.state = 'loading';
            container.replaceChildren(this.createElement('div', 'live-dashlet-loader'));
        } else {
            container.classList.add('live-dashlet-refreshing');
        }

        Espo.Ajax.getRequest('LiveDashlets/metric', params)
            .then(data => {
                if (number !== this.requestNumber || !this.getContainer()) {
                    return;
                }

                this.lastData = data;

                const container = this.getContainer();

                container.classList.remove('live-dashlet-refreshing');
                container.dataset.state = 'ready';

                this.renderData(container, data);
                this.makeClickable(container, data);
            })
            .catch(xhr => {
                if (xhr) {
                    xhr.errorIsHandled = true;
                }

                if (number !== this.requestNumber || !this.getContainer()) {
                    return;
                }

                this.lastData = null;
                this.displayedValue = null;

                const status = xhr ? xhr.status : 0;

                const key = status === 403 ? 'noAccess' : (status === 400 ? 'badConfiguration' : 'loadError');

                this.renderMessage(this.translate(key, 'messages', 'LiveDashlets'), status === 403 ? 'muted' : 'danger');
            });
    }

    /**
     * The tile opens the records behind the figure.
     *
     * @private
     */
    makeClickable(container, data) {
        const label = this.translate('showRecords', 'labels', 'LiveDashlets');

        container.classList.add('live-dashlet-clickable');
        container.setAttribute('role', 'button');
        container.setAttribute('tabindex', '0');
        container.setAttribute('aria-label', (this.getOption('title') || '') + ' · ' + label);
    }

    /** @private */
    openRecordList() {
        const data = this.lastData;
        const params = this.getRequestParams();

        if (!data || !params.entityType) {
            return;
        }

        this.createView('recordList', 'live-dashlets:views/modals/record-list', {
            entityType: params.entityType,
            where: this.buildWhere(params, data),
            title: this.getOption('title') || this.translate(params.entityType, 'scopeNamesPlural'),
            // The exact dates: the tile already says "this month".
            subtitle: data.period ?
                this.formatter.formatShortDate(data.period.start) + ' – ' +
                    this.formatter.formatShortDate(data.period.end) :
                this.getPeriodLabel(),
            valueField: params.valueField,
            dateField: params.dateField,
        }, view => view.render());
    }

    /**
     * The same selection as the figure, as where items of the list API.
     *
     * @private
     * @return {Object[]}
     */
    buildWhere(params, data) {
        const where = [];

        if (params.primaryFilter && params.primaryFilter !== 'all') {
            where.push({type: 'primary', value: params.primaryFilter});
        }

        if (params.boolFilterList.length) {
            where.push({type: 'bool', value: params.boolFilterList});
        }

        if (!data.period || !params.dateField) {
            return where;
        }

        const type = this.getMetadata().get(['entityDefs', params.entityType, 'fields', params.dateField, 'type']);
        const range = [data.period.start, data.period.end];

        if (type === 'date') {
            where.push({type: 'between', attribute: params.dateField, value: range});

            return where;
        }

        // The user's time zone, as for the figure (the list API would use the system's).
        const dateTimeItem = {
            type: 'between',
            attribute: params.dateField,
            value: range,
            dateTime: true,
            timeZone: this.getDateTime().getTimeZone(),
        };

        if (type === 'datetimeOptional') {
            where.push({
                type: 'or',
                value: [dateTimeItem, {type: 'between', attribute: params.dateField + 'Date', value: range}],
            });

            return where;
        }

        where.push(dateTimeItem);

        return where;
    }

    /** @private */
    hasAccess(params) {
        if (!this.getAcl().checkScope(params.entityType, 'read')) {
            return false;
        }

        const forbiddenList = this.getAcl().getScopeForbiddenFieldList(params.entityType);

        return ![params.valueField, params.dateField].some(field => field && forbiddenList.includes(field));
    }

    /**
     * @protected
     * @param {HTMLElement} container
     * @param {Object} data
     */
    renderData(container, data) {}

    /** @private */
    renderMessage(text, style) {
        const container = this.getContainer();

        if (!container) {
            return;
        }

        container.dataset.state = 'message';
        container.classList.remove('live-dashlet-refreshing', 'live-dashlet-clickable');
        container.removeAttribute('role');
        container.removeAttribute('tabindex');
        container.removeAttribute('aria-label');

        const message = this.createElement('div', 'live-dashlet-message text-' + style, text);

        container.replaceChildren(message);
    }

    /**
     * @protected
     * @param {string} tag
     * @param {string} [className]
     * @param {string} [text]
     * @return {HTMLElement}
     */
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

    /**
     * Entity icon, as in the navigation bar.
     *
     * @protected
     * @return {HTMLElement}
     */
    createIcon() {
        const entityType = this.getOption('entityType');
        const iconClass = entityType ?
            this.getMetadata().get(['clientDefs', entityType, 'iconClass']) :
            null;

        const icon = this.createElement('span', 'live-dashlet-icon');

        icon.setAttribute('aria-hidden', 'true');

        if (iconClass) {
            icon.append(this.createElement('span', iconClass));
        } else {
            icon.textContent = (this.translate(entityType, 'scopeNames') || '?').charAt(0);
        }

        return icon;
    }

    /**
     * @protected
     * @param {Object} data
     * @return {HTMLElement}
     */
    createPeriod(data) {
        const period = this.createElement('span', 'live-dashlet-period', this.getPeriodLabel());

        if (data.period) {
            period.title = this.formatDate(data.period.start) + ' – ' + this.formatDate(data.period.end);
        }

        return period;
    }

    /**
     * An info button beside the period: what the figure counts, over which dates, and that only
     * readable records are counted. Shown on hover, on focus and on a click (for touch screens).
     *
     * @protected
     * @param {Object} data
     * @param {string[]} [extraLines] Lines added before the access rights line.
     * @return {HTMLElement}
     */
    createInfo(data, extraLines = []) {
        const text = [...this.getInfoLines(data), ...extraLines,
            this.translate('infoAccess', 'labels', 'LiveDashlets')].join('\n');

        const wrap = this.createElement('span', 'live-dashlet-info-wrap');
        const button = this.createElement('button', 'live-dashlet-info');
        const icon = this.createElement('span', 'fas fa-info-circle');
        const pop = this.createElement('span', 'live-dashlet-info-pop', text);

        icon.setAttribute('aria-hidden', 'true');
        button.type = 'button';
        button.setAttribute('aria-label', text);
        button.append(icon);
        pop.setAttribute('aria-hidden', 'true');
        wrap.append(button, pop);

        return wrap;
    }

    /**
     * @private
     * @return {string[]}
     */
    getInfoLines(data) {
        const params = this.getRequestParams();
        const entityType = params.entityType;

        const filters = [];

        if (params.primaryFilter && params.primaryFilter !== 'all') {
            filters.push(this.translate(params.primaryFilter, 'presetFilters', entityType));
        }

        params.boolFilterList.forEach(name => filters.push(this.translate(name, 'boolFilters', entityType)));

        const lines = [
            [this.translate(entityType, 'scopeNamesPlural'), ...filters].join(' · '),
        ];

        if (params.metric === 'count') {
            lines.push(this.translate('infoCount', 'labels', 'LiveDashlets'));
        } else {
            lines.push(
                this.translate(params.metric === 'avg' ? 'infoAvg' : 'infoSum', 'labels', 'LiveDashlets')
                    .replace('{field}', this.translate(params.valueField, 'fields', entityType))
            );
        }

        if (params.dateField && data.period) {
            lines.push(
                this.translate('infoPeriod', 'labels', 'LiveDashlets')
                    .replace('{field}', this.translate(params.dateField, 'fields', entityType))
                    .replace('{start}', this.formatter.formatShortDate(data.period.start))
                    .replace('{end}', this.formatter.formatShortDate(data.period.end))
            );
        } else {
            lines.push(this.translate('infoAllTime', 'labels', 'LiveDashlets'));
        }

        return lines;
    }

    /**
     * @protected
     * @param {number|null} value
     * @param {Object} data
     * @param {{compact?: boolean, decimals?: number}} [options]
     * @return {string}
     */
    formatValue(value, data, options = {}) {
        return this.formatter.formatValue(value, data, options);
    }

    /**
     * @protected
     * @return {number}
     */
    getDecimals(value, data) {
        return this.formatter.getDecimals(value, data);
    }

    /**
     * @protected
     * @return {string}
     */
    formatNumber(value, decimals, compact) {
        return this.formatter.formatNumber(value, decimals, compact);
    }

    /**
     * @protected
     * @param {string} date Y-m-d.
     * @return {string}
     */
    formatDate(date) {
        return this.formatter.formatDate(date);
    }

    /**
     * Counts up to the new value, unless the viewer prefers reduced motion.
     *
     * @protected
     * @param {HTMLElement} element
     * @param {number|null} value
     * @param {function(number): string} format
     */
    animateValue(element, value, format) {
        const from = this.displayedValue;

        this.displayedValue = value;

        const reduceMotion = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (value === null || reduceMotion || from === value) {
            element.textContent = value === null ? '—' : format(value);

            return;
        }

        const start = from === null ? 0 : from;
        const duration = 700;
        const startTime = performance.now();

        const step = now => {
            if (!element.isConnected) {
                return;
            }

            const t = Math.min(1, (now - startTime) / duration);
            const eased = 1 - Math.pow(1 - t, 3);

            element.textContent = t < 1 ? format(start + (value - start) * eased) : format(value);

            if (t < 1) {
                requestAnimationFrame(step);
            }
        };

        element.textContent = format(start);

        requestAnimationFrame(step);
    }

    /**
     * @protected
     * @return {string}
     */
    getPeriodLabel() {
        const period = this.getOption('period') || 'ever';

        return this.translate(period, 'periods', 'LiveDashlets');
    }
}

export default LiveDashletsMetricView;
