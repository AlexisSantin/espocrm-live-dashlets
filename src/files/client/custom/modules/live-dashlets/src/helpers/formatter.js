/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

/**
 * Formats figures with the user's separators and the system currency format.
 */
class LiveDashletsFormatter {

    /**
     * @param {import('view').default} view Any view, for its preferences, config and metadata.
     */
    constructor(view) {
        this.view = view;
    }

    /**
     * @param {number|null} value
     * @param {{valueType: string, currency: ?string}} data
     * @param {{compact?: boolean, decimals?: number}} [options] `decimals` keeps the precision of
     *   the final value while counting up.
     * @return {string}
     */
    formatValue(value, data, options = {}) {
        if (value === null || value === undefined) {
            return '—';
        }

        const decimals = options.decimals ?? this.getDecimals(value, data);

        let text = this.formatNumber(value, decimals, options.compact);

        if (data.currency) {
            text = this.addCurrency(text, data.currency);
        }

        return text;
    }

    /**
     * @param {number|null} value
     * @param {{valueType: string, currency: ?string}} data
     * @return {number}
     */
    getDecimals(value, data) {
        if (value === null || value === undefined || (data.valueType === 'int' && !data.currency)) {
            return 0;
        }

        if (data.currency) {
            return Math.abs(value) >= 1000 || Number.isInteger(value) ? 0 : 2;
        }

        if (Number.isInteger(value)) {
            return 0;
        }

        return Math.abs(value) >= 100 ? 0 : (Math.abs(value) >= 10 ? 1 : 2);
    }

    /**
     * @param {number} value
     * @param {number} decimals
     * @param {boolean} [compact] 12.5 k, 3.4 M.
     * @return {string}
     */
    formatNumber(value, decimals, compact) {
        let suffix = '';

        if (compact && Math.abs(value) >= 1000000) {
            value = value / 1000000;
            suffix = ' M';
            decimals = 1;
        } else if (compact && Math.abs(value) >= 10000) {
            value = value / 1000;
            suffix = ' k';
            decimals = Math.abs(value) >= 100 ? 0 : 1;
        }

        const preferences = this.view.getPreferences();
        const config = this.view.getConfig();

        const decimalMark = preferences.get('decimalMark') || config.get('decimalMark') || '.';

        let thousandSeparator = preferences.has('thousandSeparator') ?
            preferences.get('thousandSeparator') :
            config.get('thousandSeparator');

        if (thousandSeparator === undefined || thousandSeparator === null) {
            thousandSeparator = ',';
        }

        const fixed = Math.abs(value).toFixed(decimals);
        let [integer, fraction] = fixed.split('.');

        integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator);

        if (fraction && /^0+$/.test(fraction) && suffix) {
            fraction = '';
        }

        const sign = value < 0 && Number(fixed) !== 0 ? '−' : '';

        return sign + integer + (fraction ? decimalMark + fraction : '') + suffix;
    }

    /** @private */
    addCurrency(text, currency) {
        const format = this.view.getConfig().get('currencyFormat') || 1;
        const symbol = this.view.getMetadata().get(['app', 'currency', 'symbolMap', currency]) || currency;

        if (format === 2) {
            return symbol + text;
        }

        if (format === 3) {
            return text + ' ' + symbol;
        }

        return text + ' ' + currency;
    }

    /**
     * @param {string} date Y-m-d.
     * @return {string}
     */
    formatDate(date) {
        return this.view.getDateTime().toDisplayDate(date);
    }

    /**
     * "17 oct.", with the year when it is not the current one: "17 nov. 2025".
     *
     * @param {string} date Y-m-d.
     * @return {string}
     */
    formatShortDate(date) {
        const [year, month, day] = date.split('-').map(Number);
        const value = new Date(year, month - 1, day);
        const withYear = year !== new Date().getFullYear();

        try {
            return new Intl.DateTimeFormat(this.getLocale(), {
                day: 'numeric',
                month: 'short',
                ...(withYear ? {year: 'numeric'} : {}),
            }).format(value);
        } catch (e) {
            return this.formatDate(date);
        }
    }

    /**
     * Y-m-d plus a number of days.
     *
     * @param {string} date
     * @param {number} days
     * @return {string}
     */
    addDays(date, days) {
        const [year, month, day] = date.split('-').map(Number);
        const value = new Date(year, month - 1, day + days);

        const pad = number => String(number).padStart(2, '0');

        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }

    /** @private */
    getLocale() {
        const language = this.view.getPreferences().get('language') ||
            this.view.getConfig().get('language') ||
            'en_US';

        return language.replace('_', '-');
    }
}

export default LiveDashletsFormatter;
