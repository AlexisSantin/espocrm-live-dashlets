/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 100;
const HEIGHT = 40;

let gradientCounter = 0;

/**
 * Cumulative curve of the current period (solid, with a soft area) over the previous one
 * (dashed), as returned by LiveDashlets/metric with `series=true`.
 *
 * The SVG stretches to its box; the end dot is an HTML element so that it stays round.
 *
 * @param {{length: number, current: number[], previous: ?number[]}|null} series
 * @param {{describe?: function(number): ?{text: string, previous: boolean}[]}} [options] `describe`
 *   makes the curve readable on hover: it returns the tooltip lines for a point index, each marked
 *   as the current or the previous period.
 * @return {HTMLElement|null}
 */
export function createSparkline(series, options = {}) {
    if (!series || !series.current || series.length < 2) {
        return null;
    }

    const length = series.length;
    const current = series.current;
    const previous = series.previous;

    const peak = Math.max(0, ...current, ...(previous || []));

    // Nothing in either period: a flat line would look like a fault.
    if (peak <= 0) {
        return null;
    }

    const max = peak * 1.08;

    const x = index => (index / (length - 1)) * WIDTH;
    const y = value => HEIGHT - (value / max) * HEIGHT;

    const points = values => values.map((value, i) => `${x(i).toFixed(2)},${y(value).toFixed(2)}`);

    const svg = document.createElementNS(SVG_NS, 'svg');

    svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const gradientId = 'live-dashlet-gradient-' + (++gradientCounter);

    const defs = document.createElementNS(SVG_NS, 'defs');
    const gradient = document.createElementNS(SVG_NS, 'linearGradient');

    gradient.setAttribute('id', gradientId);
    gradient.setAttribute('x1', '0');
    gradient.setAttribute('y1', '0');
    gradient.setAttribute('x2', '0');
    gradient.setAttribute('y2', '1');

    [['0', '.32'], ['1', '0']].forEach(([offset, opacity]) => {
        const stop = document.createElementNS(SVG_NS, 'stop');

        stop.setAttribute('offset', offset);
        stop.setAttribute('stop-color', 'currentColor');
        stop.setAttribute('stop-opacity', opacity);
        gradient.append(stop);
    });

    defs.append(gradient);
    svg.append(defs);

    if (previous && previous.length > 1) {
        svg.append(createPath('live-dashlet-spark-previous', 'M' + points(previous).join('L')));
    }

    const line = points(current.length > 1 ? current : [current[0], current[0]]);
    const lastX = current.length > 1 ? x(current.length - 1) : x(1);

    const area = createPath(
        'live-dashlet-spark-area',
        `M0,${HEIGHT}L` + line.join('L') + `L${lastX.toFixed(2)},${HEIGHT}Z`
    );

    area.setAttribute('fill', `url(#${gradientId})`);

    svg.append(area, createPath('live-dashlet-spark-line', 'M' + line.join('L')));

    const container = document.createElement('div');

    container.className = 'live-dashlet-spark';
    container.append(svg);

    const dot = document.createElement('span');

    dot.className = 'live-dashlet-spark-dot';
    dot.style.left = (lastX / WIDTH * 100).toFixed(2) + '%';
    dot.style.top = (y(current[current.length - 1]) / HEIGHT * 100).toFixed(2) + '%';

    container.append(dot);

    if (options.describe) {
        addHover(container, {length, current, previous, x, y, describe: options.describe});
    }

    return container;
}

/**
 * A guide, a dot on each curve and a tooltip under the pointer.
 */
function addHover(container, {length, current, previous, x, y, describe}) {
    container.classList.add('live-dashlet-spark-interactive');

    const guide = document.createElement('span');
    const currentDot = document.createElement('span');
    const previousDot = document.createElement('span');
    const tip = document.createElement('span');

    guide.className = 'live-dashlet-spark-guide';
    currentDot.className = 'live-dashlet-spark-hover-dot';
    previousDot.className = 'live-dashlet-spark-hover-dot live-dashlet-spark-hover-dot-previous';
    tip.className = 'live-dashlet-spark-tip';
    // A visual aid: the same records are listed when the tile is opened.
    tip.setAttribute('aria-hidden', 'true');

    container.append(guide, previousDot, currentDot, tip);

    const place = (element, index, value) => {
        element.hidden = value === undefined;

        if (value === undefined) {
            return;
        }

        element.style.left = (x(index) / WIDTH * 100).toFixed(2) + '%';
        element.style.top = (y(value) / HEIGHT * 100).toFixed(2) + '%';
    };

    const show = clientX => {
        const rect = container.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const index = Math.round(ratio * (length - 1));
        const lines = describe(index);

        if (!lines || !lines.length) {
            hide();

            return;
        }

        const left = x(index) / WIDTH * 100;

        guide.style.left = left.toFixed(2) + '%';

        place(currentDot, index, current[index]);
        place(previousDot, index, previous ? previous[index] : undefined);

        tip.replaceChildren(...lines.map(item => {
            const line = document.createElement('span');

            line.className = item.previous ? 'live-dashlet-spark-tip-previous' : 'live-dashlet-spark-tip-current';
            line.textContent = item.text;

            return line;
        }));

        // Kept inside the tile: anchored left, centred or right depending on the side.
        tip.dataset.align = left < 25 ? 'start' : (left > 75 ? 'end' : 'center');
        tip.style.left = left.toFixed(2) + '%';

        container.classList.add('live-dashlet-spark-hovered');
    };

    const hide = () => container.classList.remove('live-dashlet-spark-hovered');

    container.addEventListener('pointermove', e => show(e.clientX));
    container.addEventListener('pointerleave', hide);
}

function createPath(className, d) {
    const path = document.createElementNS(SVG_NS, 'path');

    path.setAttribute('class', className);
    path.setAttribute('d', d);
    path.setAttribute('vector-effect', 'non-scaling-stroke');

    return path;
}
