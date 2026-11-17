/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

import LiveDashletsEntityFieldView from 'live-dashlets:views/dashlets/fields/entity-field';

/** Numeric fields that can be added up or averaged. */
class LiveDashletsValueFieldView extends LiveDashletsEntityFieldView {

    fieldTypeList = ['int', 'float', 'currency']
}

export default LiveDashletsValueFieldView;
