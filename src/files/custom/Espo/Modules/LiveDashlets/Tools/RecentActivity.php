<?php

namespace Espo\Modules\LiveDashlets\Tools;

use DateTimeImmutable;
use DateTimeZone;
use Espo\Core\Acl;
use Espo\Core\Acl\Table;
use Espo\Core\ORM\Entity as CoreEntity;
use Espo\Core\Select\SearchParams;
use Espo\Core\Select\SelectBuilderFactory;
use Espo\Core\Utils\Metadata;
use Espo\Entities\User;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;
use Espo\ORM\Query\SelectBuilder;

/**
 * What happened recently: calls and meetings held, emails linked to a record, contacts, leads
 * and accounts added, deals won or lost, tasks completed.
 *
 * Everything is read through EspoCRM's strict access control, and a record is filtered by who
 * did it only through fields the user may read. Nothing is stored.
 */
class RecentActivity
{
    public const SCOPE_LIST = ['team', 'me', 'all'];

    /** Records read per kind of event. */
    private const FETCH_LIMIT = 50;
    private const NOTE_LENGTH = 400;
    /** Records an email must be linked to, to count as an exchange with a client. */
    private const EMAIL_PARENTS = ['Account', 'Contact', 'Lead', 'Opportunity', 'Case'];

    /**
     * Who did it, for each entity type: the first of these fields the user can read and that has
     * a value names the person.
     */
    private const ACTOR_FIELDS = [
        'Call' => ['assignedUser', 'createdBy'],
        'Meeting' => ['assignedUser', 'createdBy'],
        'Email' => ['sentBy', 'assignedUser', 'createdBy'],
        'Contact' => ['createdBy'],
        'Lead' => ['createdBy'],
        'Account' => ['createdBy'],
        'Opportunity' => ['assignedUser'],
        'Task' => ['assignedUser'],
    ];

    private DateTimeImmutable $now;
    private DateTimeZone $utc;

    /** @var ?string[] The users whose actions are shown; null for anyone. */
    private ?array $actorIds = null;

    public function __construct(
        private Acl $acl,
        private User $user,
        private Metadata $metadata,
        private EntityManager $entityManager,
        private SelectBuilderFactory $selectBuilderFactory,
        private PeriodResolver $periodResolver,
        private TeamFilter $teamFilter,
    ) {
        $this->utc = new DateTimeZone('UTC');
    }

    /**
     * @return array<string, mixed>
     */
    public function get(string $scope, int $days, int $limit, ?string $teamId = null): array
    {
        $this->now = $this->periodResolver->now();

        $scope = in_array($scope, self::SCOPE_LIST, true) ? $scope : 'team';
        $noTeam = false;

        $team = $scope === 'team' ? $this->teamFilter->resolve($teamId) : null;

        if ($team) {
            $this->actorIds = $team['userIds'];
        } elseif ($scope === 'team') {
            $this->actorIds = $this->teamUserIds();
            $noTeam = count($this->actorIds) === 1;
        } elseif ($scope === 'me') {
            $this->actorIds = [$this->user->getId()];
        }

        $since = $this->today()->modify('-' . ($days - 1) . ' days');

        $events = [
            ...$this->exchanges($since),
            ...$this->emails($since),
            ...$this->additions($since),
            ...$this->deals($since),
            ...$this->tasks($since),
        ];

        usort($events, fn ($a, $b) => strcmp($b['at'], $a['at']));

        $events = array_slice($events, 0, $limit);

        $this->addNextSteps($events);

        return [
            'scope' => $scope,
            'team' => $team ? ['id' => $team['id'], 'name' => $team['name']] : null,
            'noTeam' => $noTeam,
            'since' => $since->format('Y-m-d'),
            'today' => $this->today()->format('Y-m-d'),
            'events' => array_map(fn ($event) => $this->finalize($event), $events),
        ];
    }

    // -----------------------------------------------------------------------------------------
    // Events.
    // -----------------------------------------------------------------------------------------

    /**
     * Calls and meetings that took place, held or not.
     *
     * @return array<int, array<string, mixed>>
     */
    private function exchanges(DateTimeImmutable $since): array
    {
        $events = [];

        foreach (['Call' => 'call', 'Meeting' => 'meeting'] as $type => $kind) {
            $list = $this->find($type, [
                'status' => ['Held', 'Not Held'],
                'dateStart>=' => $this->toUtc($since),
                'dateStart<=' => $this->toUtc($this->now),
            ], 'dateStart');

            foreach ($list as $entity) {
                $held = $entity->get('status') === 'Held';
                $target = $this->parentOf($entity);
                $person = $this->findParticipant($entity, $target);

                $events[] = $this->event($entity, $kind, match (true) {
                    $held => 'held',
                    $kind === 'call' => 'noAnswer',
                    default => 'notHeld',
                }, $entity->get('dateStart'), [
                    'target' => $target,
                    'person' => $person,
                    'note' => $this->noteOf($entity),
                    'minutes' => $this->durationOf($entity),
                ]);
            }
        }

        return $events;
    }

    /**
     * Emails sent or received, only when they are linked to a client record.
     *
     * @return array<int, array<string, mixed>>
     */
    private function emails(DateTimeImmutable $since): array
    {
        $list = $this->find('Email', [
            'status' => ['Sent', 'Archived'],
            'parentType' => self::EMAIL_PARENTS,
            'parentId!=' => null,
            'dateSent>=' => $this->toUtc($since),
            'dateSent<=' => $this->toUtc($this->now),
        ], 'dateSent');

        return array_map(function (Entity $email) {
            $target = $this->parentOf($email);
            $person = in_array($target['type'] ?? null, ['Contact', 'Lead'], true) ?
                $this->readableEntity($target['type'], $target['id']) :
                null;

            return $this->event($email, 'email', $email->get('status') === 'Sent' ? 'sent' : 'received', $email->get('dateSent'), [
                'target' => $target,
                'person' => $person,
                'note' => $this->noteOf($email),
            ]);
        }, $list);
    }

    /**
     * Contacts, leads and accounts created. Contacts added by the same person to the same account
     * on the same day make one event.
     *
     * @return array<int, array<string, mixed>>
     */
    private function additions(DateTimeImmutable $since): array
    {
        $events = [];
        $groups = [];

        foreach (['Contact' => 'contact', 'Lead' => 'lead', 'Account' => 'account'] as $type => $kind) {
            $list = $this->find($type, ['createdAt>=' => $this->toUtc($since)], 'createdAt');

            foreach ($list as $entity) {
                $accountId = $kind === 'contact' && $this->acl->checkField('Contact', 'account') ?
                    $entity->get('accountId') :
                    null;

                $event = $this->event($entity, $kind, 'added', $entity->get('createdAt'), [
                    'account' => $accountId ? $this->readableEntity('Account', $accountId) : null,
                ]);

                if ($kind !== 'contact' || !$event['account']) {
                    $events[] = $event;

                    continue;
                }

                $key = implode(':', [$event['actorId'] ?? '', $accountId, $this->toLocal($event['at'])->format('Y-m-d')]);

                if (isset($groups[$key])) {
                    $events[$groups[$key]]['members'][] = $entity;

                    continue;
                }

                $event['members'] = [$entity];
                $groups[$key] = count($events);
                $events[] = $event;
            }
        }

        return $events;
    }

    /**
     * Deals won or lost, by their close date. The time is the last change if it happened that day.
     *
     * @return array<int, array<string, mixed>>
     */
    private function deals(DateTimeImmutable $since): array
    {
        if (!$this->acl->checkField('Opportunity', 'stage') || !$this->acl->checkField('Opportunity', 'closeDate')) {
            return [];
        }

        $probabilityMap = $this->metadata->get(['entityDefs', 'Opportunity', 'fields', 'stage', 'probabilityMap']) ?? [];
        $won = array_keys(array_filter($probabilityMap, fn ($value) => (int) $value === 100)) ?: ['Closed Won'];
        $lost = array_keys(array_filter($probabilityMap, fn ($value) => (int) $value === 0)) ?: ['Closed Lost'];

        $list = $this->find('Opportunity', [
            'stage' => [...$won, ...$lost],
            'closeDate>=' => $since->format('Y-m-d'),
            'closeDate<=' => $this->today()->format('Y-m-d'),
        ], 'closeDate');

        return array_map(function (Entity $deal) use ($won) {
            $closeDate = (string) $deal->get('closeDate');
            $modifiedAt = $deal->get('modifiedAt');
            $sameDay = $modifiedAt && $this->toLocal($modifiedAt)->format('Y-m-d') === $closeDate;
            $at = $sameDay ? $modifiedAt : $this->toUtc(new DateTimeImmutable($closeDate . ' 12:00', $this->now->getTimezone()));

            return $this->event($deal, 'deal', in_array($deal->get('stage'), $won, true) ? 'won' : 'lost', $at, [
                'withoutTime' => !$sameDay,
                'account' => $this->acl->checkField('Opportunity', 'account') && $deal->get('accountId') ?
                    $this->readableEntity('Account', $deal->get('accountId')) :
                    null,
                'note' => $this->noteOf($deal),
            ]);
        }, $list);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function tasks(DateTimeImmutable $since): array
    {
        if (!$this->acl->checkField('Task', 'dateCompleted')) {
            return [];
        }

        $list = $this->find('Task', [
            'status' => 'Completed',
            'dateCompleted>=' => $this->toUtc($since),
        ], 'dateCompleted');

        return array_map(fn (Entity $task) => $this->event($task, 'task', 'completed', $task->get('dateCompleted'), [
            'target' => $this->parentOf($task),
        ]), $list);
    }

    /**
     * @param array<string, mixed> $extra
     * @return array<string, mixed>
     */
    private function event(Entity $entity, string $kind, string $result, string $at, array $extra = []): array
    {
        [$actorId, $actorName] = $this->actorOf($entity);

        return [
            'entity' => $entity,
            'kind' => $kind,
            'result' => $result,
            'at' => $at,
            'actorId' => $actorId,
            'actorName' => $actorName,
            'target' => null,
            'person' => null,
            'account' => null,
            'note' => '',
            'minutes' => null,
            'withoutTime' => false,
            'members' => [],
            'next' => null,
            ...$extra,
        ];
    }

    // -----------------------------------------------------------------------------------------
    // Next steps.
    // -----------------------------------------------------------------------------------------

    /**
     * The next planned call, meeting or open task on the record a call or a meeting was about.
     *
     * @param array<int, array<string, mixed>> $events
     */
    private function addNextSteps(array &$events): void
    {
        $byParent = [];

        foreach ($events as $index => $event) {
            if (in_array($event['kind'], ['call', 'meeting', 'email'], true) && $event['target']) {
                $byParent[$event['target']['type']][$event['target']['id']][] = $index;
            }
        }

        if (!$byParent) {
            return;
        }

        $now = $this->toUtc($this->now);
        $closed = $this->metadata->get(['entityDefs', 'Task', 'fields', 'status', 'notActualOptions']) ?? ['Completed', 'Canceled'];
        $found = [];

        foreach ($byParent as $parentType => $ids) {
            $where = ['parentType' => $parentType, 'parentId' => array_keys($ids)];

            $planned = [
                'Call' => [...$where, 'status' => 'Planned', 'dateStart>=' => $now],
                'Meeting' => [...$where, 'status' => 'Planned', 'dateStart>=' => $now],
                'Task' => [...$where, 'status!=' => $closed],
            ];

            foreach ($planned as $type => $conditions) {
                $field = $type === 'Task' ? 'dateEnd' : 'dateStart';

                if (!$this->canRead($type)) {
                    continue;
                }

                $list = $this->fetch($type, $this->query($type)->where($conditions)->order([[$field, 'ASC']]), self::FETCH_LIMIT);

                foreach ($list as $entity) {
                    $key = $parentType . ':' . $entity->get('parentId');
                    $date = $entity->get($field) ?: '9999';

                    if (!isset($found[$key]) || strcmp($date, $found[$key]['sort']) < 0) {
                        $found[$key] = ['sort' => $date, 'entity' => $entity, 'field' => $field];
                    }
                }
            }
        }

        foreach ($byParent as $parentType => $ids) {
            foreach ($ids as $parentId => $indexes) {
                $next = $found[$parentType . ':' . $parentId] ?? null;

                if (!$next) {
                    continue;
                }

                foreach ($indexes as $index) {
                    // A next step planned before the exchange does not follow from it.
                    if ($next['entity']->get('createdAt') < $events[$index]['at']) {
                        continue;
                    }

                    $events[$index]['next'] = $next;
                }
            }
        }
    }

    // -----------------------------------------------------------------------------------------
    // Output.
    // -----------------------------------------------------------------------------------------

    /**
     * @param array<string, mixed> $event
     * @return array<string, mixed>
     */
    private function finalize(array $event): array
    {
        /** @var Entity $entity */
        $entity = $event['entity'];
        $type = $entity->getEntityType();
        $own = ['type' => $type, 'id' => $entity->getId()];
        $local = $this->toLocal($event['at']);

        /** @var ?Entity $person */
        $person = $event['person'];
        /** @var ?Entity $account */
        $account = $event['account'];
        $target = $event['target'];

        $label = $type === 'Email' ? $entity->get('name') : $this->nameOf($entity);

        // Several contacts added together make one line; a single one is shown as itself.
        $members = count($event['members']) > 1 ? $event['members'] : [];

        // Title: the person, else the record; subtitle: their company, else what it was about.
        if ($members) {
            $title = null;
            $titleLink = null;
        } elseif ($person) {
            $title = $this->nameOf($person);
            $titleLink = ['type' => $person->getEntityType(), 'id' => $person->getId()];
        } elseif (in_array($event['kind'], ['contact', 'lead', 'account', 'deal', 'task'], true)) {
            $title = $label;
            $titleLink = $own;
        } else {
            $title = $target['name'] ?? $label;
            $titleLink = $target ? $this->readableLink($target['type'], $target['id']) : $own;
        }

        [$subtitle, $subtitleLink] = $this->subtitleOf($event, $person, $account, $target, $title);

        // Records are often called "Rollout — Company": the company is already beside it.
        $title = $this->withoutSuffix($title, $subtitle);
        $label = $this->withoutSuffix($label, $subtitle);

        return [
            'key' => $type . ':' . $entity->getId(),
            'kind' => $event['kind'],
            'result' => $event['result'],
            'at' => $event['at'],
            'date' => $local->format('Y-m-d'),
            'time' => $event['withoutTime'] ? null : $local->format('H:i'),
            'title' => $title,
            'subtitle' => $subtitle,
            'label' => $label,
            'note' => $event['note'],
            'minutes' => $event['minutes'],
            'amount' => $event['kind'] === 'deal' && $this->acl->checkField('Opportunity', 'amount') ?
                $entity->get('amount') : null,
            'currency' => $event['kind'] === 'deal' ? $entity->get('amountCurrency') : null,
            'actor' => $event['actorId'] ? ['id' => $event['actorId'], 'name' => $event['actorName']] : null,
            'mine' => $event['actorId'] === $this->user->getId(),
            'count' => count($members),
            'members' => array_map(fn (Entity $member) => [
                'name' => $this->nameOf($member),
                'link' => ['type' => $member->getEntityType(), 'id' => $member->getId()],
            ], $members),
            'next' => $event['next'] ? [
                'type' => $event['next']['entity']->getEntityType(),
                'name' => $this->nameOf($event['next']['entity']),
                'date' => $this->dateOf($event['next']['entity'], $event['next']['field']),
                'link' => [
                    'type' => $event['next']['entity']->getEntityType(),
                    'id' => $event['next']['entity']->getId(),
                ],
            ] : null,
            'links' => [
                'title' => $titleLink,
                'subtitle' => $subtitleLink,
                'record' => $own,
            ],
        ];
    }

    /**
     * @param array<string, mixed> $event
     * @param ?array{type: string, id: string, name: ?string} $target
     * @return array{0: ?string, 1: ?array{type: string, id: string}}
     */
    private function subtitleOf(array $event, ?Entity $person, ?Entity $account, ?array $target, ?string $title): array
    {
        if ($account) {
            return [$this->nameOf($account), ['type' => 'Account', 'id' => $account->getId()]];
        }

        $accountId = $person && $person->getEntityType() === 'Contact' && $this->acl->checkField('Contact', 'account') ?
            $person->get('accountId') :
            null;

        if ($accountId && $this->readableEntity('Account', $accountId)) {
            return [$person->get('accountName'), ['type' => 'Account', 'id' => $accountId]];
        }

        if ($person && $person->getEntityType() === 'Lead' && $this->acl->checkField('Lead', 'accountName')) {
            return [$person->get('accountName') ?: null, null];
        }

        if ($target && $target['name'] && $target['name'] !== $title) {
            return [$target['name'], $this->readableLink($target['type'], $target['id'])];
        }

        return [null, null];
    }

    private function withoutSuffix(?string $text, ?string $name): ?string
    {
        $suffix = ' — ' . $name;

        return $text && $name && str_ends_with($text, $suffix) ? substr($text, 0, -strlen($suffix)) : $text;
    }

    // -----------------------------------------------------------------------------------------
    // Reading records.
    // -----------------------------------------------------------------------------------------

    /**
     * The records of a type that match, done by the users in scope, the latest first.
     *
     * @param array<string|int, mixed> $where
     * @return Entity[]
     */
    private function find(string $type, array $where, string $orderBy): array
    {
        if (!$this->canRead($type)) {
            return [];
        }

        if ($this->actorIds !== null) {
            $fields = $this->readableActorFields($type);

            // Who did it can't be told from fields the user may not read.
            if (!$fields) {
                return [];
            }

            $where[] = ['OR' => array_map(fn ($field) => [$field . 'Id' => $this->actorIds], $fields)];
        }

        return $this->fetch($type, $this->query($type)->where($where)->order([[$orderBy, 'DESC']]), self::FETCH_LIMIT);
    }

    /**
     * @return string[]
     */
    private function readableActorFields(string $type): array
    {
        return array_values(array_filter(
            self::ACTOR_FIELDS[$type] ?? [],
            fn ($field) => $this->hasAttribute($type, $field . 'Id') && $this->acl->checkField($type, $field)
        ));
    }

    /**
     * @return array{0: ?string, 1: ?string}
     */
    private function actorOf(Entity $entity): array
    {
        foreach ($this->readableActorFields($entity->getEntityType()) as $field) {
            $id = $entity->get($field . 'Id');

            if ($id && ($this->actorIds === null || in_array($id, $this->actorIds, true))) {
                return [$id, $entity->get($field . 'Name')];
            }
        }

        return [null, null];
    }

    /**
     * The user and the members of their teams.
     *
     * @return string[]
     */
    private function teamUserIds(): array
    {
        $ids = [$this->user->getId()];
        $teamIds = $this->user->getLinkMultipleIdList('teams');

        if (!$teamIds) {
            return $ids;
        }

        $users = $this->entityManager
            ->getRDBRepository('User')
            ->distinct()
            ->join('teams')
            ->where(['teams.id' => $teamIds, 'isActive' => true])
            ->select(['id'])
            ->find();

        foreach ($users as $user) {
            $ids[] = $user->getId();
        }

        return array_values(array_unique($ids));
    }

    /**
     * A readable contact or lead linked to the call or the meeting, from its account first.
     *
     * @param ?array{type: string, id: string, name: ?string} $target
     */
    private function findParticipant(Entity $activity, ?array $target): ?Entity
    {
        if (in_array($target['type'] ?? null, ['Contact', 'Lead'], true)) {
            return $this->readableEntity($target['type'], $target['id']);
        }

        $accountId = ($target['type'] ?? null) === 'Account' ? $target['id'] : null;
        $other = null;

        foreach (['contacts' => 'Contact', 'leads' => 'Lead'] as $link => $type) {
            if (!$activity->hasRelation($link) || !$this->canRead($type) || !$this->acl->checkField($activity->getEntityType(), $link)) {
                continue;
            }

            $people = $this->entityManager
                ->getRDBRepository($activity->getEntityType())
                ->getRelation($activity, $link)
                ->limit(0, 20)
                ->find();

            foreach ($people as $person) {
                if (!$this->acl->checkEntityRead($person)) {
                    continue;
                }

                if (!$accountId || ($person->hasAttribute('accountId') && $person->get('accountId') === $accountId)) {
                    return $person;
                }

                $other ??= $person;
            }
        }

        return $other;
    }

    /**
     * @return ?array{type: string, id: string, name: ?string}
     */
    private function parentOf(Entity $entity): ?array
    {
        if (!$entity->hasAttribute('parentId') || !$this->acl->checkField($entity->getEntityType(), 'parent')) {
            return null;
        }

        $type = $entity->get('parentType');
        $id = $entity->get('parentId');

        if (!$type || !$id) {
            return null;
        }

        return ['type' => $type, 'id' => $id, 'name' => $this->acl->checkField($type, 'name') ? $entity->get('parentName') : null];
    }

    /**
     * The text of a call, a meeting, an email or a deal, if the user may read it.
     */
    private function noteOf(Entity $entity): string
    {
        $type = $entity->getEntityType();
        $field = $type === 'Email' ? 'body' : 'description';

        if (!$entity->hasAttribute($field) || !$this->acl->checkField($type, $field)) {
            return '';
        }

        $text = (string) $entity->get($field);
        $text = trim((string) preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5)));

        return mb_strlen($text) > self::NOTE_LENGTH ? rtrim(mb_substr($text, 0, self::NOTE_LENGTH - 1)) . '…' : $text;
    }

    private function durationOf(Entity $entity): ?int
    {
        $start = $entity->get('dateStart');
        $end = $entity->get('dateEnd');

        if (!$start || !$end || $entity->get('status') !== 'Held') {
            return null;
        }

        $minutes = (int) round((strtotime($end . ' UTC') - strtotime($start . ' UTC')) / 60);

        return $minutes > 0 ? $minutes : null;
    }

    private function dateOf(Entity $entity, string $field): ?string
    {
        $dateOnly = $entity->hasAttribute($field . 'Date') ? $entity->get($field . 'Date') : null;

        if ($dateOnly) {
            return $dateOnly;
        }

        return $entity->get($field) ? $this->toLocal($entity->get($field))->format('Y-m-d') : null;
    }

    private function nameOf(Entity $entity): ?string
    {
        return $this->acl->checkField($entity->getEntityType(), 'name') ? $entity->get('name') : null;
    }

    /**
     * @return ?array{type: string, id: string}
     */
    private function readableLink(?string $type, ?string $id): ?array
    {
        return $type && $id && $this->readableEntity($type, $id) ? ['type' => $type, 'id' => $id] : null;
    }

    private function readableEntity(string $type, string $id): ?Entity
    {
        if (!$this->canRead($type)) {
            return null;
        }

        $entity = $this->entityManager->getEntityById($type, $id);

        return $entity && $this->acl->checkEntityRead($entity) ? $entity : null;
    }

    private function canRead(string $type): bool
    {
        return $this->metadata->get(['scopes', $type, 'entity']) &&
            !$this->metadata->get(['scopes', $type, 'disabled']) &&
            $this->entityManager->hasRepository($type) &&
            $this->acl->checkScope($type, Table::ACTION_READ);
    }

    private function hasAttribute(string $type, string $attribute): bool
    {
        return $this->entityManager->getDefs()->getEntity($type)->hasAttribute($attribute);
    }

    /**
     * Note: the builder carries EspoCRM's default order; ordering with an array replaces it.
     */
    private function query(string $type): SelectBuilder
    {
        return $this->selectBuilderFactory
            ->create()
            ->from($type)
            ->withStrictAccessControl()
            ->withSearchParams(SearchParams::fromRaw([]))
            ->buildQueryBuilder();
    }

    /**
     * @return Entity[]
     */
    private function fetch(string $type, SelectBuilder $builder, int $limit): array
    {
        $collection = $this->entityManager
            ->getRDBRepository($type)
            ->clone($builder->limit(0, $limit)->build())
            ->find();

        $list = iterator_to_array($collection, false);

        foreach ($list as $entity) {
            if ($entity instanceof CoreEntity && $entity->hasAttribute('parentId')) {
                $entity->loadParentNameField('parent');
            }
        }

        return $list;
    }

    private function toUtc(DateTimeImmutable $date): string
    {
        return $date->setTimezone($this->utc)->format('Y-m-d H:i:s');
    }

    private function toLocal(string $utc): DateTimeImmutable
    {
        return (new DateTimeImmutable($utc, $this->utc))->setTimezone($this->now->getTimezone());
    }

    private function today(): DateTimeImmutable
    {
        return $this->now->setTime(0, 0);
    }
}
