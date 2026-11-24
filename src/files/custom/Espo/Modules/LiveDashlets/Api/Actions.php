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
use Espo\Modules\LiveDashlets\Tools\ActionQueue;

/**
 * GET LiveDashlets/actions — the next actions of the current user.
 */
class Actions implements Action
{
    private const MAX_LIMIT = 30;

    public function __construct(
        private ActionQueue $actionQueue,
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

        $params = $request->getQueryParams();

        $signals = is_array($params['signals'] ?? null) ?
            array_filter($params['signals'], 'is_string') :
            ActionQueue::SIGNAL_LIST;
        $limit = max(1, min(self::MAX_LIMIT, (int) ($params['limit'] ?? self::MAX_LIMIT)));
        $staleDays = max(1, min(3650, (int) ($params['staleDays'] ?? 30)));

        if (($params['section'] ?? null) === 'stale') {
            return ResponseComposer::json($this->actionQueue->getStale($limit, $staleDays))
                ->setHeader('Cache-Control', 'no-store');
        }

        $result = $this->actionQueue->get(
            limit: $limit,
            dormantDays: max(1, min(365, (int) ($params['dormantDays'] ?? 14))),
            staleDays: $staleDays,
            signalList: array_values(array_intersect(ActionQueue::SIGNAL_LIST, $signals)),
            withDone: !empty($params['withDone']),
        );

        return ResponseComposer::json($result)->setHeader('Cache-Control', 'no-store');
    }
}
