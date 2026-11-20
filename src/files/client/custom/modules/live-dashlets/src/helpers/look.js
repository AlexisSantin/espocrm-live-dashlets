/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

/**
 * One look for every tile: a style and a color chosen for the whole dashboard. The company's
 * choice is a setting, a user's own choice a preference; an empty preference follows the company.
 * A tile can only be highlighted, in a solid color.
 */

export const LOOK_STYLES = ['soft', 'minimal', 'outline', 'big'];

export const LOOK_COLORS = ['primary', 'info', 'success', 'warning', 'danger', 'default'];

/** The change events that call for drawing the tiles again. */
export const LOOK_EVENTS = 'change:liveDashletsStyle change:liveDashletsColor';

const pick = (value, list, fallback) => list.includes(value) ? value : fallback;

/**
 * @param {import('models/settings').default} config
 * @return {{style: string, color: string}}
 */
export function getCompanyLook(config) {
    return {
        style: pick(config.get('liveDashletsStyle'), LOOK_STYLES, 'soft'),
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
