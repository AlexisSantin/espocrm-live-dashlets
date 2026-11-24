/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

/**
 * Where a new tile goes: right after the small tiles at the top of the dashboard, filling
 * rows from left to right. A tall dashlet (stream, lists…) in the way moves down; a small
 * tile never does. The grid has gravity, so empty cells only exist at the bottom of columns.
 *
 * @param {{engine?: {nodes?: {x: number, y: number, w: number, h: number}[]}}} grid A GridStack grid.
 * @param {number} w The width, in grid columns.
 * @param {number} h The height, in grid rows.
 * @param {number} rowsPerUnit Grid rows in one dashboard row: taller tiles count as tall.
 * @return {{x: number, y: number}}
 */
export function findTopPosition(grid, w, h, rowsPerUnit) {
    const nodes = (grid.engine && grid.engine.nodes) || [];
    const columns = 12;

    const isTall = node => node.h > rowsPerUnit;

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
