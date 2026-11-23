/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

import BaseDashletView from 'views/dashlets/abstract/base';
import LiveDashletsFormatter from 'live-dashlets:helpers/formatter';
import {applyLookToPanel, getTeamFilter, TEAM_EVENT, watchLook} from 'live-dashlets:helpers/look';
import {createSegmented} from 'live-dashlets:helpers/segmented';

const ICONS = {
    call: 'fas fa-phone',
    meeting: 'fas fa-calendar-check',
    email: 'fas fa-envelope',
    contact: 'fas fa-user-plus',
    lead: 'fas fa-user-plus',
    account: 'fas fa-building',
    deal: 'fas fa-trophy',
    task: 'fas fa-check',
};

/** The type menu: which kinds of events each choice shows. */
const TYPES = {
    all: null,
    calls: ['call'],
    meetings: ['meeting'],
    emails: ['email'],
    added: ['contact', 'lead', 'account'],
    deals: ['deal'],
    tasks: ['task'],
};

const SCOPES = ['team', 'me', 'all'];

const TONES = {
    held: 'good',
    won: 'good',
    noAnswer: 'warn',
    notHeld: 'warn',
    lost: 'bad',
};

/**
 * What happened recently: one line per event, the details on a click.
 *
 * The list comes from LiveDashlets/recent, read with the user's own access rights.
 */
class LiveDashletsRecentView extends BaseDashletView {

    name = 'LiveDashletsRecent'

    templateContent = '<div class="live-recent" aria-live="polite"></div>'

    noPadding = true

    /** @type {Object|null} */
    feed = null

    requestNumber = 0

    /** @type {Set<string>} */
    openKeys = new Set()

    /** Events after this time (ms) are new to the user; null on a first visit. */
    seenBefore = null

    events = {
        ...(this.events || {}),
        /** @this LiveDashletsRecentView */
        'click [data-recent-toggle]': function (e) {
            const key = e.currentTarget.dataset.recentToggle;

            this.openKeys.has(key) ? this.openKeys.delete(key) : this.openKeys.add(key);
            this.renderList();
            this.getContainer()?.querySelector(`[data-recent-toggle="${CSS.escape(key)}"]`)?.focus();
        },
        /** @this LiveDashletsRecentView */
        'change .live-recent-type': function (e) {
            this.prefs.type = e.currentTarget.value;
            this.saveState();
            this.renderList();
        },
        /** @this LiveDashletsRecentView */
        'click .live-recent-notes': function () {
            this.prefs.notes = !this.prefs.notes;
            this.saveState();
            this.renderList();
            this.getContainer()?.querySelector('.live-recent-notes')?.focus();
        },
        // A plain click previews the record; Ctrl, Cmd or the middle button open it in a new tab.
        /** @this LiveDashletsRecentView */
        'click a[data-live-type]': function (e) {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) {
                return;
            }

            e.preventDefault();

            this.showRecord(e.currentTarget.dataset.liveType, e.currentTarget.dataset.liveId);
        },
    }

    setup() {
        super.setup();

        // The style and the color chosen for every Live dashlet.
        watchLook(this, () => applyLookToPanel(this));

        // "My team" is the team chosen for the dashboard, when there is one.
        this.listenTo(this.getPreferences(), TEAM_EVENT, () => this.load());

        this.formatter = new LiveDashletsFormatter(this);

        const scope = SCOPES.includes(this.getOption('scope')) ? this.getOption('scope') : 'team';

        this.prefs = {scope, type: 'all', notes: !!this.getOption('showNotes'), ...this.readState()};
        this.seenBefore = this.readSeen();
    }

    afterRender() {
        applyLookToPanel(this);

        this.load();
    }

    actionRefresh() {
        this.load();
    }

    autoRefresh() {
        this.load();
    }

    // -----------------------------------------------------------------------------------------
    // What the user chose, and when they last looked: kept in this browser only.
    // -----------------------------------------------------------------------------------------

    /** @private */
    storageKey(name) {
        return `liveDashlets.recent.${name}.${this.getUser().id}.${this.options.id || ''}`;
    }

    /** @private */
    readState() {
        try {
            const state = JSON.parse(localStorage.getItem(this.storageKey('state')) || '{}');

            return {
                ...(SCOPES.includes(state.scope) ? {scope: state.scope} : {}),
                ...(state.type in TYPES ? {type: state.type} : {}),
                ...(typeof state.notes === 'boolean' ? {notes: state.notes} : {}),
            };
        } catch (e) {
            return {};
        }
    }

    /** @private */
    saveState() {
        try {
            localStorage.setItem(this.storageKey('state'), JSON.stringify(this.prefs));
        } catch (e) {}
    }

    /**
     * The time of the previous visit; this visit is remembered for the next one. What arrived in
     * between stays marked as new until the page is reloaded.
     *
     * @private
     * @return {number|null}
     */
    readSeen() {
        let previous = null;

        try {
            previous = parseInt(localStorage.getItem(this.storageKey('seen')) || '', 10) || null;
            localStorage.setItem(this.storageKey('seen'), String(Date.now()));
        } catch (e) {}

        return previous;
    }

    // -----------------------------------------------------------------------------------------
    // Loading.
    // -----------------------------------------------------------------------------------------

    /** @private */
    getContainer() {
        return this.element ? this.element.querySelector('.live-recent') : null;
    }

    /** @private */
    load() {
        const container = this.getContainer();

        if (!container) {
            return;
        }

        const number = ++this.requestNumber;

        if (!this.feed) {
            container.replaceChildren(this.make('div', 'live-dashlet-loader live-recent-loader'));
        }

        Espo.Ajax
            .getRequest('LiveDashlets/recent', {
                scope: this.prefs.scope,
                teamId: getTeamFilter(this)?.id || null,
                days: this.getDays(),
            })
            .then(data => {
                if (number !== this.requestNumber || !this.getContainer()) {
                    return;
                }

                this.feed = data;
                this.renderList();
            })
            .catch(xhr => {
                if (xhr) {
                    xhr.errorIsHandled = true;
                }

                if (number === this.requestNumber && this.getContainer()) {
                    this.getContainer().replaceChildren(this.make(
                        'div',
                        'live-dashlet-message text-muted',
                        this.translate(xhr?.status === 403 ? 'noAccess' : 'loadError', 'messages', 'LiveDashlets')
                    ));
                }
            });
    }

    /** @private */
    getDays() {
        return parseInt(this.getOption('days'), 10) || 7;
    }

    // -----------------------------------------------------------------------------------------
    // Rendering.
    // -----------------------------------------------------------------------------------------

    /** @private */
    renderList() {
        const container = this.getContainer();

        if (!container || !this.feed) {
            return;
        }

        const kinds = TYPES[this.prefs.type];
        const events = this.feed.events.filter(event => !kinds || kinds.includes(event.kind));
        const list = this.make('div', 'live-recent-list');

        if (this.feed.noTeam && this.prefs.scope === 'team') {
            list.append(this.make('p', 'live-recent-hint', this.t('noTeam')));
        }

        let date = null;
        let group = null;

        for (const event of events) {
            if (event.date !== date) {
                date = event.date;
                group = this.make('section', 'live-recent-day');
                group.append(this.make('h4', 'live-recent-day-title', this.getDayLabel(date)));
                list.append(group);
            }

            group.append(this.createEvent(event));
        }

        if (!events.length) {
            list.append(this.make('div', 'live-dashlet-message text-muted', this.t('empty', {days: this.getDays()})));
        }

        container.replaceChildren(this.createToolbar(), list);
    }

    /** @private */
    createToolbar() {
        const bar = this.make('div', 'live-recent-toolbar');

        const scope = createSegmented({
            label: this.t('scopeLabel'),
            className: 'live-recent-scope',
            value: this.prefs.scope,
            options: SCOPES.map(name => ({
                value: name,
                label: name === 'team' && getTeamFilter(this) ?
                    getTeamFilter(this).name :
                    this.t(name, {}, 'recentScopesShort'),
                title: this.t(name, {}, 'recentScopes'),
            })),
            onChange: name => {
                this.prefs.scope = name;
                this.focusScope = true;
                this.saveState();
                this.load();
            },
        });

        if (this.focusScope) {
            requestAnimationFrame(() => scope.querySelector('[aria-checked="true"]')?.focus());
            this.focusScope = false;
        }

        const counts = {};

        for (const event of this.feed.events) {
            for (const [name, kinds] of Object.entries(TYPES)) {
                if (!kinds || kinds.includes(event.kind)) {
                    counts[name] = (counts[name] || 0) + 1;
                }
            }
        }

        const type = this.createSelect('live-recent-type', this.t('typeLabel'), Object.keys(TYPES)
            .filter(name => name === 'all' || counts[name] || name === this.prefs.type)
            .map(name => [name, this.t(name, {}, 'recentTypes') + (counts[name] ? ` (${counts[name]})` : '')]), this.prefs.type);

        const notes = this.make('button', 'live-recent-notes');

        notes.type = 'button';
        notes.setAttribute('role', 'switch');
        notes.setAttribute('aria-checked', String(this.prefs.notes));
        notes.append(this.make('span', 'live-recent-switch'), this.t('notes'));

        bar.append(scope, type, notes);

        return bar;
    }

    /** @private */
    createSelect(className, label, options, value) {
        const select = this.make('select', `form-control input-sm ${className}`);

        select.setAttribute('aria-label', label);
        select.title = label;

        for (const [name, text] of options) {
            const option = this.make('option', null, text);

            option.value = name;
            option.selected = name === value;
            select.append(option);
        }

        return select;
    }

    /** @private */
    createEvent(event) {
        const isOpen = this.openKeys.has(event.key);
        const isNew = this.isNewEvent(event);
        const item = this.make('article', 'live-recent-item' + (isOpen ? ' live-recent-open' : ''));
        const row = this.make('button', 'live-recent-row');

        row.type = 'button';
        row.dataset.recentToggle = event.key;
        row.setAttribute('aria-expanded', String(isOpen));

        const dot = this.make('span', 'live-recent-dot' + (isNew ? ' live-recent-new' : ''));

        if (isNew) {
            dot.title = this.t('newSinceVisit');
            dot.append(this.make('span', 'sr-only', this.t('newSinceVisit')));
        }

        const icon = this.make('span', `live-recent-icon live-recent-kind-${event.kind} live-recent-${event.result}`);

        icon.append(this.icon(event.kind === 'deal' && event.result === 'lost' ? 'fas fa-times-circle' : ICONS[event.kind]));

        const text = this.make('span', 'live-recent-text');
        const line = this.make('span', 'live-recent-line');

        line.append(this.make('b', null, this.getEventTitle(event)));

        if (event.subtitle) {
            line.append(' ', this.make('span', 'live-recent-sub', event.subtitle));
        }

        text.append(line);

        if (this.prefs.notes && event.note && !isOpen) {
            text.append(this.make('span', 'live-recent-note-line', event.note));
        }

        const result = this.make('span', `live-recent-result live-recent-tone-${TONES[event.result] || 'plain'}`, this.getEventResult(event));
        const time = this.make('span', 'live-recent-time', event.time ? this.formatter.formatTime(event.time) : '');

        row.append(dot, icon, text, result, time);
        item.append(row);

        if (isOpen) {
            item.append(this.createDetail(event));
        }

        return item;
    }

    /** @private */
    createDetail(event) {
        const detail = this.make('div', 'live-recent-detail');
        const parts = [this.withLink(this.make('span', null, this.getRecordLabel(event)), event.links.record)];

        if (event.minutes) {
            parts.push(' · ' + this.t('minutes', {count: event.minutes}));
        }

        if (event.actor) {
            parts.push(' · ' + (event.mine ? this.t('byYou') : this.t('by', {name: event.actor.name})));
        }

        const about = this.make('div', 'live-recent-about');

        about.append(...parts);
        detail.append(about);

        if (event.note) {
            detail.append(this.make('p', 'live-recent-note', event.note));
        }

        if (event.members.length) {
            const names = this.make('div', 'live-recent-members');

            event.members.forEach(member => names.append(this.withLink(this.make('span', null, member.name), member.link)));
            detail.append(names);
        }

        if (event.next) {
            const next = this.make('div', 'live-recent-next');

            next.append(
                this.icon('fas fa-arrow-right'),
                ' ',
                this.withLink(this.make('span', null, event.next.name), event.next.link),
                event.next.date ? ' · ' + this.formatter.formatShortDate(event.next.date) : ''
            );

            detail.append(next);
        }

        const links = this.make('div', 'live-recent-links');

        if (event.links.title) {
            links.append(this.withLink(this.make('span', null, this.t('open', {name: this.getEventTitle(event)})), event.links.title));
        }

        if (event.links.subtitle && event.subtitle) {
            links.append(this.withLink(this.make('span', null, this.t('open', {name: event.subtitle})), event.links.subtitle));
        }

        if (links.childNodes.length) {
            detail.append(links);
        }

        return detail;
    }

    // -----------------------------------------------------------------------------------------
    // Text.
    // -----------------------------------------------------------------------------------------

    /** @private */
    t(key, values = {}, category = 'recentLabels') {
        let text = this.translate(key, category, 'LiveDashlets');

        for (const [name, value] of Object.entries(values)) {
            text = text.replace(`{${name}}`, value);
        }

        return text;
    }

    /** @private */
    getEventTitle(event) {
        if (event.count) {
            return this.t(`${event.kind}Group`, {count: event.count});
        }

        return event.title || this.translate(event.links.record.type, 'scopeNames');
    }

    /** @private */
    getEventResult(event) {
        const text = this.t(event.kind + event.result.charAt(0).toUpperCase() + event.result.slice(1), {}, 'recentResults');

        if (event.kind === 'deal' && event.amount !== null && event.amount !== undefined) {
            return text + ' · ' + this.formatter.formatValue(event.amount, {
                valueType: 'currency',
                currency: event.currency || this.getConfig().get('defaultCurrency'),
            });
        }

        return text;
    }

    /** What the record is: "Call · Follow-up", "Email · Re: proposal". @private */
    getRecordLabel(event) {
        const type = this.translate(event.links.record.type, 'scopeNames');

        return event.label && event.label !== this.getEventTitle(event) ? `${type} · ${event.label}` : type;
    }

    /** @private */
    getDayLabel(date) {
        const today = this.feed.today;

        if (date === today) {
            return this.t('today');
        }

        if (date === this.formatter.addDays(today, -1)) {
            return this.t('yesterday');
        }

        return this.formatter.formatWeekdayDate(date);
    }

    /** @private */
    isNewEvent(event) {
        if (this.seenBefore === null || event.mine || !event.at) {
            return false;
        }

        return Date.parse(event.at.replace(' ', 'T') + 'Z') > this.seenBefore;
    }

    // -----------------------------------------------------------------------------------------
    // Elements.
    // -----------------------------------------------------------------------------------------

    /** @private */
    make(tag, className, text) {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        if (text !== undefined && text !== null) {
            element.textContent = text;
        }

        return element;
    }

    /** @private */
    icon(className) {
        const icon = this.make('span', className);

        icon.setAttribute('aria-hidden', 'true');

        return icon;
    }

    /** @private */
    withLink(content, link) {
        if (!link) {
            return content;
        }

        const anchor = this.make('a', 'live-recent-link');

        anchor.href = `#${link.type}/view/${link.id}`;
        anchor.dataset.liveType = link.type;
        anchor.dataset.liveId = link.id;
        anchor.append(content);

        return anchor;
    }

    /** @private */
    async showRecord(entityType, id) {
        const RecordModal = await Espo.loader.requirePromise('helpers/record-modal');

        await new RecordModal().showDetail(this, {entityType, id});
    }
}

export default LiveDashletsRecentView;
