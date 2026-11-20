/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

import LiveDashletsMetricView from 'live-dashlets:views/dashlets/abstract/metric';
import {createSparkline} from 'live-dashlets:helpers/sparkline';

/**
 * A key figure with its trend against the previous period and the curve of the period.
 */
class LiveDashletsKpiView extends LiveDashletsMetricView {

    name = 'LiveDashletsKpi'

    withSeries = true

    getComparison() {
        return this.getOption('comparison') || 'toDate';
    }

    renderData(container, data) {
        const decimals = this.getDecimals(data.value, data);
        const format = value => this.formatValue(value, data, {decimals: decimals});

        const root = this.createElement('div', 'live-dashlet-kpi');

        // Where the change goes: in the head (default); beside the figure, with the comparison
        // below ("big figure"); or in a line under the figure, with the comparison ("minimal").
        const style = this.getTileStyle();
        const big = style === 'big';
        const foot = style === 'minimal';

        // Head: icon, period, info and, on the right, the change.
        const head = this.createElement('div', 'live-dashlet-head');
        const infoLines = data.previousPeriod ?
            [
                this.translate('previousPeriodRange', 'labels', 'LiveDashlets')
                    .replace('{start}', this.formatter.formatShortDate(data.previousPeriod.start))
                    .replace('{end}', this.formatter.formatShortDate(data.previousPeriod.end)),
            ] :
            [];

        head.append(this.createIcon(), this.createPeriod(data));

        this.setInfo(data, infoLines);

        const badge = this.createTrendBadge(data);

        if (badge && !big && !foot) {
            head.append(badge);
        }

        // The figure, with what it is compared to.
        const main = this.createElement('div', 'live-dashlet-main');
        const value = this.createElement('span', 'live-dashlet-value');

        value.title = format(data.value);
        value.style.setProperty('--ld-chars', String(data.value === null ? 1 : format(data.value).length));
        main.append(value);

        const compare = badge ?
            this.createElement('span', 'live-dashlet-compare', this.getCompareText(data, format)) :
            null;

        if (badge && !foot) {
            main.append(big ? badge : compare);
        }

        const arrow = this.createElement('span', 'live-dashlet-open fas fa-arrow-right');

        arrow.setAttribute('aria-hidden', 'true');
        main.append(arrow);

        root.append(head, main);

        if (big && compare) {
            root.append(compare);
        }

        if (foot && badge) {
            const line = this.createElement('div', 'live-dashlet-kpi-foot');

            line.append(badge, compare);
            root.append(line);
        }

        // The curve of the period fills the bottom of the tile, edge to edge.
        const sparkline = createSparkline(data.series, {
            describe: index => this.describePoint(data, index),
        });

        if (sparkline) {
            root.classList.add('live-dashlet-has-spark');
            root.append(sparkline);
        }

        container.replaceChildren(root);

        this.animateValue(value, data.value, format);
    }

    /**
     * @private
     * @return {HTMLElement|null}
     */
    createTrendBadge(data) {
        if (data.previousValue === null || data.previousValue === undefined || data.value === null) {
            return null;
        }

        const value = data.value;
        const previous = data.previousValue;
        const difference = value - previous;

        const direction = Math.abs(difference) < 1e-9 ? 'flat' : (difference > 0 ? 'up' : 'down');
        const lowerIsBetter = !!this.getOption('lowerIsBetter');

        let quality = 'neutral';

        if (direction !== 'flat') {
            quality = (direction === 'up') !== lowerIsBetter ? 'good' : 'bad';
        }

        const badge = this.createElement('span', `live-dashlet-trend-badge live-dashlet-trend-${quality}`);
        const arrow = this.createElement('span', {
            up: 'fas fa-arrow-up',
            down: 'fas fa-arrow-down',
            flat: 'fas fa-equals',
        }[direction]);

        arrow.setAttribute('aria-hidden', 'true');

        badge.append(arrow, ' ', this.getChangeText(value, previous, data, direction));

        if (data.previousPeriod) {
            badge.title = this.translate('previousPeriodRange', 'labels', 'LiveDashlets')
                .replace('{start}', this.formatDate(data.previousPeriod.start))
                .replace('{end}', this.formatDate(data.previousPeriod.end));
        }

        return badge;
    }

    /**
     * "vs 5 on 17 Oct" while the period runs, "vs 33 last month" for a whole period.
     *
     * @private
     */
    getCompareText(data, format) {
        return this.getDifferenceText(data, format) + this.getPreviousText(data, format);
    }

    /**
     * "+6 " before the comparison: the change as a value, beside the percentage of the badge.
     * Left out when the badge already shows it (from zero) or when nothing changed.
     *
     * @private
     */
    getDifferenceText(data, format) {
        const difference = data.value - data.previousValue;

        if (!data.previousValue || Math.abs(difference) < 1e-9) {
            return '';
        }

        return (difference > 0 ? '+' : '') + format(difference) + ' ';
    }

    /** @private */
    getPreviousText(data, format) {
        const period = this.getOption('period') || 'ever';
        const value = format(data.previousValue);

        if (this.getComparison() === 'full' || ['lastSevenDays', 'lastThirtyDays'].includes(period)) {
            return this.translate('comparedToPrevious', 'labels', 'LiveDashlets')
                .replace('{value}', value)
                .replace('{period}', this.translate(period, 'previousPeriods', 'LiveDashlets'));
        }

        if (period === 'today') {
            return this.translate('comparedToYesterday', 'labels', 'LiveDashlets').replace('{value}', value);
        }

        return this.translate('comparedToDate', 'labels', 'LiveDashlets')
            .replace('{value}', value)
            .replace('{date}', data.previousPeriod ? this.formatter.formatShortDate(data.previousPeriod.end) : '');
    }

    /**
     * Tooltip lines for a point of the curve: the cumulated value at that date, and the
     * previous period's at the same point.
     *
     * @private
     * @return {{text: string, previous: boolean}[]|null}
     */
    describePoint(data, index) {
        const series = data.series;

        if (!series || !data.period) {
            return null;
        }

        const decimals = this.getDecimals(data.value, data);
        const format = value => this.formatValue(value, data, {decimals: decimals});

        const label = (start, dayOffset) => {
            if (series.unit === 'hour') {
                return this.translate('hourLabel', 'labels', 'LiveDashlets').replace('{hour}', String(dayOffset));
            }

            return this.formatter.formatShortDate(this.formatter.addDays(start, dayOffset));
        };

        const line = (start, value) => this.translate('pointValue', 'labels', 'LiveDashlets')
            .replace('{date}', label(start, index))
            .replace('{value}', format(value));

        const lines = [];

        if (index < series.current.length) {
            lines.push({text: line(data.period.start, series.current[index]), previous: false});
        }

        if (series.previous && index < series.previous.length && data.previousPeriod) {
            const previousLine = line(data.previousPeriod.start, series.previous[index]);

            lines.push({
                text: series.unit === 'hour' ?
                    this.translate('yesterday', 'labels', 'LiveDashlets') + ' ' + previousLine :
                    previousLine,
                previous: true,
            });
        }

        return lines.length ? lines : null;
    }

    /** @private */
    getChangeText(value, previous, data, direction) {
        if (direction === 'flat') {
            return this.translate('stable', 'labels', 'LiveDashlets');
        }

        // No percentage from zero: show the difference itself.
        if (previous === 0) {
            const difference = value - previous;

            return (difference > 0 ? '+' : '') + this.formatValue(difference, data, {compact: true});
        }

        const percent = (value - previous) / Math.abs(previous) * 100;
        const decimals = Math.abs(percent) < 10 ? 1 : 0;

        return (percent > 0 ? '+' : '') + this.formatNumber(percent, decimals) + ' %';
    }
}

export default LiveDashletsKpiView;
