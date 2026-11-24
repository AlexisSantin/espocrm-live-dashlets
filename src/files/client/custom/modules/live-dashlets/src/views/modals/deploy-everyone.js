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
import Model from 'model';

/**
 * Deploys a dashboard template to every active user. Their own tabs are kept unless the
 * administrator chooses otherwise, and deploying again updates the tab they got.
 */
class LiveDashletsDeployEveryoneModalView extends ModalView {

    templateContent = `
        <p class="live-deploy-intro"></p>
        <div class="record">{{{record}}}</div>
        <p class="text-muted live-deploy-note live-deploy-lock-note hidden"></p>
        <p class="text-muted live-deploy-note live-deploy-again"></p>
    `

    className = 'dialog dialog-record live-deploy-dialog'

    setup() {
        super.setup();

        this.headerText = this.model.get('name');

        this.buttonList = [
            {
                name: 'deploy',
                text: this.t('deploy'),
                style: 'danger',
                onClick: () => this.deploy(),
            },
            {
                name: 'cancel',
                label: 'Cancel',
            },
        ];

        this.formModel = new Model({append: true, lock: false});
        this.formModel.name = 'None';
        this.formModel.setDefs({
            fields: {
                append: {type: 'bool'},
                lock: {type: 'bool'},
            },
        });

        this.createView('record', 'views/record/edit-for-modal', {
            scope: 'None',
            model: this.formModel,
            selector: '.record',
            detailLayout: [
                {
                    rows: [
                        [{name: 'append', labelText: this.translate('append', 'fields', 'DashboardTemplate')}],
                        [{name: 'lock', labelText: this.t('lock')}],
                    ],
                },
            ],
        });

        this.userCount = null;

        this.wait(
            Espo.Ajax.getRequest('LiveDashlets/deployTemplate').then(data => {
                this.userCount = data.userCount;
            })
        );

        this.listenTo(this.formModel, 'change', () => this.renderNotes());
    }

    afterRender() {
        super.afterRender();

        this.element.querySelector('.live-deploy-again').textContent = this.t('again');
        this.renderNotes();
    }

    /** @private */
    renderNotes() {
        const intro = this.element?.querySelector('.live-deploy-intro');
        const lockNote = this.element?.querySelector('.live-deploy-lock-note');

        if (!intro || !lockNote) {
            return;
        }

        const key = (this.formModel.get('append') ? 'intro' : 'introReplace') + (this.userCount === 1 ? 'One' : '');

        intro.textContent = this.t(key, {count: this.userCount});
        lockNote.textContent = this.t('lockHint');
        lockNote.classList.toggle('hidden', !this.formModel.get('lock'));
    }

    /** @private */
    async deploy() {
        if (!this.getView('record').processFetch()) {
            return;
        }

        this.disableButton('deploy');
        Espo.Ui.notifyWait();

        try {
            const data = await Espo.Ajax.postRequest('LiveDashlets/deployTemplate', {
                id: this.model.id,
                append: !!this.formModel.get('append'),
                lock: !!this.formModel.get('lock'),
            });

            Espo.Ui.success(this.t(data.userCount === 1 ? 'doneOne' : 'done', {count: data.userCount}));
            this.close();
        } catch (e) {
            this.enableButton('deploy');
        }
    }

    /** @private */
    t(key, values = {}) {
        let text = this.translate(key, 'deploy', 'LiveDashlets');

        for (const [name, value] of Object.entries(values)) {
            text = text.replace(`{${name}}`, () => String(value));
        }

        return text;
    }
}

export default LiveDashletsDeployEveryoneModalView;
