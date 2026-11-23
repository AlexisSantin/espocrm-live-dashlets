<?php

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
