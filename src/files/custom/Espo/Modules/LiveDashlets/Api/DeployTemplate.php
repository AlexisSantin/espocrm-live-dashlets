<?php
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

namespace Espo\Modules\LiveDashlets\Api;

use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\Exceptions\NotFound;
use Espo\Entities\User;
use Espo\Modules\LiveDashlets\Tools\TemplateDeployer;

/**
 * GET LiveDashlets/deployTemplate — how many users a deployment to everyone reaches.
 * POST LiveDashlets/deployTemplate {id, append, lock} — deploys a dashboard template to them.
 *
 * Administrators only, as EspoCRM's own deployment.
 */
class DeployTemplate implements Action
{
    private const ID_PATTERN = '/^[A-Za-z0-9_-]{1,64}$/';

    public function __construct(
        private TemplateDeployer $deployer,
        private User $user,
    ) {}

    /**
     * @throws BadRequest
     * @throws Forbidden
     * @throws NotFound
     */
    public function process(Request $request): Response
    {
        if (!$this->user->isAdmin()) {
            throw new Forbidden();
        }

        if ($request->getMethod() !== 'POST') {
            return ResponseComposer::json(['userCount' => $this->deployer->countUsers()])
                ->setHeader('Cache-Control', 'no-store');
        }

        $data = $request->getParsedBody();
        $id = $data->id ?? null;

        if (!is_string($id) || !preg_match(self::ID_PATTERN, $id)) {
            throw new BadRequest();
        }

        $count = $this->deployer->deployToEveryone($id, ($data->append ?? true) === true, ($data->lock ?? false) === true);

        return ResponseComposer::json(['userCount' => $count]);
    }
}
