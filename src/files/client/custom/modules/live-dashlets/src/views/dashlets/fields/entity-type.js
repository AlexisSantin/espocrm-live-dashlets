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
 * Entity types the user can read. Changing it resets the options that depend on the entity
 * and renames the dashlet when its title was still the automatic one.
 */
class LiveDashletsEntityTypeFieldView extends EnumFieldView {

    setup() {
        super.setup();

        this.previousEntityType = this.model.get('entityType');

        this.on('change', () => this.onEntityTypeChange());
    }

    setupOptions() {
        const scopes = this.getMetadata().get('scopes') || {};

        const list = Object.keys(scopes)
            .filter(scope => {
                const defs = scopes[scope];

                return defs.entity && defs.object && !defs.disabled &&
                    this.getAcl().checkScope(scope, 'read');
            });

        this.translatedOptions = {'': ''};

        list.forEach(scope => {
            this.translatedOptions[scope] = this.translate(scope, 'scopeNamesPlural');
        });

        list.sort((a, b) => this.translatedOptions[a].localeCompare(this.translatedOptions[b]));

        this.params.options = ['', ...list];
    }

    /** @private */
    onEntityTypeChange() {
        const entityType = this.model.get('entityType');
        const dashletName = this.model.dashletName || (this.dataObject || {}).dashletName;

        const attributes = {
            primaryFilter: null,
            boolFilterList: [],
            valueField: null,
            dateField: this.getDefaultDateField(entityType),
        };

        const title = this.model.get('title');

        const automaticTitles = [
            dashletName ? this.translate(dashletName, 'dashlets') : null,
            this.previousEntityType ? this.translate(this.previousEntityType, 'scopeNamesPlural') : null,
        ];

        if (entityType && (!title || automaticTitles.includes(title))) {
            attributes.title = this.translate(entityType, 'scopeNamesPlural');
        }

        this.previousEntityType = entityType;

        this.model.set(attributes);
    }

    /** @private */
    getDefaultDateField(entityType) {
        if (!entityType) {
            return null;
        }

        const fields = this.getMetadata().get(['entityDefs', entityType, 'fields']) || {};

        if (fields.createdAt && !this.getAcl().getScopeForbiddenFieldList(entityType).includes('createdAt')) {
            return 'createdAt';
        }

        return null;
    }
}

export default LiveDashletsEntityTypeFieldView;
