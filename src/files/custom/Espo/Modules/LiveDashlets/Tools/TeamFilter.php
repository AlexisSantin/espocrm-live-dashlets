<?php

namespace Espo\Modules\LiveDashlets\Tools;

use Espo\Entities\User;
use Espo\ORM\EntityManager;

/**
 * "What was done by a team": the active users of one of the viewer's own teams. A team the
 * viewer is not a member of is ignored, so the filter can only narrow what they already see.
 */
class TeamFilter
{
    private const ID_PATTERN = '/^[A-Za-z0-9_-]{1,64}$/';

    public function __construct(
        private User $user,
        private EntityManager $entityManager,
    ) {}

    /**
     * @return ?array{id: string, name: ?string, userIds: string[]}
     */
    public function resolve(?string $teamId): ?array
    {
        if (
            !$teamId ||
            !preg_match(self::ID_PATTERN, $teamId) ||
            !in_array($teamId, $this->user->getLinkMultipleIdList('teams'), true)
        ) {
            return null;
        }

        $team = $this->entityManager->getEntityById('Team', $teamId);

        if (!$team) {
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
