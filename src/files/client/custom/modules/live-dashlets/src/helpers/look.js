/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

/**
 * One look for every tile: a style and a color chosen for the whole dashboard. The company's
 * choice is a setting, a user's own choice a preference; an empty preference follows the company.
 * A tile can only be highlighted, in a solid color.
 */

export const LOOK_STYLES = ['minimal', 'outline', 'big'];

export const LOOK_COLORS = ['primary', 'info', 'success', 'warning', 'danger', 'default'];

/** The change events that call for drawing the tiles again. */
export const LOOK_EVENTS = 'change:liveDashletsStyle change:liveDashletsColor change:liveDashletsTeam';

/** The change of the team whose work is shown. */
export const TEAM_EVENT = 'change:liveDashletsTeam';

/**
 * The user's teams, when they belong to more than one: only then is there a team to choose.
 *
 * @param {import('view').default} view
 * @return {{id: string, name: string}[]}
 */
export function getUserTeams(view) {
    const user = view.getUser();
    const ids = user.get('teamsIds') || [];
    const names = user.get('teamsNames') || {};

    return ids.length > 1 ? ids.map(id => ({id, name: names[id] || id})) : [];
}

/**
 * The team whose work the dashboard shows: records assigned to its members. Null for all of
 * the user's teams.
 *
 * @param {import('view').default} view
 * @return {{id: string, name: string}|null}
 */
export function getTeamFilter(view) {
    const id = view.getPreferences().get('liveDashletsTeam');

    return getUserTeams(view).find(team => team.id === id) || null;
}

const pick = (value, list, fallback) => list.includes(value) ? value : fallback;

/**
 * @param {import('models/settings').default} config
 * @return {{style: string, color: string}}
 */
export function getCompanyLook(config) {
    return {
        style: pick(config.get('liveDashletsStyle'), LOOK_STYLES, 'minimal'),
        color: pick(config.get('liveDashletsColor'), LOOK_COLORS, 'primary'),
    };
}

/**
 * @param {import('view').default} view
 * @return {{style: string, color: string, personal: boolean}}
 */
export function getLook(view) {
    const preferences = view.getPreferences();
    const company = getCompanyLook(view.getConfig());
    const style = preferences.get('liveDashletsStyle');
    const color = preferences.get('liveDashletsColor');

    return {
        style: pick(style, LOOK_STYLES, company.style),
        color: pick(color, LOOK_COLORS, company.color),
        personal: LOOK_STYLES.includes(style) || LOOK_COLORS.includes(color),
    };
}

/**
 * Puts the look on the dashlet's panel, header included. Every Live dashlet has it: figures,
 * goals, next actions and what happened.
 *
 * @param {import('view').default} view
 * @param {string} [style] A style of its own: "solid" for a highlighted tile.
 */
export function applyLookToPanel(view, style) {
    const panel = view.element ? view.element.closest('.dashlet') : null;

    if (!panel) {
        return;
    }

    const look = getLook(view);

    [...panel.classList]
        .filter(name => name.startsWith('live-dashlet-style-') || name.startsWith('live-dashlet-accent-'))
        .forEach(name => panel.classList.remove(name));

    panel.classList.add('live-dashlet-panel', 'live-dashlet-style-' + (style || look.style), 'live-dashlet-accent-' + look.color);
}

/**
 * Calls back when the user's or the company's choice changes.
 *
 * @param {import('view').default} view
 * @param {function(): void} callback
 */
export function watchLook(view, callback) {
    view.listenTo(view.getPreferences(), LOOK_EVENTS, callback);
    view.listenTo(view.getConfig(), LOOK_EVENTS, callback);
}

/**
 * Tiles made before 1.4 had their own style: a solid one stays highlighted until it is changed.
 *
 * @param {boolean|undefined|null} highlight
 * @param {string|undefined|null} formerStyle
 */
export function isHighlighted(highlight, formerStyle) {
    if (highlight === true || highlight === false) {
        return highlight;
    }

    return formerStyle === 'solid';
}
