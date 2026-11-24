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

import EnumFieldView from 'views/fields/enum';

/**
 * Readable fields of the selected entity type, limited to some field types.
 * The server checks the same rules again.
 */
class LiveDashletsEntityFieldView extends EnumFieldView {

    /** @protected @type {string[]} */
    fieldTypeList = []

    setup() {
        super.setup();

        this.listenTo(this.model, 'change:entityType', () => {
            this.setupOptions();
            this.reRender();
        });
    }

    setupOptions() {
        const entityType = this.model.get('entityType');

        this.translatedOptions = {'': ''};

        if (!entityType) {
            this.params.options = [''];

            return;
        }

        const fields = this.getMetadata().get(['entityDefs', entityType, 'fields']) || {};
        const forbiddenList = this.getAcl().getScopeForbiddenFieldList(entityType);

        const list = Object.keys(fields).filter(field => {
            const defs = fields[field];

            return this.fieldTypeList.includes(defs.type) &&
                !defs.disabled &&
                !defs.utility &&
                !(defs.notStorable && !defs.select && defs.type !== 'currency') &&
                !forbiddenList.includes(field);
        });

        list.forEach(field => {
            this.translatedOptions[field] = this.translate(field, 'fields', entityType);
        });

        list.sort((a, b) => this.translatedOptions[a].localeCompare(this.translatedOptions[b]));

        this.params.options = ['', ...list];
    }
}

export default LiveDashletsEntityFieldView;
