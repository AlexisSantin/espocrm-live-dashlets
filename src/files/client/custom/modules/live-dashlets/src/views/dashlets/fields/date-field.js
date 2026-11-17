/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

import LiveDashletsEntityFieldView from 'live-dashlets:views/dashlets/fields/entity-field';

/** Date fields that place a record in the period. */
class LiveDashletsDateFieldView extends LiveDashletsEntityFieldView {

    fieldTypeList = ['date', 'datetime', 'datetimeOptional']
}

export default LiveDashletsDateFieldView;
