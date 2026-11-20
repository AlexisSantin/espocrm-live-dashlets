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

        $result = $this->recentActivity->get(
            scope: (string) ($request->getQueryParam('scope') ?? 'team'),
            days: max(1, min(self::MAX_DAYS, (int) ($request->getQueryParam('days') ?? 7))),
            limit: max(1, min(self::MAX_LIMIT, (int) ($request->getQueryParam('limit') ?? 60))),
        );

        return ResponseComposer::json($result)->setHeader('Cache-Control', 'no-store');
    }
}
