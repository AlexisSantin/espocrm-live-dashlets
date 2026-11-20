/************************************************************************
 * Live Dashlets – extension for EspoCRM.
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
