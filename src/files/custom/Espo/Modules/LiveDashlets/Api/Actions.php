<?php

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
            group: in_array($params['group'] ?? null, ActionQueue::GROUP_LIST, true) ? $params['group'] : null,
            kindList: is_array($params['kinds'] ?? null) ?
                array_values(array_intersect(ActionQueue::KIND_LIST, array_filter($params['kinds'], 'is_string'))) :
                [],
        );

        return ResponseComposer::json($result)->setHeader('Cache-Control', 'no-store');
    }
}
