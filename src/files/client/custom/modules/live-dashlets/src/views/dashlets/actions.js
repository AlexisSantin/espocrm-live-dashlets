/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

import BaseDashletView from 'views/dashlets/abstract/base';
import LiveDashletsFormatter from 'live-dashlets:helpers/formatter';
import {applyLookToPanel, watchLook} from 'live-dashlets:helpers/look';

const KINDS = {
    task: {icon: 'fas fa-tasks', accent: 'warning'},
    call: {icon: 'fas fa-phone', accent: 'success'},
    meeting: {icon: 'fas fa-calendar-check', accent: 'info'},
    lead: {icon: 'fas fa-user-plus', accent: 'primary'},
    deal: {icon: 'fas fa-dollar-sign', accent: 'info'},
    followUp: {icon: 'fas fa-calendar-check', accent: 'warning'},
};

const PRIMARY = {
    call: ['fas fa-phone', 'call'],
    complete: ['fas fa-check', 'complete'],
    close: ['fas fa-check', 'close'],
    followUp: ['fas fa-plus', 'followUp'],
    open: ['fas fa-arrow-right', 'open'],
};

const OUTCOMES = {
    call: ['held', 'noAnswer', 'message'],
    meeting: ['held', 'notHeld'],
};

const NEXT_STEPS = ['in3Days', 'in7Days', 'meeting', 'none'];

const UNDO_DELAY = 8000;
const CONFIRM_DELAY = 5000;
const MAX_RECAPS = 8;
const MIN_FITTED_ROWS = 3;
/** What a template's preview still allows: folding and copying change no record. */
const PREVIEW_ACTIONS = ['toggleMore', 'toggleStale', 'toggleDone', 'hideDone', 'copyPhone', 'cancelPanel'];
const DONE_LIMIT = 30;

const DONE_ICONS = {
    call: 'fas fa-phone',
    meeting: 'fas fa-calendar-check',
    task: 'fas fa-check',
    email: 'fas fa-envelope',
    added: 'fas fa-plus',
};

const FOLLOW_UP_ICONS = {
    Task: 'fas fa-tasks',
    Meeting: 'fas fa-calendar-check',
    Call: 'fas fa-phone',
};

/**
 * What to do now: the user's next actions, each with its reason and a button to act.
 *
 * The list comes from LiveDashlets/actions. Every change goes through EspoCRM's standard API,
 * with the user's rights, its validation and its hooks.
 */
class LiveDashletsActionsView extends BaseDashletView {

    name = 'LiveDashletsActions'

    templateContent = '<div class="live-actions" aria-live="polite"></div>'

    noPadding = true

    /** @type {Object|null} */
    queue = null

    /**
     * `exchange` is undefined while loading, null when there is none, false when unavailable.
     *
     * @type {{key: string, mode: string, outcome: string, next: string, note: string, exchange: *}|null}
     */
    panel = null

    expanded = false

    /** @type {{open: boolean, items: Object[]|null, loading: boolean, confirming: boolean, archiving: boolean}} */
    staleSection = {open: false, items: null, loading: false, confirming: false, archiving: false}

    /** @type {{text: string, action: function(): Promise, timer: number, busy: boolean, recapId: number|null}|null} */
    undoOffer = null

    /**
     * What was just done, kept where the row was until the user hides it.
     *
     * @type {{id: number, beforeKey: string|null, data: Object}[]}
     */
    recaps = []

    recapNumber = 0

    doneOpen = false

    requestNumber = 0

    /** Fresh data arrived while a menu was open: drawing it would close the menu. */
    renderPending = false

    events = {
        ...(this.events || {}),
        /** @this LiveDashletsActionsView */
        'click [data-live-action]': function (e) {
            const action = e.currentTarget.dataset.liveAction;

            // In a template's preview, a call link must not dial either.
            if (this.isPreview() && !PREVIEW_ACTIONS.includes(action)) {
                e.preventDefault();
            }

            this.runAction(action, e.currentTarget);
        },
        // A plain click previews the record; Ctrl, Cmd or the middle button open it in a new tab.
        /** @this LiveDashletsActionsView */
        'click a[data-live-type]': function (e) {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) {
                return;
            }

            e.preventDefault();

            this.showRecord(e.currentTarget.dataset.liveType, e.currentTarget.dataset.liveId);
        },
        /** @this LiveDashletsActionsView */
        'click [data-live-choice]': function (e) {
            this.choose(e.currentTarget);
        },
        /** @this LiveDashletsActionsView */
        'input .live-actions-note': function (e) {
            if (this.panel) {
                this.panel.note = e.currentTarget.value;
            }
        },
        /** @this LiveDashletsActionsView */
        'input .live-actions-snooze-date': function (e) {
            if (this.panel) {
                this.panel.date = e.currentTarget.value;
            }
        },
        /** @this LiveDashletsActionsView */
        'hidden.bs.dropdown .live-actions-menu': function () {
            if (this.renderPending) {
                this.renderList();
            }
        },
    }

    setup() {
        super.setup();

        // The style and the color chosen for every Live dashlet.
        watchLook(this, () => applyLookToPanel(this));

        this.formatter = new LiveDashletsFormatter(this);
    }

    afterRender() {
        applyLookToPanel(this);

        this.load();
    }

    onRemove() {
        clearTimeout(this.undoOffer?.timer);
        clearTimeout(this.confirmTimer);
    }

    actionRefresh() {
        this.load();
    }

    autoRefresh() {
        // Never under the user's hands.
        if (
            this.panel ||
            this.undoOffer ||
            this.staleSection.confirming ||
            this.staleSection.archiving ||
            this.element?.querySelector('.live-actions-menu.open')
        ) {
            return;
        }

        this.load();
    }

    /** @private */
    getContainer() {
        return this.element ? this.element.querySelector('.live-actions') : null;
    }

    /** @private */
    t(category, key, values = {}) {
        let text = this.translate(key, category, 'LiveDashlets');

        for (const [name, value] of Object.entries(values)) {
            text = text.replace(`{${name}}`, () => value);
        }

        return text;
    }

    /**
     * Shown in a dashboard template's editor rather than on a dashboard.
     *
     * @private
     */
    isPreview() {
        return !!this.element?.closest('.live-template-layout');
    }

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

    // -----------------------------------------------------------------------------------------
    // Loading.
    // -----------------------------------------------------------------------------------------

    /** @private */
    load() {
        const container = this.getContainer();

        if (!container) {
            return Promise.resolve();
        }

        const number = ++this.requestNumber;

        if (!this.queue) {
            container.replaceChildren(this.make('div', 'live-dashlet-loader live-actions-loader'));
        }

        const stale = this.staleSection;

        return Promise
            .all([
                Espo.Ajax.getRequest('LiveDashlets/actions', {
                    dormantDays: this.getOption('dormantDays') || 14,
                    staleDays: this.getStaleDays(),
                    withDone: 1,
                    signals: this.getOption('enabledSignals') || undefined,
                }),
                stale.open ? this.fetchStale() : null,
            ])
            .then(([data, staleData]) => {
                if (number !== this.requestNumber || !this.getContainer()) {
                    return;
                }

                this.queue = data;
                stale.items = staleData ? staleData.items : null;

                // Stays open during the undo offer: closing everything may be undone.
                if (!data.staleCount && !this.undoOffer) {
                    stale.open = false;
                }

                const listed = [...data.items, ...(stale.items || [])];

                if (this.panel && !listed.some(item => item.key === this.panel.key)) {
                    this.panel = null;
                }

                if (this.element.querySelector('.live-actions-menu.open')) {
                    this.renderPending = true;

                    return;
                }

                this.renderList();
            })
            .catch(xhr => {
                if (xhr) {
                    xhr.errorIsHandled = true;
                }

                if (number === this.requestNumber && this.getContainer()) {
                    this.renderMessage(this.t('messages', xhr?.status === 403 ? 'noAccess' : 'loadError'));
                }
            });
    }

    /** @private */
    getStaleDays() {
        return this.getOption('staleDays') || 30;
    }

    /** @private */
    fetchStale() {
        return Espo.Ajax.getRequest('LiveDashlets/actions', {section: 'stale', staleDays: this.getStaleDays()});
    }

    /** @private */
    renderMessage(text) {
        this.getContainer().replaceChildren(this.make('div', 'live-dashlet-message text-muted', text));
    }

    // -----------------------------------------------------------------------------------------
    // Rendering.
    // -----------------------------------------------------------------------------------------

    /** @private */
    renderList() {
        const data = this.queue;
        const container = this.getContainer();

        this.renderPending = false;

        if (!data.available) {
            this.renderMessage(this.t('messages', 'noAccess'));

            return;
        }

        const focus = this.getFocusSelector(container);
        const fragment = document.createDocumentFragment();

        if (data.items.length) {
            this.appendItems(fragment);
        } else {
            this.recaps.forEach(recap => fragment.append(this.createDone(recap.data, recap.id)));
            fragment.append(this.createEmptyState());
        }

        this.appendFolds(fragment);

        if (this.undoOffer) {
            fragment.append(this.createUndo());
        }

        container.replaceChildren(fragment);
        this.fitRows(container);

        if (focus) {
            container.querySelector(focus)?.focus();
        }
    }

    /**
     * Keeps the keyboard where it was when the list is drawn again.
     *
     * @private
     * @return {string|null}
     */
    getFocusSelector(container) {
        const active = document.activeElement;
        const action = active instanceof HTMLElement ? active.dataset.liveAction : null;

        if (!action || !container.contains(active)) {
            return null;
        }

        const key = active.closest('[data-key]')?.dataset.key;

        return (key ? `[data-key="${CSS.escape(key)}"] ` : '') + `[data-live-action="${action}"]`;
    }

    /** @private */
    appendItems(fragment) {
        const data = this.queue;
        const limit = this.getOption('displayRecords') || 6;
        const visible = this.expanded ? data.items : data.items.slice(0, limit);

        const placed = new Set();

        const appendRecaps = accept => {
            this.recaps.filter(recap => !placed.has(recap) && accept(recap)).forEach(recap => {
                placed.add(recap);
                fragment.append(this.createDone(recap.data, recap.id));
            });
        };

        fragment.append(this.createSummary());

        visible.forEach((item, index) => {
            appendRecaps(recap => recap.beforeKey === item.key);
            fragment.append(this.createRow(item, index === 0));

            if (this.panel?.key === item.key) {
                fragment.append(this.createPanel(item));
            }
        });

        appendRecaps(() => true);

        // Only what can really be shown: the server sends a limited number of rows.
        const others = data.items.length - visible.length;

        if (others > 0 || this.expanded) {
            fragment.append(this.createMoreLink(others));
        }
    }

    /** @private */
    createMoreLink(others) {
        const more = this.make('button', 'live-actions-more-link');

        more.type = 'button';
        more.dataset.liveAction = 'toggleMore';
        more.textContent = this.expanded ?
            this.t('actionLabels', 'showLess') :
            this.t('actionLabels', others === 1 ? 'showOneMore' : 'showMore', {count: others});

        return more;
    }

    /**
     * Folded, the list keeps to the dashlet: rows that say why take more room, so the last ones
     * go under "Show more" rather than making the dashlet scroll. An open panel may scroll.
     *
     * @private
     */
    fitRows(container) {
        const body = container.closest('.dashlet-body');

        if (this.expanded || this.panel || !body || !body.clientHeight) {
            return;
        }

        const rows = [...container.querySelectorAll(':scope > .live-actions-row')];
        const fits = () => body.scrollHeight <= body.clientHeight + 1;
        let dropped = 0;

        while (!fits() && rows.length - dropped > MIN_FITTED_ROWS) {
            const row = rows[rows.length - 1 - dropped];

            if (row.contains(document.activeElement)) {
                break;
            }

            row.remove();
            dropped++;
        }

        if (!dropped) {
            return;
        }

        const others = this.queue.items.length - rows.length + dropped;
        const link = this.createMoreLink(others);
        const current = container.querySelector(':scope > .live-actions-more-link');

        if (current) {
            current.replaceWith(link);
        } else {
            rows[rows.length - 1 - dropped].after(link);
        }
    }

    /**
     * Old overdue tasks, kept out of the way until the user wants to sort them out.
     *
     * @private
     */
    createStale() {
        const stale = this.staleSection;
        const section = this.make('section', 'live-actions-fold live-actions-stale');

        if (stale.loading) {
            section.append(this.make('div', 'live-dashlet-loader live-actions-loader'));

            return section;
        }

        (stale.items || []).forEach(item => {
            section.append(this.createRow(item, false));

            if (this.panel?.key === item.key) {
                section.append(this.createPanel(item));
            }
        });

        if (this.getArchivable().length) {
            const footer = this.make('div', 'live-actions-stale-footer');
            const button = this.make('button', 'btn btn-sm btn-default');

            button.type = 'button';
            button.dataset.liveAction = 'archiveStale';
            this.updateArchiveButton(button);

            footer.append(button);
            section.append(footer);
        }

        return section;
    }

    /**
     * The two folded parts share one line, so that the list keeps its room.
     *
     * @private
     */
    appendFolds(fragment) {
        const {staleCount, done} = this.queue;
        const stale = this.staleSection;

        if (!staleCount && !done.length) {
            return;
        }

        const bar = this.make('div', 'live-actions-folds');

        if (staleCount) {
            const days = this.getStaleDays();

            bar.append(this.createFoldToggle(
                'stale',
                'toggleStale',
                stale.open,
                this.t('actionLabels', 'staleTitle'),
                staleCount === 1 ?
                    this.t('actionLabels', 'staleOne', {days}) :
                    this.t('actionLabels', 'staleCount', {count: staleCount, days})
            ));
        }

        if (done.length) {
            const countKey = done.length >= DONE_LIMIT ? 'doneLatest' : 'doneCount';

            bar.append(this.createFoldToggle(
                'done-today',
                'toggleDone',
                this.doneOpen,
                this.t('actionLabels', 'doneTitle'),
                done.length === 1 ?
                    this.t('actionLabels', 'doneOne') :
                    this.t('actionLabels', countKey, {count: done.length})
            ));
        }

        fragment.append(bar);

        if (staleCount && stale.open) {
            fragment.append(this.createStale());
        }

        if (done.length && this.doneOpen) {
            fragment.append(this.createDoneSection());
        }
    }

    /** @private */
    createFoldToggle(name, action, isOpen, title, text) {
        const toggle = this.make('button', `live-actions-fold-toggle live-actions-${name}-toggle`);

        toggle.type = 'button';
        toggle.dataset.liveAction = action;
        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.append(
            this.icon(`fas fa-chevron-${isOpen ? 'down' : 'right'}`),
            this.make('b', null, title),
            this.make('span', null, text)
        );

        return toggle;
    }

    /**
     * Today's work, read again from the server: it survives a reload.
     *
     * @private
     */
    createDoneSection() {
        const section = this.make('section', 'live-actions-fold live-actions-done-today');

        this.queue.done.forEach(item => section.append(this.createDone(item)));

        return section;
    }

    /**
     * Who, what happened, what was written, and what comes next.
     *
     * @private
     * @param {Object} data
     * @param {number|null} [recapId] Given for a card the user can hide.
     */
    createDone(data, recapId = null) {
        const box = this.make('article', 'live-actions-done live-dashlet-accent-success');
        const icon = this.make('span', 'live-dashlet-icon');
        const main = this.make('div', 'live-actions-main');
        const title = this.make('div', 'live-actions-title');
        const result = this.make('div', 'live-actions-reason');

        box.dataset.doneKey = data.key;
        icon.append(this.icon(DONE_ICONS[data.kind] || 'fas fa-check'));
        title.append(this.withLink(this.make('b', null, data.title), data.links.title));

        if (data.subtitle) {
            const subtitle = this.make('span', 'live-actions-sub');

            subtitle.append(this.withLink(document.createTextNode(data.subtitle), data.links.subtitle));
            title.append(subtitle);
        }

        const details = [
            data.date ? this.getDueText(data.date) : null,
            data.time ? this.formatter.formatTime(data.time) : this.t('actionLabels', 'justNow'),
        ].filter(Boolean);

        result.append(
            this.withLink(this.make('span', null, this.t('actionResult', data.result)), data.links.record),
            ' · ' + details.join(' · ')
        );

        main.append(title, result);

        if (data.note) {
            main.append(this.make('p', 'live-actions-done-note', data.note));
        }

        if (data.followUps.length) {
            const list = this.make('ul', 'live-actions-done-next');

            data.followUps.forEach(followUp => list.append(this.createFollowUp(followUp)));
            main.append(list);
        }

        box.append(icon, main);

        if (recapId) {
            const hide = this.make('button', 'live-actions-done-hide');
            const label = this.t('actionLabels', 'hideDone');

            hide.type = 'button';
            hide.title = label;
            hide.dataset.liveAction = 'hideDone';
            hide.dataset.recapId = String(recapId);
            hide.setAttribute('aria-label', label);
            hide.append(this.icon('fas fa-times'));
            box.append(hide);
        }

        return box;
    }

    /** @private */
    createFollowUp(followUp) {
        const entry = this.make('li');
        const link = {type: followUp.entityType, id: followUp.id};

        entry.append(
            this.icon(FOLLOW_UP_ICONS[followUp.entityType] || 'fas fa-tasks'),
            this.withLink(this.make('span', null, followUp.name), link)
        );

        if (followUp.date) {
            entry.append(this.make('span', null, this.getDueText(followUp.date)));
        }

        return entry;
    }

    /** @private */
    getDueText(date) {
        return this.t('actionLabels', 'dueOn', {date: this.formatter.formatShortDate(date)});
    }

    /** @private */
    updateArchiveButton(button) {
        const stale = this.staleSection;
        const count = this.getArchivable().length;

        button.classList.toggle('live-actions-confirming', stale.confirming);
        button.textContent = stale.confirming ?
            this.t('actionLabels', 'staleConfirm', {count}) :
            this.t('actionLabels', count === 1 ? 'staleArchiveOne' : 'staleArchive', {count});
    }

    /** @private */
    createUndo() {
        const bar = this.make('div', 'live-actions-undo');
        const button = this.make('button', 'btn btn-sm btn-text', this.t('actionLabels', 'undo'));

        button.type = 'button';
        button.dataset.liveAction = 'undo';
        button.disabled = this.undoOffer.busy;

        bar.append(this.icon('fas fa-check'), this.make('span', null, this.undoOffer.text), button);

        return bar;
    }

    /**
     * What was last said or done with this person, to have it in mind before acting.
     *
     * @private
     * @return {HTMLElement|null}
     */
    createContext(exchange) {
        if (exchange === false) {
            return null;
        }

        const box = this.make('div', 'live-actions-context');
        const head = this.make('div', 'live-actions-context-head');

        head.append(this.make('b', null, this.t('actionLabels', 'lastExchange')));
        box.append(head);

        if (exchange === undefined) {
            head.append(this.make('span', null, '…'));

            return box;
        }

        if (exchange === null) {
            head.append(this.make('span', null, this.t('actionLabels', 'noExchange')));

            return box;
        }

        const label = this.t('actionExchange', exchange.kind, {
            date: this.formatter.formatShortDate(exchange.date),
        });

        head.append(this.withLink(this.make('span', null, label), exchange.link));

        if (exchange.author) {
            head.append(this.make('span', null, this.t('actionLabels', 'exchangeBy', {name: exchange.author})));
        }

        const text = exchange.note || exchange.label;

        if (text) {
            box.append(this.make('p', 'live-actions-context-note', text));
        }

        return box;
    }

    /** @private */
    createSummary() {
        const {total, urgent, capped} = this.queue;
        const summary = this.make('div', 'live-actions-summary');
        const countKey = capped ? 'actionCountMore' : (total === 1 ? 'oneAction' : 'actionCount');

        summary.append(this.make('b', null, this.t('actionLabels', countKey, {count: total})));

        if (urgent) {
            summary.append(
                this.make('span', null, '·'),
                this.make('span', 'live-actions-late', this.t('actionLabels', 'lateCount', {count: urgent}))
            );
        }

        return summary;
    }

    /** @private */
    createEmptyState() {
        const box = this.make('div', 'live-actions-empty live-dashlet-accent-success');
        const icon = this.make('span', 'live-dashlet-icon');
        const next = this.queue.next;

        icon.append(this.icon('fas fa-check'));

        box.append(
            icon,
            this.make('b', null, this.t('actionLabels', 'allDone')),
            this.make('span', null, next ?
                this.t('actionLabels', 'nextPlanned', {
                    date: this.formatter.formatShortDate(next.date),
                    time: this.formatter.formatTime(next.time),
                }) :
                this.t('actionLabels', 'nothingPlanned'))
        );

        return box;
    }

    /** @private */
    createRow(item, isFirst) {
        const kind = KINDS[item.kind];
        const accent = item.kind === 'task' && item.urgent ? 'danger' : kind.accent;

        const row = this.make('article', `live-actions-row live-dashlet-accent-${accent}`);

        row.dataset.key = item.key;

        const icon = this.make('span', 'live-dashlet-icon');

        icon.append(this.icon(kind.icon));

        const main = this.make('div', 'live-actions-main');
        const title = this.make('div', 'live-actions-title');

        title.append(this.withLink(this.make('b', null, this.getItemTitle(item)), item.links.title));

        if (item.subtitle) {
            const subtitle = this.make('span', 'live-actions-sub');

            subtitle.append(this.withLink(document.createTextNode(item.subtitle), item.links.subtitle));
            title.append(subtitle);
        }

        const reason = this.make('div', 'live-actions-reason' + (item.urgent ? ' live-actions-urgent' : ''));

        reason.append(...this.createReason(item));
        main.append(title, reason);

        // Why act, from the record itself or the last exchange. An open panel shows that exchange.
        if (item.context && !(item.context.exchange && this.panel?.key === item.key)) {
            const exchange = item.context.exchange;
            const text = exchange ?
                this.t('actionLabels', 'contextExchange', {
                    exchange: this.t('actionExchange', exchange.kind, {
                        date: this.formatter.formatShortDate(exchange.date),
                    }),
                    text: item.context.text,
                }) :
                item.context.text;
            const context = this.make('div', 'live-actions-why', text);

            context.title = text;
            main.append(context);
            row.classList.add('live-actions-row-why');
        }

        const buttons = this.make('div', 'live-actions-buttons');

        buttons.append(this.createPrimary(item, isFirst), this.createMenu(item));
        row.append(icon, main, buttons);

        return row;
    }

    /**
     * The name, or the kind of record when the user's role hides the name.
     *
     * @private
     * @return {string}
     */
    getItemTitle(item) {
        return item.title || this.translate(item.entityType, 'scopeNames');
    }

    /**
     * @private
     * @param {Node} content
     * @param {{type: string, id: string}|null} link
     * @return {Node}
     */
    withLink(content, link) {
        if (!link) {
            return content;
        }

        const anchor = this.make('a', 'live-actions-link');

        anchor.href = `#${link.type}/view/${link.id}`;
        anchor.dataset.liveType = link.type;
        anchor.dataset.liveId = link.id;
        anchor.append(content);

        return anchor;
    }

    /**
     * The reason, with what it mentions (a meeting, a call, a deal) as a link.
     *
     * @private
     * @return {(Node|string)[]}
     */
    createReason(item) {
        const values = this.getReasonValues(item);
        const token = item.reason.label ? 'label' : 'amount';
        const template = this.translate(values.key, 'actionReasons', 'LiveDashlets');
        const fill = text => Object.entries(values.vars).reduce((all, [name, value]) => all.replace(`{${name}}`, value), text);

        if (!item.links.reason || !template.includes(`{${token}}`)) {
            return [fill(template)];
        }

        const [before, after] = template.split(`{${token}}`);
        const label = document.createTextNode(values.vars[token]);

        return [fill(before), this.withLink(label, item.links.reason), fill(after)];
    }

    /** @private */
    getReasonValues(item) {
        const reason = item.reason;
        const count = reason.count;
        const time = reason.time ? this.formatter.formatTime(reason.time) : '';
        const date = reason.date ? this.formatter.formatShortDate(reason.date) : '';
        const amount = reason.amount !== undefined ?
            this.formatter.formatValue(reason.amount, {
                valueType: 'currency',
                currency: this.getConfig().get('defaultCurrency'),
            }) : '';

        let key = reason.code;

        if (key === 'taskOverdue' && count === 1) {
            key = 'taskOverdueOne';
        } else if (key === 'leadNew' && count === 0) {
            key = 'leadNewToday';
        } else if (key === 'leadNew' && count === 1) {
            key = 'leadNewYesterday';
        }

        return {key, vars: {count, time, date, amount, label: reason.label || ''}};
    }

    /** @private */
    async showRecord(entityType, id) {
        const RecordModal = await Espo.loader.requirePromise('helpers/record-modal');

        await new RecordModal().showDetail(this, {
            entityType,
            id,
            afterSave: () => this.load(),
            afterDestroy: () => this.load(),
        });
    }

    /** @private */
    getPrimaryAction(item) {
        const acl = this.getAcl();

        if (item.primaryAction === 'complete' && item.canEdit && this.canSetTaskStatus()) {
            return 'complete';
        }

        if (item.primaryAction === 'close' && item.canEdit) {
            return 'close';
        }

        if (item.primaryAction === 'followUp' && acl.checkScope('Task', 'create')) {
            return 'followUp';
        }

        if (item.primaryAction === 'call' && (item.kind === 'call' ? item.canEdit : acl.checkScope('Call', 'create'))) {
            return 'call';
        }

        return 'open';
    }

    /** @private */
    createPrimary(item, isFirst) {
        const action = this.getPrimaryAction(item);
        const [iconClass, label] = PRIMARY[action];
        const phone = action === 'call' ? item.person?.phone : null;
        const isLink = action === 'open' || phone;

        const button = this.make(isLink ? 'a' : 'button', `btn btn-sm ${isFirst ? 'btn-primary' : 'btn-default'} live-actions-cta`);

        if (action === 'open') {
            button.href = this.getRecordUrl(item);
            button.dataset.liveType = item.entityType;
            button.dataset.liveId = item.id;
        } else {
            button.dataset.liveAction = action;

            if (phone) {
                button.href = 'tel:' + phone.replace(/[^+\d]/g, '');
            } else {
                button.type = 'button';
            }
        }

        const text = this.t('actionButtons', label);

        button.title = text;
        button.append(this.icon(iconClass), this.make('span', 'live-actions-cta-label', text));

        return button;
    }

    /** @private */
    getRecordUrl(item) {
        return `#${item.entityType}/view/${item.id}`;
    }

    /** @private */
    createMenu(item) {
        const group = this.make('div', 'btn-group live-actions-menu');
        const toggle = this.make('button', 'btn btn-sm btn-text dropdown-toggle');

        toggle.type = 'button';
        toggle.dataset.toggle = 'dropdown';
        toggle.setAttribute('aria-label', this.t('actionButtons', 'more'));
        toggle.append(this.icon('fas fa-ellipsis-h'));

        const menu = this.make('ul', 'dropdown-menu pull-right');

        const add = (iconClass, text, action, {href = null, date = null} = {}) => {
            const entry = this.make('li');
            const link = this.make('a');

            link.setAttribute('role', 'button');
            link.tabIndex = 0;

            if (action) {
                link.dataset.liveAction = action;
            }

            if (href) {
                link.href = href;
            }

            if (date) {
                link.dataset.date = date;
            }

            link.append(this.icon(iconClass + ' item-icon'), this.make('span', 'item-text', text));
            entry.append(link);
            menu.append(entry);
        };

        const addDivider = () => {
            if (menu.children.length) {
                menu.append(this.make('li', 'divider'));
            }
        };

        if (item.person?.email && this.getAcl().checkScope('Email', 'create')) {
            add('fas fa-envelope', this.t('actionButtons', 'email'), 'email');
        }

        if (this.getAcl().checkScope('Task', 'create') && item.target) {
            add('fas fa-calendar-plus', this.t('actionButtons', 'schedule'), 'schedule');
        }

        if (item.snooze) {
            addDivider();
            menu.append(this.make('li', 'dropdown-header', this.t('actionLabels', 'snoozeTo')));

            this.queue.dates.snooze.forEach(date => {
                add('fas fa-clock', this.formatter.formatWeekdayDate(date), 'snooze', {date});
            });

            add('fas fa-calendar-alt', this.t('actionLabels', 'snoozePick'), 'snoozePick');
        }

        addDivider();
        add('fas fa-external-link-alt', this.t('actionButtons', 'open'), null, {href: this.getRecordUrl(item)});

        group.append(toggle, menu);

        return group;
    }

    /** @private */
    createChips(name, values, selected, isLocked = false) {
        const chips = this.make('div', 'live-actions-chips');

        chips.setAttribute('role', 'group');

        values.forEach(value => {
            const label = this.panel.mode === 'meeting' && value === 'held' ? 'meetingHeld' : value;
            const chip = this.make('button', 'live-actions-chip', this.t('actionOutcome', label));

            chip.type = 'button';
            chip.dataset.liveChoice = name;
            chip.dataset.value = value;
            chip.setAttribute('aria-pressed', String(value === selected));
            chip.disabled = isLocked;

            chips.append(chip);
        });

        return chips;
    }

    /** @private */
    createPhone(phone) {
        const box = this.make('div', 'live-actions-phone');
        const link = this.make('a', null, phone);
        const copy = this.make('button', 'btn btn-sm btn-default');

        link.href = 'tel:' + phone.replace(/[^+\d]/g, '');

        copy.type = 'button';
        copy.dataset.liveAction = 'copyPhone';
        copy.append(this.icon('far fa-copy'), this.make('span', null, this.t('actionLabels', 'copyNumber')));

        box.append(link, copy);

        return box;
    }

    /** @private */
    createPanelFooter(hint) {
        const footer = this.make('div', 'live-actions-save');
        const save = this.make('button', 'btn btn-sm btn-primary', this.t('actionButtons', 'save'));
        const cancel = this.make('button', 'btn btn-sm btn-text', this.t('actionButtons', 'cancel'));

        save.type = 'button';
        save.dataset.liveAction = 'savePanel';
        cancel.type = 'button';
        cancel.dataset.liveAction = 'cancelPanel';

        footer.append(save, cancel);

        if (hint) {
            footer.append(this.make('small', null, hint));
        }

        return footer;
    }

    /** @private */
    createSnoozePanel(item) {
        const box = this.make('div', 'live-actions-panel');
        const label = this.t('actionLabels', 'snoozeQuestion');
        const input = this.make('input', 'form-control live-actions-snooze-date');

        box.dataset.panelFor = item.key;

        input.type = 'date';
        input.min = this.queue.dates.today;
        input.value = this.panel.date;
        input.setAttribute('aria-label', label);

        box.append(this.make('h5', null, label), input, this.createPanelFooter());

        return box;
    }

    /** @private */
    createPanel(item) {
        const panel = this.panel;

        if (panel.mode === 'snooze') {
            return this.createSnoozePanel(item);
        }

        const box = this.make('div', 'live-actions-panel');
        const isCall = panel.mode === 'call';

        box.dataset.panelFor = item.key;

        if (isCall && item.person?.phone) {
            box.append(this.createPhone(item.person.phone));
        }

        const context = this.createContext(panel.exchange);

        if (context) {
            box.append(context);
        }

        box.append(this.make('h5', null, this.t('actionOutcome', isCall ? 'callQuestion' : 'meetingQuestion')));

        if (isCall && !item.person?.phone) {
            box.append(this.make('p', 'live-actions-hint', this.t('actionOutcome', 'noPhone')));
        }

        // Once the result is saved, only the next step is left to create.
        const isLocked = !!panel.saved;

        if (isLocked) {
            box.append(this.make('p', 'live-actions-hint', this.t('actionOutcome', 'resultSaved')));
        }

        box.append(this.createChips('outcome', OUTCOMES[panel.mode], panel.outcome, isLocked));

        const note = this.make('textarea', 'form-control live-actions-note');

        note.rows = 1;
        note.placeholder = this.t('actionOutcome', 'notePlaceholder');
        note.value = panel.note;
        note.setAttribute('aria-label', this.t('actionOutcome', 'notePlaceholder'));

        const next = this.make('div');

        next.append(
            this.make('label', null, this.t('actionOutcome', 'nextStep')),
            this.createChips('next', this.getNextSteps(), panel.next)
        );

        note.readOnly = isLocked;

        box.append(note, next, this.createPanelFooter(this.t('actionOutcome', 'saveHint')));

        return box;
    }

    // -----------------------------------------------------------------------------------------
    // Actions.
    // -----------------------------------------------------------------------------------------

    /** @private */
    getItem(element) {
        const key = element.closest('[data-key]')?.dataset.key ??
            element.closest('[data-panel-for]')?.dataset.panelFor;

        const items = [...(this.queue?.items || []), ...(this.staleSection.items || [])];

        return items.find(item => item.key === key) || null;
    }

    /** @private */
    canSetTaskStatus() {
        return !this.getAcl().getScopeForbiddenFieldList('Task', 'edit').includes('status');
    }

    /**
     * The status of a task closed without being done.
     *
     * @private
     * @return {string|null}
     */
    getArchiveStatus() {
        const field = this.getMetadata().get(['entityDefs', 'Task', 'fields', 'status']) || {};
        const options = field.options || [];

        if (options.includes('Canceled')) {
            return 'Canceled';
        }

        return (field.notActualOptions || []).find(status => status !== 'Completed' && options.includes(status)) || null;
    }

    /** @private */
    getArchivable() {
        if (!this.getArchiveStatus() || !this.canSetTaskStatus()) {
            return [];
        }

        return (this.staleSection.items || []).filter(item => item.canEdit && item.restore);
    }

    /** @private */
    runAction(action, element) {
        // In a dashboard template, a preview: nothing is done to the records.
        if (this.isPreview() && !PREVIEW_ACTIONS.includes(action)) {
            Espo.Ui.notify(this.t('messages', 'previewOnly'), 'info', 3000);

            return;
        }

        if (action === 'toggleMore') {
            this.expanded = !this.expanded;
            this.renderList();

            return;
        }

        if (action === 'toggleStale') {
            this.toggleStale();

            return;
        }

        if (action === 'archiveStale') {
            this.archiveStale(element);

            return;
        }

        if (action === 'undo') {
            this.undoLast();

            return;
        }

        if (action === 'toggleDone') {
            this.doneOpen = !this.doneOpen;
            this.renderList();

            return;
        }

        if (action === 'hideDone') {
            this.removeRecap(Number(element.dataset.recapId));
            this.renderList();

            return;
        }

        const item = this.getItem(element);

        if (!item) {
            return;
        }

        switch (action) {
            case 'call':
                this.openPanel(item, 'call');
                break;
            case 'close':
                this.openPanel(item, 'meeting');
                break;
            case 'cancelPanel':
                this.panel = null;
                this.renderList();
                break;
            case 'savePanel':
                this.savePanel(item, element);
                break;
            case 'complete':
                this.run(item, Espo.Ajax.putRequest(`Task/${item.id}`, {status: 'Completed'}), {
                    message: this.t('actionDone', 'completed'),
                    undo: () => this.getRestore([item]),
                    recap: () => ({result: 'taskCompleted'}),
                    trigger: element,
                });
                break;
            case 'snooze':
                this.snooze(item, element, element.dataset.date);
                break;
            case 'snoozePick':
                this.panel = {key: item.key, mode: 'snooze', date: ''};
                this.renderList();
                this.getContainer().querySelector('.live-actions-snooze-date')?.focus();
                break;
            case 'copyPhone':
                this.copyPhone(item, element);
                break;
            case 'email':
                this.composeEmail(item);
                break;
            case 'followUp':
            case 'schedule':
                this.showCreate('Task', this.getTaskAttributes(item, this.queue.dates.tomorrow), model => {
                    this.addRecap(item, {
                        result: 'nextStepPlanned',
                        followUps: [this.toFollowUp('Task', model.id, model.attributes)],
                    });
                });
                break;
        }
    }

    /** @private */
    openPanel(item, mode) {
        const steps = this.getNextSteps();

        this.panel = {
            key: item.key,
            mode,
            outcome: 'held',
            // What is saved is what the chips show, among the steps the user may create.
            next: steps.includes('in3Days') ? 'in3Days' : 'none',
            note: '',
            exchange: undefined,
            saved: null,
        };
        this.renderList();
        this.loadExchange(item, this.panel);
    }

    /** @private */
    getNextSteps() {
        const acl = this.getAcl();

        return NEXT_STEPS.filter(step => {
            return step === 'none' ||
                (step === 'meeting' ? acl.checkScope('Meeting', 'create') : acl.checkScope('Task', 'create'));
        });
    }

    /**
     * Only the block is replaced: what the user has started typing stays.
     *
     * @private
     */
    async loadExchange(item, panel) {
        try {
            const data = await Espo.Ajax.getRequest('LiveDashlets/lastExchange', {
                entityType: item.entityType,
                id: item.id,
                personType: item.person?.type,
                personId: item.person?.id,
            });

            panel.exchange = data.exchange;
        } catch (xhr) {
            if (xhr) {
                xhr.errorIsHandled = true;
            }

            panel.exchange = false;
        }

        if (this.panel !== panel) {
            return;
        }

        const current = this.getContainer()?.querySelector('.live-actions-panel .live-actions-context');
        const context = this.createContext(panel.exchange);

        if (current && context) {
            current.replaceWith(context);
        } else {
            current?.remove();
        }
    }

    /** @private */
    async copyPhone(item, button) {
        if (!await this.copyText(item.person.phone)) {
            return;
        }

        const label = button.querySelector('span:last-child');

        label.textContent = this.t('actionLabels', 'copied');

        setTimeout(() => {
            label.textContent = this.t('actionLabels', 'copyNumber');
        }, 2000);
    }

    /**
     * The clipboard API only exists on HTTPS: an instance on plain HTTP uses the older way.
     *
     * @private
     * @return {Promise<boolean>}
     */
    async copyText(text) {
        try {
            await navigator.clipboard.writeText(text);

            return true;
        } catch (e) {
            const area = this.make('textarea', 'live-actions-copy-area');

            area.value = text;
            this.getContainer().append(area);
            area.select();

            const isCopied = document.execCommand('copy');

            area.remove();

            return isCopied;
        }
    }

    /** @private */
    async toggleStale() {
        const stale = this.staleSection;

        stale.open = !stale.open;
        this.resetConfirm();

        if (!stale.open) {
            stale.items = null;
            this.renderList();

            return;
        }

        stale.loading = true;
        this.renderList();

        try {
            const data = await this.fetchStale();

            stale.items = data.items;
        } catch (xhr) {
            stale.open = false;
        }

        stale.loading = false;

        if (this.getContainer()) {
            this.renderList();
        }
    }

    /** @private */
    resetConfirm() {
        clearTimeout(this.confirmTimer);

        this.staleSection.confirming = false;
    }

    /**
     * Two clicks: the first one says how many tasks the second one will close.
     *
     * @private
     */
    async archiveStale(button) {
        const stale = this.staleSection;
        const items = this.getArchivable();

        if (!items.length || stale.archiving) {
            return;
        }

        if (!stale.confirming) {
            stale.confirming = true;
            this.updateArchiveButton(button);

            this.confirmTimer = setTimeout(() => {
                this.resetConfirm();

                if (button.isConnected) {
                    this.updateArchiveButton(button);
                }
            }, CONFIRM_DELAY);

            return;
        }

        this.resetConfirm();

        const fromKeyboard = button.matches(':focus-visible');
        const status = this.getArchiveStatus();
        const done = [];

        stale.archiving = true;
        button.disabled = true;

        for (const item of items) {
            try {
                await Espo.Ajax.putRequest(`Task/${item.id}`, {status});

                done.push(item);
            } catch (e) {
                break;
            }
        }

        stale.archiving = false;

        if (done.length) {
            this.offerUndo(
                done.length === 1 ?
                    this.t('actionDone', 'archivedOne') :
                    this.t('actionDone', 'archived', {count: done.length}),
                this.getRestore(done)
            );
        }

        await this.load();

        this.focusUndo(fromKeyboard);
    }

    /**
     * @private
     * @param {Object[]} items
     * @return {(function(): Promise)|null} Puts the records back as they were when listed.
     */
    getRestore(items) {
        if (!items.every(item => item.restore)) {
            return null;
        }

        return async () => {
            for (const {restore} of items) {
                await Espo.Ajax.putRequest(restore.url, restore.data);
            }
        };
    }

    /**
     * Keeps what was done visible, at the place of the row.
     *
     * @private
     * @param {Object} item
     * @param {{
     *   result: string,
     *   note?: string|null,
     *   date?: string|null,
     *   record?: {type: string, id: string},
     *   followUps?: Object[],
     * }} details
     * @return {{id: number, beforeKey: string|null, data: Object}}
     */
    addRecap(item, {result, note = null, date = null, record = null, followUps = []}) {
        const items = this.queue?.items || [];
        const index = items.findIndex(other => other.key === item.key);
        const beforeKey = index === -1 ? null : items[index + 1]?.key ?? null;
        const id = ++this.recapNumber;

        // Those placed before this row now go before the next one.
        this.recaps.forEach(recap => {
            if (recap.beforeKey === item.key) {
                recap.beforeKey = beforeKey;
            }
        });

        const recap = {
            id,
            beforeKey,
            data: {
                key: `recap:${id}`,
                kind: 'recap',
                title: this.getItemTitle(item),
                subtitle: item.subtitle,
                result,
                note,
                date,
                time: null,
                links: {
                    title: item.links.title,
                    subtitle: item.links.subtitle,
                    record: record || {type: item.entityType, id: item.id},
                },
                followUps,
            },
        };

        this.recaps = [...this.recaps, recap].slice(-MAX_RECAPS);

        return recap;
    }

    /** @private */
    removeRecap(id) {
        this.recaps = this.recaps.filter(recap => recap.id !== id);
    }

    /**
     * The day of a task's deadline or of a meeting's start, in the user's time zone.
     *
     * @private
     * @return {string|null}
     */
    getRecordDate(entityType, attributes) {
        const field = entityType === 'Task' ? 'dateEnd' : 'dateStart';

        if (attributes[`${field}Date`]) {
            return attributes[`${field}Date`];
        }

        return attributes[field] ? this.getDateTime().toMoment(attributes[field]).format('YYYY-MM-DD') : null;
    }

    /** @private */
    toFollowUp(entityType, id, attributes) {
        return {entityType, id, name: attributes.name, date: this.getRecordDate(entityType, attributes)};
    }

    /** @private */
    offerUndo(text, action, recapId = null) {
        clearTimeout(this.undoOffer?.timer);

        this.undoOffer = {text, action, timer: 0, busy: false, recapId};
        this.armUndo(UNDO_DELAY);
    }

    /**
     * The offer waits while the pointer or the keyboard is on it.
     *
     * @private
     */
    armUndo(delay) {
        const offer = this.undoOffer;

        offer.timer = setTimeout(() => {
            const bar = this.getContainer()?.querySelector('.live-actions-undo');

            if (bar && (bar.matches(':hover') || bar.querySelector(':focus-visible'))) {
                this.armUndo(1000);

                return;
            }

            this.undoOffer = null;
            bar?.remove();
        }, delay);
    }

    /** @private */
    focusUndo(fromKeyboard) {
        if (fromKeyboard) {
            this.getContainer()?.querySelector('[data-live-action="undo"]')?.focus();
        }
    }

    /** @private */
    async undoLast() {
        const offer = this.undoOffer;

        if (!offer || offer.busy) {
            return;
        }

        const button = this.getContainer().querySelector('[data-live-action="undo"]');

        clearTimeout(offer.timer);

        offer.busy = true;
        button.disabled = true;

        try {
            await offer.action();
        } catch (e) {
            offer.busy = false;
            button.disabled = false;
            this.armUndo(UNDO_DELAY);

            return;
        }

        this.undoOffer = null;
        this.removeRecap(offer.recapId);

        Espo.Ui.success(this.t('actionLabels', 'undone'));

        await this.load();
    }

    /** @private */
    choose(chip) {
        if (!this.panel) {
            return;
        }

        const name = chip.dataset.liveChoice;

        this.panel[name] = chip.dataset.value;

        chip.closest('.live-actions-chips').querySelectorAll('[data-live-choice]').forEach(item => {
            item.setAttribute('aria-pressed', String(item === chip));
        });
    }

    /**
     * The row leaves at once; the list is then read again, with a way back when there is one.
     *
     * @private
     * @param {Object} item
     * @param {Promise} request
     * @param {{
     *   message: string,
     *   undo: function(*): ((function(): Promise)|null),
     *   recap: function(*): Object,
     *   trigger: HTMLElement,
     * }} options
     */
    async run(item, request, {message, undo, recap, trigger}) {
        const row = this.getContainer().querySelector(`[data-key="${CSS.escape(item.key)}"]`);
        const fromKeyboard = trigger.matches(':focus-visible');

        row?.classList.add('live-actions-leaving');

        let result;

        try {
            result = await request;
        } catch (e) {
            row?.classList.remove('live-actions-leaving');

            return;
        }

        const action = undo(result);
        const {id} = this.addRecap(item, recap(result));

        if (action) {
            this.offerUndo(message, action, id);
        } else {
            Espo.Ui.success(message);
        }

        await this.load();

        this.focusUndo(fromKeyboard && !!action);
    }

    /** @private */
    snooze(item, trigger, date) {
        const {method, url} = item.snooze;
        const data = this.getSnoozeData(item, date);
        const message = this.t('actionDone', 'snoozed', {date: this.formatter.formatShortDate(date)});

        if (method !== 'POST') {
            this.run(item, Espo.Ajax.putRequest(url, data), {
                message,
                undo: () => this.getRestore([item]),
                recap: () => ({result: 'postponed', date}),
                trigger,
            });

            return;
        }

        const body = {...data, name: this.t('actionLabels', 'followUpName', {name: this.getItemTitle(item)})};

        this.run(item, Espo.Ajax.postRequest(url, body), {
            message,
            undo: created => this.getRemoveCreated('Task', created.id),
            recap: created => ({
                result: 'followUpPlanned',
                followUps: [this.toFollowUp('Task', created.id, created)],
            }),
            trigger,
        });
    }

    /**
     * What to send to move a record to a day, at its usual time.
     *
     * @private
     * @param {Object} item
     * @param {string} date Y-m-d, in the user's time zone.
     * @return {Object}
     */
    getSnoozeData(item, date) {
        const {method, data, schedule} = item.snooze;
        const isDeadline = method === 'POST' || item.entityType === 'Task';

        if (schedule.allDay) {
            return isDeadline ?
                {dateEndDate: date} :
                {dateStartDate: date, dateEndDate: this.formatter.addDays(date, schedule.days || 0)};
        }

        const [year, month, day] = date.split('-').map(Number);
        const [hour, minute] = schedule.time.split(':').map(Number);
        const toUtc = value => value.clone().utc().format('YYYY-MM-DD HH:mm:ss');

        const start = this.getDateTime().getNowMoment()
            .set({year, month: month - 1, date: day, hour, minute, second: 0, millisecond: 0});

        if (isDeadline) {
            return {...data, dateEnd: toUtc(start)};
        }

        return {dateStart: toUtc(start), dateEnd: toUtc(start.clone().add(schedule.duration, 'seconds'))};
    }

    /**
     * Going back on a created record removes it. A task can also be closed, for a user who
     * cannot delete tasks.
     *
     * @private
     * @return {(function(): Promise)|null}
     */
    getRemoveCreated(entityType, id) {
        const canDelete = this.getAcl().checkScope(entityType, 'delete');
        const status = entityType === 'Task' && this.canSetTaskStatus() ? this.getArchiveStatus() : null;

        if (!canDelete && !status) {
            return null;
        }

        return async () => {
            if (canDelete) {
                try {
                    await Espo.Ajax.deleteRequest(`${entityType}/${id}`);

                    return;
                } catch (xhr) {
                    if (xhr?.status !== 403 || !status) {
                        throw xhr;
                    }

                    xhr.errorIsHandled = true;
                }
            }

            await Espo.Ajax.putRequest(`${entityType}/${id}`, {status});
        };
    }

    /**
     * Steps already done are not repeated if the undo is tried again after a failure.
     *
     * @private
     * @param {(function(): Promise)[]} steps
     */
    async runSteps(steps) {
        while (steps.length) {
            await steps[0]();

            steps.shift();
        }
    }

    /** @private */
    getParent(item) {
        return item.target || (item.person ? {type: item.person.type, id: item.person.id, name: item.person.name} : null);
    }

    /** @private */
    getTaskAttributes(item, dateEnd) {
        const parent = this.getParent(item);

        return {
            name: this.t('actionLabels', 'followUpName', {name: this.getItemTitle(item)}),
            status: 'Not Started',
            priority: 'Normal',
            dateEnd,
            parentType: parent?.type ?? null,
            parentId: parent?.id ?? null,
            parentName: parent?.name ?? null,
            assignedUserId: this.getUser().id,
            assignedUserName: this.getUser().get('name'),
        };
    }

    /** @private */
    getPeopleAttributes(item) {
        const person = item.person;

        if (person?.type === 'Contact') {
            return {contactsIds: [person.id], contactsNames: {[person.id]: person.name}};
        }

        if (person?.type === 'Lead') {
            return {leadsIds: [person.id], leadsNames: {[person.id]: person.name}};
        }

        return {};
    }

    /** @private */
    utc(date) {
        return date.toISOString().slice(0, 19).replace('T', ' ');
    }

    /** @private */
    addMinutes(utcDate, minutes) {
        return this.utc(new Date(new Date(utcDate.replace(' ', 'T') + 'Z').getTime() + minutes * 60000));
    }

    /** @private */
    async showCreate(entityType, attributes, onSaved) {
        const RecordModal = await Espo.loader.requirePromise('helpers/record-modal');

        await new RecordModal().showCreate(this, {
            entityType,
            attributes,
            afterSave: model => {
                onSaved?.(model);
                this.load();
            },
        });
    }

    /** @private */
    async composeEmail(item) {
        const person = item.person;
        const parent = this.getParent(item);
        const allowed = this.getMetadata().get(['entityDefs', 'Email', 'fields', 'parent', 'entityList']) || [];

        const attributes = {
            status: 'Draft',
            to: person.email,
            nameHash: {[person.email]: person.name},
        };

        if (parent && allowed.includes(parent.type)) {
            attributes.parentType = parent.type;
            attributes.parentId = parent.id;
            attributes.parentName = parent.name;
        }

        const MailtoHelper = await Espo.loader.requirePromise('helpers/misc/mailto');
        const helper = new MailtoHelper();

        if (helper.toUse()) {
            document.location.href = helper.composeLink(attributes);

            return;
        }

        Espo.Ui.notifyWait();

        const view = await this.createView('composeEmail', 'views/modals/compose-email', {attributes});

        this.listenToOnce(view, 'after:send', model => {
            this.addRecap(item, {
                result: 'emailSent',
                note: model.get('name'),
                record: {type: 'Email', id: model.id},
            });

            this.load();
        });

        await view.render();

        Espo.Ui.notify(false);
    }

    /**
     * @private
     * @return {Promise<{record: {type: string, id: string}, undo: (function(): Promise)|null}>}
     */
    async saveActivity(item) {
        const {mode, outcome, note} = this.panel;
        const prefix = outcome === 'message' ? this.t('actionOutcome', 'message') : '';
        const text = [prefix, note.trim()].filter(Boolean).join(' · ');
        const status = outcome === 'held' ? 'Held' : 'Not Held';

        if (mode === 'meeting' || item.kind === 'call') {
            const url = `${item.entityType}/${item.id}`;
            const before = text ? await Espo.Ajax.getRequest(url) : null;
            const description = before?.description ? `${before.description}\n\n${text}` : text;

            await Espo.Ajax.putRequest(url, text ? {description, status} : {status});

            const restore = item.restore;

            return {
                record: {type: item.entityType, id: item.id},
                undo: restore ? () => Espo.Ajax.putRequest(restore.url, {
                    ...restore.data,
                    ...(text ? {description: before.description ?? null} : {}),
                }) : null,
            };
        }

        const parent = this.getParent(item);
        const end = this.utc(new Date());
        const user = this.getUser();

        const call = await Espo.Ajax.postRequest('Call', {
            name: this.t('actionLabels', 'callName', {name: item.person?.name || this.getItemTitle(item)}),
            status,
            direction: 'Outbound',
            dateStart: this.addMinutes(end, -5),
            dateEnd: end,
            parentType: parent?.type ?? null,
            parentId: parent?.id ?? null,
            assignedUserId: user.id,
            usersIds: [user.id],
            description: text || null,
            ...this.getPeopleAttributes(item),
        });

        return {record: {type: 'Call', id: call.id}, undo: this.getRemoveCreated('Call', call.id)};
    }

    /** @private */
    getPanelResult({mode, outcome}) {
        if (mode === 'meeting') {
            return outcome === 'held' ? 'meetingHeld' : 'meetingNotHeld';
        }

        return {held: 'callHeld', noAnswer: 'callNoAnswer', message: 'callMessage'}[outcome];
    }

    /** @private */
    async savePanel(item, button) {
        const panel = this.panel;

        if (panel.mode === 'snooze') {
            this.saveSnoozePanel(item, button);

            return;
        }

        const {next} = panel;
        const dates = this.queue.dates;
        const fromKeyboard = button.matches(':focus-visible');
        const followUps = [];
        // The latest change is undone first.
        const undoSteps = [];

        button.disabled = true;

        let record;

        try {
            // Kept on the panel: retrying after a failed next step does not save the call twice.
            if (!panel.saved) {
                const saved = await this.saveActivity(item);

                panel.saved = {...saved, outcome: panel.outcome, note: panel.note};
            }

            record = panel.saved.record;
            undoSteps.push(panel.saved.undo);

            if (next === 'in3Days' || next === 'in7Days') {
                const task = await Espo.Ajax.postRequest('Task', this.getTaskAttributes(item, dates[next]));

                followUps.push(this.toFollowUp('Task', task.id, task));
                undoSteps.unshift(this.getRemoveCreated('Task', task.id));
            }
        } catch (e) {
            button.disabled = false;

            // The result is saved: what is shown must not change any more.
            if (panel.saved && this.panel === panel) {
                this.renderList();
            }

            return;
        }

        this.panel = null;

        const recap = this.addRecap(item, {
            result: this.getPanelResult({mode: panel.mode, outcome: panel.saved.outcome}),
            note: panel.saved.note.trim() || null,
            record,
            followUps,
        });

        // All or nothing: a partial undo would leave a result without its call, or the reverse.
        const canUndo = undoSteps.every(Boolean);

        if (canUndo) {
            this.offerUndo(this.t('actionDone', 'saved'), () => this.runSteps(undoSteps), recap.id);
        }

        await this.load();

        this.focusUndo(fromKeyboard && canUndo && next !== 'meeting');

        if (next === 'meeting') {
            const parent = this.getParent(item);
            const user = this.getUser();

            this.showCreate('Meeting', {
                name: this.t('actionLabels', 'meetingName', {name: this.getItemTitle(item)}),
                status: 'Planned',
                dateStart: dates.tomorrow,
                dateEnd: this.addMinutes(dates.tomorrow, 60),
                parentType: parent?.type ?? null,
                parentId: parent?.id ?? null,
                parentName: parent?.name ?? null,
                assignedUserId: user.id,
                assignedUserName: user.get('name'),
                usersIds: [user.id],
                usersNames: {[user.id]: user.get('name')},
                ...this.getPeopleAttributes(item),
            }, model => {
                recap.data.followUps.push(this.toFollowUp('Meeting', model.id, model.attributes));

                const remove = this.getRemoveCreated('Meeting', model.id);

                if (remove) {
                    undoSteps.unshift(remove);

                    return;
                }

                // Undo would leave this meeting behind.
                this.withdrawUndo(recap.id);
            });
        }
    }

    /** @private */
    withdrawUndo(recapId) {
        if (this.undoOffer?.recapId !== recapId) {
            return;
        }

        clearTimeout(this.undoOffer.timer);

        this.undoOffer = null;
        this.getContainer()?.querySelector('.live-actions-undo')?.remove();
    }

    /** @private */
    saveSnoozePanel(item, button) {
        const {date} = this.panel;
        const input = this.getContainer().querySelector('.live-actions-snooze-date');

        if (!date || date < this.queue.dates.today) {
            input?.focus();

            return;
        }

        this.panel = null;
        button.disabled = true;

        this.snooze(item, button, date);
    }
}

export default LiveDashletsActionsView;
