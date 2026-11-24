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
use Espo\Entities\User;
use Espo\Modules\LiveDashlets\Tools\ActionQueue;

/**
 * GET LiveDashlets/lastExchange — the latest exchange about a record, seen by the current user.
 */
class LastExchange implements Action
{
    private const TYPE_PATTERN = '/^[A-Za-z][A-Za-z0-9]{0,99}$/';
    private const ID_PATTERN = '/^[A-Za-z0-9_-]{1,64}$/';

    public function __construct(
        private ActionQueue $actionQueue,
        private User $user,
    ) {}

    /**
     * @throws BadRequest
     * @throws Forbidden
     */
    public function process(Request $request): Response
    {
        if ($this->user->isPortal()) {
            throw new Forbidden();
        }

        // A query value can be an array (id[]=...): only plain strings are taken.
        $param = function (string $name) use ($request): ?string {
            $value = $request->getQueryParam($name);

            return is_string($value) && $value !== '' ? $value : null;
        };

        $type = $param('entityType') ?? '';
        $id = $param('id') ?? '';
        $personType = $param('personType');
        $personId = $param('personId');

        if (!preg_match(self::TYPE_PATTERN, $type) || !preg_match(self::ID_PATTERN, $id)) {
            throw new BadRequest();
        }

        if (
            ($personType && !preg_match(self::TYPE_PATTERN, $personType)) ||
            ($personId && !preg_match(self::ID_PATTERN, $personId))
        ) {
            throw new BadRequest();
        }

        return ResponseComposer::json([
            'exchange' => $this->actionQueue->getLastExchange($type, $id, $personType, $personId),
        ])->setHeader('Cache-Control', 'no-store');
    }
}
