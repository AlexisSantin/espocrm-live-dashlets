<?php

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

        $type = (string) $request->getQueryParam('entityType');
        $id = (string) $request->getQueryParam('id');
        $personType = $request->getQueryParam('personType') ?: null;
        $personId = $request->getQueryParam('personId') ?: null;

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
