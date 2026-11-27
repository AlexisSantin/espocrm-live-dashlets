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

namespace Espo\Modules\LiveDashlets\Tools;

use Espo\Core\Acl;
use Espo\Core\Acl\Table;
use Espo\Entities\User;
use Espo\ORM\EntityManager;

/**
 * "What was done by a team": the active users of a team. One of the viewer's own teams, or
 * another team they may read, when they may also read every user (a tile can be set to any team);
 * any other team is ignored: its members are not theirs to know. The filter only narrows what the viewer already sees: every query keeps their access
 * rights.
 */
class TeamFilter
{
    private const ID_PATTERN = '/^[A-Za-z0-9_-]{1,64}$/';

    public function __construct(
        private User $user,
        private EntityManager $entityManager,
        private Acl $acl,
    ) {}

    /**
     * @return ?array{id: string, name: ?string, userIds: string[]}
     */
    public function resolve(?string $teamId): ?array
    {
        if (!$teamId || !preg_match(self::ID_PATTERN, $teamId)) {
            return null;
        }

        $team = $this->entityManager->getEntityById('Team', $teamId);

        if (!$team) {
            return null;
        }

        // Another team: who is in it is only shown to those who may read it and every user. A
        // narrower access to users (their own, their teams') would not show these members.
        $isMember = in_array($teamId, $this->user->getLinkMultipleIdList('teams'), true);

        if (
            !$isMember &&
            (
                !$this->acl->checkEntityRead($team) ||
                $this->acl->getLevel('User', Table::ACTION_READ) !== Table::LEVEL_ALL
            )
        ) {
            return null;
        }

        $userIds = [];

        $users = $this->entityManager
            ->getRDBRepository('User')
            ->distinct()
            ->join('teams')
            ->where(['teams.id' => $teamId, 'isActive' => true])
            ->select(['id'])
            ->find();

        foreach ($users as $user) {
            $userIds[] = $user->getId();
        }

        return ['id' => $teamId, 'name' => $team->get('name'), 'userIds' => $userIds];
    }
}
