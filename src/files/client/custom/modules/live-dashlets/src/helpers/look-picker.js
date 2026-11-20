/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

import {getCompanyLook, getLook, LOOK_COLORS, LOOK_STYLES} from 'live-dashlets:helpers/look';
import {createSegmented} from 'live-dashlets:helpers/segmented';

/**
 * The choice of the style and the color of every Live dashlet, shown at the top of the gallery.
 * A click applies at once; an administrator can make it the company's.
 */
class LiveDashletsLookPicker {

    /**
     * @param {import('view').default} view
     */
    constructor(view) {
        this.view = view;
        this.element = document.createElement('section');
        this.element.className = 'live-look';
        this.element.setAttribute('aria-label', this.t('title'));
        this.element.addEventListener('click', e => this.onClick(e));
    }

    /** @private */
    t(key, values = {}) {
        let text = this.view.translate(key, 'look', 'LiveDashlets');

        for (const [name, value] of Object.entries(values)) {
            text = text.replace(`{${name}}`, value);
        }

        return text;
    }

    /** @private */
    make(tag, className, text) {
        const element = document.createElement(tag);

        element.className = className;

        if (text !== undefined) {
            element.textContent = text;
        }

        return element;
    }

    /**
     * One line: the style, the color, and whose choice it is. Updated in place, so that the
     * style's thumb slides and the keyboard focus stays.
     */
    render() {
        const root = this.element;
        const look = getLook(this.view);
        const company = getCompanyLook(this.view.getConfig());
        const styleNames = this.t('styles');
        const colorNames = this.t('colors');

        root.className = `live-look live-dashlet-accent-${look.color}`;

        if (!this.styleControl) {
            this.styleControl = createSegmented({
                label: this.t('style'),
                className: 'live-look-styles',
                value: look.style,
                options: LOOK_STYLES.map(style => ({
                    value: style,
                    label: styleNames[style],
                    attributes: {'data-look-style': style},
                })),
                onChange: style => this.view.getPreferences().save({liveDashletsStyle: style}, {patch: true}),
            });

            this.colors = this.make('div', 'live-look-colors');
            this.colors.setAttribute('role', 'group');
            this.colors.setAttribute('aria-label', this.t('color'));

            LOOK_COLORS.forEach(color => {
                const option = this.make('button', `live-look-color live-dashlet-accent-${color}`);

                option.type = 'button';
                option.dataset.lookColor = color;
                option.title = colorNames[color];
                option.setAttribute('aria-label', colorNames[color]);
                this.colors.append(option);
            });

            this.foot = this.make('div', 'live-look-foot');

            root.replaceChildren(this.styleControl, this.colors, this.foot);
        }

        this.styleControl.liveSelect(look.style);

        this.colors.querySelectorAll('[data-look-color]').forEach(option => {
            option.setAttribute('aria-pressed', String(option.dataset.lookColor === look.color));
        });

        const note = this.make('span', 'live-look-note', look.personal ? this.t('personalShort') : this.t('companyShort'));

        note.title = this.t('company', {style: styleNames[company.style], color: colorNames[company.color]});

        const items = [note];

        if (look.personal) {
            const follow = this.make('button', 'btn btn-link btn-sm live-look-link', this.t('follow'));

            follow.type = 'button';
            follow.dataset.lookFollow = '1';
            items.push(follow);
        }

        if (this.view.getUser().isAdmin() && (look.style !== company.style || look.color !== company.color)) {
            const apply = this.make('button', 'btn btn-link btn-sm live-look-link', this.t('applyCompany'));

            apply.type = 'button';
            apply.dataset.lookCompany = '1';
            items.push(apply);
        }

        this.foot.replaceChildren(...items);
    }

    /** @private */
    onClick(e) {
        const target = e.target.closest('button');

        if (!target) {
            return;
        }

        const preferences = this.view.getPreferences();

        // The style is handled by its segmented control.
        if (target.dataset.lookColor) {
            preferences.save({liveDashletsColor: target.dataset.lookColor}, {patch: true});
        } else if (target.dataset.lookFollow) {
            preferences.save({liveDashletsStyle: '', liveDashletsColor: ''}, {patch: true});
        } else if (target.dataset.lookCompany) {
            this.applyCompany(target);
        }
    }

    /**
     * For administrators: the current look becomes everyone's, and theirs follows it again.
     *
     * @private
     */
    async applyCompany(button) {
        const {style, color} = getLook(this.view);

        button.disabled = true;

        try {
            await Espo.Ajax.putRequest('Settings', {liveDashletsStyle: style, liveDashletsColor: color});
        } catch (e) {
            button.disabled = false;

            return;
        }

        this.view.getConfig().set({liveDashletsStyle: style, liveDashletsColor: color});

        await this.view.getPreferences().save({liveDashletsStyle: '', liveDashletsColor: ''}, {patch: true});

        Espo.Ui.success(this.t('companySaved'));
    }
}

export default LiveDashletsLookPicker;
