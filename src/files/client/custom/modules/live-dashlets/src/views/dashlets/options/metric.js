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

import BaseDashletOptionsModalView from 'views/dashlets/options/base';

/**
 * Shows only the options that matter: the value field for a sum or an average,
 * the date field and the comparison when a period is chosen.
 */
class LiveDashletsMetricOptionsView extends BaseDashletOptionsModalView {

    setup() {
        super.setup();

        this.listenTo(this.model, 'change:metric change:period', () => this.controlFields());

        // A tile made solid before 1.4 is shown as highlighted: saving keeps it that way.
        if (this.model.get('highlight') == null && this.model.get('tileStyle') === 'solid') {
            this.model.set('highlight', true);
        }

        this.controlFields();
    }

    /** @private */
    controlFields() {
        const recordView = this.getRecordView();
        const hasComparison = 'comparison' in this.fields;

        const metric = this.model.get('metric') || 'count';
        const hasPeriod = (this.model.get('period') || 'ever') !== 'ever';

        if (metric === 'count') {
            recordView.hideField('valueField');
            recordView.setFieldNotRequired('valueField');
        } else {
            recordView.showField('valueField');
            recordView.setFieldRequired('valueField');
        }

        if (hasPeriod) {
            recordView.showField('dateField');
            recordView.setFieldRequired('dateField');
        } else {
            recordView.hideField('dateField');
            recordView.setFieldNotRequired('dateField');
        }

        if (hasComparison) {
            hasPeriod ? recordView.showField('comparison') : recordView.hideField('comparison');
        }
    }
}

export default LiveDashletsMetricOptionsView;
