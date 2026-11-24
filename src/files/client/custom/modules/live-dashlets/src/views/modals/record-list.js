/************************************************************************
 * This file is part of Live Dashlets for EspoCRM.
 *
 * Copyright (C) 2026 Alexis SANTIN
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 ************************************************************************/

import ModalView from 'views/modal';

/**
 * The records behind a figure: same entity, filters and period, read through the standard
 * list API, so with the viewer's access rights.
 *
 * Options: entityType, where, title, subtitle, valueField, dateField.
 */
class LiveDashletsRecordListModalView extends ModalView {

    templateContent = `
        <p class="live-record-list-summary"></p>
        <div class="live-record-list">{{{list}}}</div>
    `

    className = 'dialog dialog-record live-record-list-dialog'

    backdrop = true

    events = {
        ...(this.events || {}),
        // Opening a record leaves the dashboard: the modal goes with it.
        /** @this LiveDashletsRecordListModalView */
        'click .live-record-list a[href^="#"]': function () {
            this.close();
        },
    }

    setup() {
        super.setup();

        this.entityType = this.options.entityType;

        this.headerText = this.options.subtitle ?
            `${this.options.title} · ${this.options.subtitle}` :
            this.options.title;

        this.buttonList = [
            {
                name: 'close',
                label: 'Close',
            },
        ];

        this.wait(this.loadList());
    }

    /** @private */
    async loadList() {
        const collection = await this.getCollectionFactory().create(this.entityType);

        collection.maxSize = 20;
        collection.where = this.options.where || [];

        const dateField = this.options.dateField;

        // Most recent first when the period is the point.
        if (dateField && !this.getMetadata().get(['entityDefs', this.entityType, 'fields', dateField, 'orderDisabled'])) {
            collection.setOrder(dateField, 'desc', true);
        }

        this.collection = collection;

        try {
            await collection.fetch();
        } catch (xhr) {
            if (xhr) {
                xhr.errorIsHandled = true;
            }

            this.loadError = true;

            return;
        }

        await this.createView('list', 'views/record/list', {
            collection: collection,
            selector: '.live-record-list',
            listLayout: this.getListLayout(),
            checkboxes: false,
            massActionsDisabled: true,
            rowActionsDisabled: true,
            buttonsDisabled: true,
            displayTotalCount: false,
            showMore: true,
        });
    }

    afterRender() {
        const summary = this.element.querySelector('.live-record-list-summary');

        if (!summary) {
            return;
        }

        if (this.loadError) {
            summary.classList.add('text-danger');
            summary.textContent = this.translate('loadError', 'messages', 'LiveDashlets');

            return;
        }

        const total = this.collection ? this.collection.total : 0;

        summary.textContent = total === 1 ?
            this.translate('oneRecord', 'labels', 'LiveDashlets') :
            this.translate('recordCount', 'labels', 'LiveDashlets').replace('{count}', String(total));
    }

    /**
     * Name, then what the figure is made of: the added-up field, the date of the period,
     * and who the record is assigned to. Only fields the user can read.
     *
     * @private
     * @return {Object[]}
     */
    getListLayout() {
        const fields = this.getMetadata().get(['entityDefs', this.entityType, 'fields']) || {};
        const forbiddenList = this.getAcl().getScopeForbiddenFieldList(this.entityType);

        const canShow = field => fields[field] && !fields[field].disabled && !forbiddenList.includes(field);

        const layout = [];

        if (canShow('name')) {
            layout.push({name: 'name', link: true});
        }

        [this.options.valueField, this.options.dateField, 'assignedUser']
            .filter((field, i, list) => field && list.indexOf(field) === i && canShow(field))
            .forEach(field => layout.push({name: field}));

        return layout;
    }
}

export default LiveDashletsRecordListModalView;
