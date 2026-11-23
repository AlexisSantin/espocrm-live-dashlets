/************************************************************************
 * Live Dashlets – extension for EspoCRM.
 ************************************************************************/

import ActionHandler from 'action-handler';

/**
 * "Deploy to Everyone" on a dashboard template's page, next to EspoCRM's own deployments.
 */
class LiveDashletsDeployEveryoneHandler extends ActionHandler {

    // noinspection JSUnusedGlobalSymbols
    deploy() {
        this.view.createView('dialog', 'live-dashlets:views/modals/deploy-everyone', {
            model: this.view.model,
        }, view => {
            view.render();
        });
    }
}

export default LiveDashletsDeployEveryoneHandler;
