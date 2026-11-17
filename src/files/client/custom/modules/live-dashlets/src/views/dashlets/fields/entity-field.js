/************************************************************************
 * Live Dashlets – extension for EspoCRM.
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
