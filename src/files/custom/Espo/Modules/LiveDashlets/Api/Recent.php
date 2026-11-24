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
use Espo\Core\Exceptions\Forbidden;
use Espo\Entities\User;
use Espo\Modules\LiveDashlets\Tools\RecentActivity;

/**
 * GET LiveDashlets/recent — what happened recently, for the user, their teams or anyone they can see.
 */
class Recent implements Action
{
    private const MAX_DAYS = 31;
    private const MAX_LIMIT = 100;

    public function __construct(
        private RecentActivity $recentActivity,
        private User $user,
    ) {}

    /**
     * @throws Forbidden
     */
    public function process(Request $request): Response
    {
        if ($this->user->isPortal()) {
            throw new Forbidden();
        }

        // A query value can be an array (teamId[]=...): only plain strings are taken.
        $param = function (string $name) use ($request): ?string {
            $value = $request->getQueryParam($name);

            return is_string($value) && $value !== '' ? $value : null;
        };

        $result = $this->recentActivity->get(
            scope: $param('scope') ?? 'team',
            days: max(1, min(self::MAX_DAYS, (int) ($param('days') ?? 7))),
            limit: max(1, min(self::MAX_LIMIT, (int) ($param('limit') ?? 60))),
            teamId: $param('teamId'),
        );

        return ResponseComposer::json($result)->setHeader('Cache-Control', 'no-store');
    }
}
