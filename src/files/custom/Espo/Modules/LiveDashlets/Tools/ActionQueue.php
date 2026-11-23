<?php

namespace Espo\Modules\LiveDashlets\Tools;

use DateTimeImmutable;
use DateTimeZone;
use Espo\Core\Acl;
use Espo\Core\Acl\Table;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\ORM\Entity as CoreEntity;
use Espo\Core\Select\SearchParams;
use Espo\Core\Select\SelectBuilderFactory;
use Espo\Core\Utils\Metadata;
use Espo\Entities\User;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;
use Espo\ORM\Query\SelectBuilder;
use PDO;

/**
 * The next actions of the current user: what to do, why, and for whom.
 *
 * Only the user's own records are listed, and everything is read through EspoCRM's strict access
 * control. "Last exchange" therefore means the last exchange this user is allowed to see.
 * Nothing is stored: a record leaves the list when it is handled, or when a next step is planned.
 */
class ActionQueue
{
    public const SIGNAL_LIST = ['tasks', 'activities', 'leads', 'deals', 'followUps'];

    /** Records read per signal before ranking; past this, the count is shown as "N+". */
    private const CANDIDATE_LIMIT = 300;
    private const ACTIVITY_WINDOW_DAYS = 7;
    private const NEW_LEAD_DAYS = 30;
    private const DONE_LIMIT = 30;
    private const WORKDAY_START = '09:00';
    private const NOTE_LENGTH = 400;
    /** A task added this long after a call or a meeting is not its next step. */
    private const FOLLOW_UP_SECONDS = 1800;

    private const PRIORITY_BONUS = ['Urgent' => 10, 'High' => 5, 'Low' => -3];

    private DateTimeImmutable $now;
    private DateTimeZone $utc;
    /** Overdue tasks older than this are set apart (UTC). */
    private string $staleBefore = '';

    /** @var array<string, string> Latest exchange by "EntityType:id" (UTC). */
    private array $lastTouch = [];
    /** @var array<string, true> Records with a next step planned. */
    private array $planned = [];
    /** @var array<string, string[]> */
    private array $contactsByAccount = [];
    /** @var array<string, true> Accounts whose contacts are in $contactsByAccount. */
    private array $accountsLoaded = [];
    /** @var array<string, array<string, mixed>> The last exchange of each deal shown, by deal id. */
    private array $dealExchanges = [];
    /** A signal had more records than were read. */
    private bool $capped = false;

    public function __construct(
        private Acl $acl,
        private User $user,
        private Metadata $metadata,
        private EntityManager $entityManager,
        private SelectBuilderFactory $selectBuilderFactory,
        private PeriodResolver $periodResolver,
    ) {
        $this->utc = new DateTimeZone('UTC');
    }

    /**
     * @param string[] $signalList
     * @return array<string, mixed>
     */
    public function get(
        int $limit,
        int $dormantDays,
        int $staleDays,
        array $signalList,
        bool $withDone = false
    ): array {
        $this->prepare($staleDays);

        $available = array_filter(
            ['Task', 'Call', 'Meeting', 'Lead', 'Opportunity'],
            fn ($entityType) => $this->canRead($entityType)
        );

        $has = fn (string $signal) => in_array($signal, $signalList, true);

        $leads = $has('leads') ? $this->fetchLeads() : [];
        $deals = $has('deals') ? $this->fetchDeals() : [];
        $meetings = $has('followUps') ? $this->fetchHeldMeetings() : [];

        $this->loadExchanges($leads, $deals, $meetings);

        $staleCount = $has('tasks') ? $this->countStaleTasks() : 0;

        $items = [
            ...($has('tasks') ? $this->taskItems() : []),
            ...($has('activities') ? $this->activityItems() : []),
            ...$this->leadItems($leads),
            ...$this->dealItems($deals, $dormantDays),
            ...$this->followUpItems($meetings),
        ];

        usort($items, fn ($a, $b) => $b['score'] <=> $a['score']);

        $total = count($items);
        $urgent = count(array_filter($items, fn ($item) => $item['urgent']));

        $items = array_slice($items, 0, $limit);

        $this->loadDealExchanges($items);

        $items = array_map(fn ($item) => $this->finalize($item), $items);

        return [
            'available' => $available !== [],
            'items' => $items,
            'total' => $total,
            'capped' => $this->capped,
            'urgent' => $urgent,
            'staleCount' => $staleCount,
            'done' => $withDone ? $this->doneItems() : [],
            'next' => $total === 0 ? $this->findNextPlanned() : null,
            'dates' => [
                'tomorrow' => $this->workdayAt(1),
                'in3Days' => $this->workdayAt(3),
                'in7Days' => $this->workdayAt(7),
                'today' => $this->today()->format('Y-m-d'),
                'snooze' => $this->snoozeDates(),
            ],
        ];
    }

    /**
     * Overdue tasks left aside: too old to be urgent, still to be sorted out.
     *
     * @return array<string, mixed>
     */
    public function getStale(int $limit, int $staleDays): array
    {
        $this->prepare($staleDays);

        $tasks = $this->canRead('Task') ?
            $this->fetch('Task', $this->staleTaskQuery()->order([['dateEnd', 'DESC']]), $limit) :
            [];

        $items = [];

        foreach ($tasks as $task) {
            $item = $this->taskItem($task, ['Deferred']);

            if ($item) {
                $items[] = $this->finalize($item);
            }
        }

        return ['items' => $items, 'total' => $this->countStaleTasks()];
    }

    /**
     * The latest exchange the user can see about a record and the person to reach.
     *
     * @return ?array<string, mixed> Null when none is recorded.
     * @throws Forbidden
     */
    public function getLastExchange(string $type, string $id, ?string $personType, ?string $personId): ?array
    {
        $this->prepare(30);

        $record = $this->readableEntity($type, $id);

        if (!$record) {
            throw new Forbidden();
        }

        return $this->findLastExchange($record, $personType, $personId);
    }

    /**
     * @return ?array<string, mixed>
     */
    private function findLastExchange(Entity $record, ?string $personType, ?string $personId): ?array
    {
        $type = $record->getEntityType();
        $id = $record->getId();

        $ids = [$type => [$id]];
        $accountId = $type === 'Account' ? $id : ($record->hasAttribute('accountId') ? $record->get('accountId') : null);

        if ($personType && $personId && $this->readableEntity($personType, $personId)) {
            $ids[$personType][] = $personId;
        }

        if ($record->hasAttribute('contactId') && $record->get('contactId')) {
            $ids['Contact'][] = $record->get('contactId');
        }

        $parentType = $record->hasAttribute('parentType') ? $record->get('parentType') : null;
        $parentId = $record->hasAttribute('parentId') ? $record->get('parentId') : null;
        $parent = $parentType && $parentId ? $this->readableEntity($parentType, $parentId) : null;

        if ($parent) {
            $ids[$parentType][] = $parentId;
            $accountId ??= $parentType === 'Account' ? $parentId :
                ($parent->hasAttribute('accountId') ? $parent->get('accountId') : null);
        }

        if ($accountId) {
            $ids['Account'][] = $accountId;
            $this->loadContactsOfAccounts([$accountId]);

            foreach ($this->contactsByAccount[$accountId] ?? [] as $contactId) {
                $ids['Contact'][] = $contactId;
            }
        }

        $ids = array_map(fn ($list) => array_values(array_unique($list)), $ids);
        $found = [];

        foreach (['Call' => ['Held', 'Not Held'], 'Meeting' => ['Held']] as $entityType => $statusList) {
            if ($this->canRead($entityType)) {
                array_push($found, ...$this->findLatestActivities($entityType, $statusList, $ids));
            }
        }

        if ($this->canRead('Email')) {
            $parentConditions = [];

            foreach ($ids as $parentType => $parentIds) {
                $parentConditions[] = ['parentType' => $parentType, 'parentId' => $parentIds];
            }

            $email = $this->fetch('Email', $this->query('Email', null, false)
                ->where(['status' => ['Sent', 'Archived'], 'OR' => $parentConditions])
                ->order([['dateSent', 'DESC']]), 1)[0] ?? null;

            if ($email && $email->get('dateSent')) {
                $found[] = ['date' => $email->get('dateSent'), 'entity' => $email];
            }
        }

        if (!$found) {
            return null;
        }

        usort($found, fn ($a, $b) => strcmp($b['date'], $a['date']));

        return $this->describeExchange($found[0]['entity'], $found[0]['date']);
    }

    /**
     * @param string[] $statusList
     * @param array<string, string[]> $ids
     * @return array<int, array{date: string, entity: Entity}>
     */
    private function findLatestActivities(string $entityType, array $statusList, array $ids): array
    {
        $base = ['status' => $statusList, 'dateStart<=' => $this->toUtc($this->now)];
        $conditions = [];

        foreach ($ids as $parentType => $parentIds) {
            $conditions[] = ['parentType' => $parentType, 'parentId' => $parentIds];
        }

        if (!empty($ids['Account']) && $this->hasAttribute($entityType, 'accountId')) {
            $conditions[] = ['accountId' => $ids['Account']];
        }

        $builders = [$this->query($entityType, null, false)->where([...$base, 'OR' => $conditions])];

        foreach (['Contact' => 'contacts', 'Lead' => 'leads'] as $personType => $link) {
            if (!empty($ids[$personType])) {
                $builders[] = $this->query($entityType, null, false)
                    ->distinct()
                    ->join($link, 'exchangePerson')
                    ->where([...$base, 'exchangePerson.id' => $ids[$personType]]);
            }
        }

        $found = [];

        foreach ($builders as $builder) {
            $entity = $this->fetch($entityType, $builder->order([['dateStart', 'DESC']]), 1)[0] ?? null;

            if ($entity) {
                $found[] = ['date' => $entity->get('dateStart'), 'entity' => $entity];
            }
        }

        return $found;
    }

    /**
     * @return array<string, mixed>
     */
    private function describeExchange(Entity $entity, string $date): array
    {
        $type = $entity->getEntityType();
        $local = $this->toLocal($date);

        return [
            'kind' => match (true) {
                $type === 'Email' => 'email',
                $type === 'Meeting' => 'meeting',
                $entity->get('status') === 'Held' => 'call',
                default => 'callNoAnswer',
            },
            'date' => $local->format('Y-m-d'),
            'label' => $type === 'Email' ? $entity->get('name') : $this->taskTitle($entity),
            'note' => $this->noteOf($entity, 180),
            'author' => $entity->hasAttribute('assignedUserName') ? $entity->get('assignedUserName') : null,
            'link' => ['type' => $type, 'id' => $entity->getId()],
        ];
    }

    /**
     * The text of a call, a meeting or an email, if the user may read it.
     */
    private function noteOf(Entity $entity, int $length): string
    {
        $type = $entity->getEntityType();
        $field = $type === 'Email' ? 'body' : 'description';
        $text = $this->acl->checkField($type, $field) ? (string) $entity->get($field) : '';
        $text = trim((string) preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5)));

        return mb_strlen($text) > $length ? rtrim(mb_substr($text, 0, $length - 1)) . '…' : $text;
    }

    /**
     * What the user finished or added today, the latest first. Next steps are shown under the call
     * or the meeting they follow.
     *
     * @return array<int, array<string, mixed>>
     */
    private function doneItems(): array
    {
        $since = $this->toUtc($this->today());
        $me = $this->user->getId();
        $byMe = ['OR' => [
            ['createdById' => $me, 'createdAt>=' => $since],
            ['modifiedById' => $me, 'modifiedAt>=' => $since],
        ]];
        $addedByMe = ['createdById' => $me, 'createdAt>=' => $since];

        $find = function (string $type, array $where, string $order): array {
            return $this->canRead($type) ?
                $this->fetch($type, $this->query($type, null, false)->where($where)->order([[$order, 'DESC']]), self::DONE_LIMIT) :
                [];
        };

        $changedAt = fn (Entity $entity) => $entity->get('modifiedAt') ?: $entity->get('createdAt');
        $done = [];

        foreach ($find('Call', ['status' => ['Held', 'Not Held'], ...$byMe], 'modifiedAt') as $call) {
            $result = $call->get('status') === 'Held' ? 'callHeld' : 'callNoAnswer';
            $done[] = $this->doneEvent($call, 'call', $result, $changedAt($call), $this->noteOf($call, self::NOTE_LENGTH));
        }

        foreach ($find('Meeting', ['status' => ['Held', 'Not Held'], ...$byMe], 'modifiedAt') as $meeting) {
            $result = $meeting->get('status') === 'Held' ? 'meetingHeld' : 'meetingNotHeld';
            $done[] = $this->doneEvent($meeting, 'meeting', $result, $changedAt($meeting), $this->noteOf($meeting, self::NOTE_LENGTH));
        }

        $completed = [
            'status' => 'Completed',
            'dateCompleted>=' => $since,
            'OR' => [['modifiedById' => $me], ['modifiedById' => null, 'createdById' => $me]],
        ];

        foreach ($find('Task', $completed, 'dateCompleted') as $task) {
            $done[] = $this->doneEvent($task, 'task', 'taskCompleted', $task->get('dateCompleted'), '');
        }

        $sent = ['status' => 'Sent', 'dateSent>=' => $since, 'OR' => [['sentById' => $me], ['createdById' => $me]]];

        foreach ($find('Email', $sent, 'dateSent') as $email) {
            $done[] = $this->doneEvent($email, 'email', 'emailSent', $email->get('dateSent'), (string) $email->get('name'));
        }

        usort($done, fn ($a, $b) => strcmp($b['time'], $a['time']));

        $closed = $this->metadata->get(['entityDefs', 'Task', 'fields', 'status', 'notActualOptions']) ?? [];
        $added = [
            ...array_map(
                fn ($entity) => $this->doneEvent($entity, 'added', 'taskAdded', $entity->get('createdAt'), ''),
                $find('Task', [...$addedByMe, 'status!=' => $closed], 'createdAt')
            ),
            ...array_map(
                fn ($entity) => $this->doneEvent($entity, 'added', 'meetingAdded', $entity->get('createdAt'), ''),
                $find('Meeting', [...$addedByMe, 'status' => 'Planned'], 'createdAt')
            ),
            ...array_map(
                fn ($entity) => $this->doneEvent($entity, 'added', 'callAdded', $entity->get('createdAt'), ''),
                $find('Call', [...$addedByMe, 'status' => 'Planned'], 'createdAt')
            ),
        ];

        foreach ($added as $event) {
            $index = $this->findFollowedEvent($done, $event);

            if ($index === null) {
                $done[] = $event;

                continue;
            }

            $done[$index]['followUps'][] = $this->followUpOf($event['entity']);
        }

        usort($done, fn ($a, $b) => strcmp($b['time'], $a['time']));

        return array_map(fn ($event) => $this->finalizeDone($event), array_slice($done, 0, self::DONE_LIMIT));
    }

    /**
     * @param array<int, array<string, mixed>> $done The latest first.
     * @param array<string, mixed> $added
     */
    private function findFollowedEvent(array $done, array $added): ?int
    {
        $target = $added['target'];

        if (!$target) {
            return null;
        }

        $time = strtotime($added['time'] . ' UTC');

        foreach ($done as $index => $event) {
            $gap = $time - strtotime($event['time'] . ' UTC');

            if (
                in_array($event['kind'], ['call', 'meeting'], true) &&
                $event['target'] &&
                $event['target']['type'] === $target['type'] &&
                $event['target']['id'] === $target['id'] &&
                $gap >= -60 &&
                $gap <= self::FOLLOW_UP_SECONDS
            ) {
                return $index;
            }
        }

        return null;
    }

    /**
     * @return array<string, mixed>
     */
    private function doneEvent(Entity $entity, string $kind, string $result, string $time, string $note): array
    {
        return [
            'entity' => $entity,
            'kind' => $kind,
            'result' => $result,
            'time' => $time,
            'note' => $note,
            'target' => $entity->hasAttribute('parentId') ? $this->parentOf($entity) : null,
            'followUps' => [],
        ];
    }

    /**
     * @return array<string, ?string>
     */
    private function followUpOf(Entity $entity): array
    {
        return [
            'entityType' => $entity->getEntityType(),
            'id' => $entity->getId(),
            'name' => $this->taskTitle($entity),
            'date' => $this->dueDateOf($entity),
        ];
    }

    private function dueDateOf(Entity $entity): ?string
    {
        $field = $entity->getEntityType() === 'Task' ? 'dateEnd' : 'dateStart';
        $dateOnly = $entity->hasAttribute($field . 'Date') ? $entity->get($field . 'Date') : null;

        if ($dateOnly) {
            return $dateOnly;
        }

        return $entity->get($field) ? $this->toLocal($entity->get($field))->format('Y-m-d') : null;
    }

    /**
     * @param array<string, mixed> $event
     * @return array<string, mixed>
     */
    private function finalizeDone(array $event): array
    {
        /** @var Entity $entity */
        $entity = $event['entity'];
        $type = $entity->getEntityType();
        $own = ['type' => $type, 'id' => $entity->getId()];
        $target = $event['target'];
        $isExchange = in_array($event['kind'], ['call', 'meeting', 'email'], true);
        $person = $isExchange ? $this->findPerson($entity, $target) : null;
        $name = $type === 'Email' ? $entity->get('name') : $this->taskTitle($entity);
        $title = $person['name'] ?? ($isExchange ? ($target['name'] ?? $name) : $name);
        $subtitle = $target['name'] ?? null;

        return [
            'key' => $type . ':' . $entity->getId() . ':done',
            'kind' => $event['kind'],
            'title' => $title,
            'subtitle' => $subtitle !== $title ? $subtitle : null,
            'result' => $event['result'],
            'note' => $event['note'],
            'date' => $event['kind'] === 'added' ? $this->dueDateOf($entity) : null,
            'time' => $this->toLocal($event['time'])->format('H:i'),
            'links' => [
                'title' => $person ? ['type' => $person['type'], 'id' => $person['id']] : $own,
                'subtitle' => $target ? $this->readableLink($target['type'], $target['id']) : null,
                'record' => $own,
            ],
            'followUps' => $event['followUps'],
        ];
    }

    private function prepare(int $staleDays): void
    {
        $this->now = $this->periodResolver->now();
        $this->staleBefore = $this->toUtc($this->today()->modify("-$staleDays days"));
    }

    // -----------------------------------------------------------------------------------------
    // Reading records.
    // -----------------------------------------------------------------------------------------

    private function canRead(string $entityType): bool
    {
        return $this->metadata->get(['scopes', $entityType, 'entity']) &&
            !$this->metadata->get(['scopes', $entityType, 'disabled']) &&
            $this->entityManager->hasRepository($entityType) &&
            $this->acl->checkScope($entityType, Table::ACTION_READ);
    }

    private function canCreate(string $entityType): bool
    {
        return $this->canRead($entityType) && $this->acl->checkScope($entityType, Table::ACTION_CREATE);
    }

    private function hasAttribute(string $entityType, string $attribute): bool
    {
        return $this->entityManager->getDefs()->getEntity($entityType)->hasAttribute($attribute);
    }

    /**
     * Note: the builder carries EspoCRM's default order. Order with an array, which replaces it:
     * `->order([['dateStart', 'ASC']])`. A plain `->order('dateStart')` would only come second.
     */
    private function query(string $entityType, ?string $primaryFilter = null, bool $onlyMine = true): SelectBuilder
    {
        return $this->selectBuilderFactory
            ->create()
            ->from($entityType)
            ->withStrictAccessControl()
            ->withSearchParams(SearchParams::fromRaw([
                'primaryFilter' => $primaryFilter,
                'boolFilterList' => $onlyMine ? ['onlyMy'] : [],
            ]))
            ->buildQueryBuilder();
    }

    /**
     * @return Entity[]
     */
    /**
     * The records a signal ranks: all of them up to a high limit, then the count is flagged.
     *
     * @return Entity[]
     */
    private function fetchCandidates(string $entityType, SelectBuilder $builder): array
    {
        $list = $this->fetch($entityType, $builder, self::CANDIDATE_LIMIT);

        if (count($list) >= self::CANDIDATE_LIMIT) {
            $this->capped = true;
        }

        return $list;
    }

    /**
     * @return Entity[]
     */
    private function fetch(string $entityType, SelectBuilder $builder, int $limit): array
    {
        $collection = $this->entityManager
            ->getRDBRepository($entityType)
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

    private function daysSince(DateTimeImmutable $date): int
    {
        $days = (int) $date->setTime(0, 0)->diff($this->today())->days;

        return $date->setTime(0, 0) > $this->today() ? -$days : $days;
    }

    /**
     * The days offered to postpone: the next working day, next Monday, and in a week.
     *
     * @return string[] Y-m-d, in the user's time zone.
     */
    private function snoozeDates(): array
    {
        $dates = [
            $this->toLocal($this->workdayAt(1))->format('Y-m-d'),
            $this->today()->modify('next monday')->format('Y-m-d'),
            $this->toLocal($this->workdayAt(7))->format('Y-m-d'),
        ];

        $dates = array_values(array_unique($dates));
        sort($dates);

        return $dates;
    }

    /**
     * 9:00 in the user's time zone, in $days days, moved to Monday if that falls on a weekend.
     */
    private function workdayAt(int $days): string
    {
        $date = $this->today()->modify("+$days days")->setTime(9, 0);

        while ((int) $date->format('N') >= 6) {
            $date = $date->modify('+1 day');
        }

        return $this->toUtc($date);
    }

    // -----------------------------------------------------------------------------------------
    // Exchanges and planned next steps.
    // -----------------------------------------------------------------------------------------

    /**
     * @return Entity[]
     */
    private function fetchLeads(): array
    {
        if (!$this->canRead('Lead')) {
            return [];
        }

        $since = $this->today()->modify('-' . self::NEW_LEAD_DAYS . ' days');

        return $this->fetchCandidates('Lead', $this->query('Lead', 'actual')
            ->where(['createdAt>=' => $this->toUtc($since)])
            ->order([['createdAt', 'DESC']]));
    }

    /**
     * @return Entity[]
     */
    private function fetchDeals(): array
    {
        if (!$this->canRead('Opportunity')) {
            return [];
        }

        // Ordering by an amount the user may not read would reveal it.
        $order = $this->canReadAmount() ? 'amount' : 'createdAt';

        return $this->fetchCandidates('Opportunity', $this->query('Opportunity', 'open')->order([[$order, 'DESC']]));
    }

    private function canReadAmount(): bool
    {
        return $this->acl->checkField('Opportunity', 'amount');
    }

    /**
     * A record's name, unless the user's role hides that field.
     */
    private function nameOf(Entity $entity): ?string
    {
        return $this->canReadName($entity->getEntityType()) ? $entity->get('name') : null;
    }

    private function canReadName(string $entityType): bool
    {
        return $this->acl->checkField($entityType, 'name');
    }

    /**
     * @return Entity[]
     */
    private function fetchHeldMeetings(): array
    {
        if (!$this->canRead('Meeting')) {
            return [];
        }

        $since = $this->today()->modify('-' . self::ACTIVITY_WINDOW_DAYS . ' days');

        return $this->fetchCandidates('Meeting', $this->query('Meeting', 'held')
            ->where([
                'dateStart>=' => $this->toUtc($since),
                'dateStart<=' => $this->toUtc($this->now),
                'parentId!=' => null,
            ])
            ->order([['dateStart', 'DESC']]));
    }

    /**
     * Indexes, for the records concerned, the last exchange and whether a next step is planned.
     *
     * @param Entity[] $leads
     * @param Entity[] $deals
     * @param Entity[] $meetings
     */
    private function loadExchanges(array $leads, array $deals, array $meetings): void
    {
        $ids = ['Lead' => [], 'Opportunity' => [], 'Account' => [], 'Contact' => [], 'Case' => []];

        foreach ($leads as $lead) {
            $ids['Lead'][] = $lead->getId();
        }

        foreach ($deals as $deal) {
            $ids['Opportunity'][] = $deal->getId();
            $ids['Account'][] = $deal->get('accountId');
            $ids['Contact'][] = $deal->get('contactId');
        }

        foreach ($meetings as $meeting) {
            $ids[$meeting->get('parentType')][] = $meeting->get('parentId');
        }

        $ids = array_map(fn ($list) => array_values(array_unique(array_filter($list))), $ids);

        $this->loadContactsOfAccounts($ids['Account']);

        $ids['Contact'] = array_values(array_unique([...$ids['Contact'], ...array_merge(...array_values($this->contactsByAccount ?: [[]]))]));

        if (!array_filter($ids)) {
            return;
        }

        $windowStart = $this->toUtc($this->today()->modify('-' . self::ACTIVITY_WINDOW_DAYS . ' days'));
        $now = $this->toUtc($this->now);

        foreach (['Call' => ['Held', 'Not Held'], 'Meeting' => ['Held']] as $entityType => $doneStatusList) {
            if (!$this->canRead($entityType)) {
                continue;
            }

            $this->indexActivities(
                $entityType,
                ['status' => $doneStatusList, 'dateStart<=' => $now],
                $ids,
                fn ($key, $date) => $this->addTouch($key, $date)
            );

            $this->indexActivities(
                $entityType,
                ['status' => 'Planned', 'dateStart>=' => $windowStart],
                $ids,
                function ($key) {
                    $this->planned[$key] = true;
                }
            );
        }

        $this->indexOpenTasks($ids);
        $this->indexEmails($ids);
    }

    /**
     * @param string[] $accountIds
     */
    private function loadContactsOfAccounts(array $accountIds): void
    {
        // Each account once: the last exchange of each deal asks again for its account.
        $accountIds = array_values(array_diff(array_unique($accountIds), array_keys($this->accountsLoaded)));

        if (!$accountIds || !$this->canRead('Contact')) {
            return;
        }

        $this->accountsLoaded += array_fill_keys($accountIds, true);

        $query = $this->query('Contact', null, false)
            ->select(['id', 'accountId'])
            ->order([])
            ->where(['accountId' => $accountIds])
            ->build();

        foreach ($this->entityManager->getQueryExecutor()->execute($query)->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $this->contactsByAccount[$row['accountId']][] = $row['id'];
        }
    }

    private function addTouch(string $key, ?string $date): void
    {
        if ($date && ($date > ($this->lastTouch[$key] ?? ''))) {
            $this->lastTouch[$key] = $date;
        }
    }

    /**
     * A call or meeting counts for its parent, its account, and the people linked to it.
     *
     * @param array<string|int, mixed> $where
     * @param array<string, string[]> $ids
     * @param callable(string, ?string): void $onFound
     */
    private function indexActivities(string $entityType, array $where, array $ids, callable $onFound): void
    {
        $subQuery = $this->query($entityType, null, false)
            ->select(['id'])
            ->order([])
            ->where($where)
            ->build();

        $run = function (array $select, array $condition, array $group, ?string $join, callable $key) use (
            $entityType, $subQuery, $onFound
        ) {
            $builder = $this->entityManager
                ->getQueryBuilder()
                ->select()
                ->from($entityType)
                ->select([...$select, ['MAX:dateStart', 'lastDate']])
                ->where(['id=s' => $subQuery, ...$condition])
                ->group($group);

            if ($join) {
                $builder->join($join);
            }

            foreach ($this->entityManager->getQueryExecutor()->execute($builder->build())->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $onFound($key($row), $row['lastDate']);
            }
        };

        $allIds = array_merge(...array_values($ids));

        if ($allIds) {
            $run(
                [['parentType', 'itemType'], ['parentId', 'itemId']],
                ['parentId' => $allIds],
                ['parentType', 'parentId'],
                null,
                fn ($row) => $row['itemType'] . ':' . $row['itemId']
            );
        }

        if ($ids['Account'] && $this->hasAttribute($entityType, 'accountId')) {
            $run([['accountId', 'itemId']], ['accountId' => $ids['Account']], ['accountId'], null,
                fn ($row) => 'Account:' . $row['itemId']);
        }

        if ($ids['Contact']) {
            $run([['contacts.id', 'itemId']], ['contacts.id' => $ids['Contact']], ['contacts.id'], 'contacts',
                fn ($row) => 'Contact:' . $row['itemId']);
        }

        if ($ids['Lead']) {
            $run([['leads.id', 'itemId']], ['leads.id' => $ids['Lead']], ['leads.id'], 'leads',
                fn ($row) => 'Lead:' . $row['itemId']);
        }
    }

    /**
     * @param array<string, string[]> $ids
     */
    private function indexOpenTasks(array $ids): void
    {
        $allIds = array_merge(...array_values($ids));

        if (!$allIds || !$this->canRead('Task')) {
            return;
        }

        $closed = $this->metadata->get(['entityDefs', 'Task', 'fields', 'status', 'notActualOptions']) ?? [];

        $query = $this->query('Task', null, false)
            ->select(['parentType', 'parentId'])
            ->order([])
            ->where([
                'status!=' => $closed,
                'parentId' => $allIds,
                // An abandoned task is not a next step.
                'OR' => [['dateEnd' => null], ['dateEnd>=' => $this->staleBefore]],
            ])
            ->build();

        foreach ($this->entityManager->getQueryExecutor()->execute($query)->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $this->planned[$row['parentType'] . ':' . $row['parentId']] = true;
        }
    }

    /**
     * @param array<string, string[]> $ids
     */
    private function indexEmails(array $ids): void
    {
        $allIds = array_merge(...array_values($ids));

        if (!$allIds || !$this->canRead('Email')) {
            return;
        }

        $subQuery = $this->query('Email', null, false)
            ->select(['id'])
            ->order([])
            ->where(['status' => ['Sent', 'Archived'], 'parentId' => $allIds])
            ->build();

        $query = $this->entityManager
            ->getQueryBuilder()
            ->select()
            ->from('Email')
            ->select([['parentType', 'itemType'], ['parentId', 'itemId'], ['MAX:dateSent', 'lastDate']])
            ->where(['id=s' => $subQuery])
            ->group(['parentType', 'parentId'])
            ->build();

        foreach ($this->entityManager->getQueryExecutor()->execute($query)->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $this->addTouch($row['itemType'] . ':' . $row['itemId'], $row['lastDate']);
        }
    }

    /**
     * The record, its account and the account's people.
     *
     * @return string[]
     */
    private function relatedKeys(string $type, string $id, ?string $accountId = null, ?string $contactId = null): array
    {
        $keys = ["$type:$id"];

        if ($type === 'Account') {
            $accountId = $id;
        }

        if ($contactId) {
            $keys[] = "Contact:$contactId";
        }

        if ($accountId) {
            $keys[] = "Account:$accountId";

            foreach ($this->contactsByAccount[$accountId] ?? [] as $contact) {
                $keys[] = "Contact:$contact";
            }
        }

        return $keys;
    }

    /**
     * @param string[] $keys
     */
    private function latestTouch(array $keys): ?string
    {
        $dates = array_filter(array_map(fn ($key) => $this->lastTouch[$key] ?? null, $keys));

        return $dates ? max($dates) : null;
    }

    /**
     * @param string[] $keys
     */
    private function hasPlanned(array $keys): bool
    {
        foreach ($keys as $key) {
            if (isset($this->planned[$key])) {
                return true;
            }
        }

        return false;
    }

    // -----------------------------------------------------------------------------------------
    // Situations.
    // -----------------------------------------------------------------------------------------

    /**
     * @return array<int, array<string, mixed>>
     */
    private function taskItems(): array
    {
        if (!$this->canRead('Task')) {
            return [];
        }

        $tasks = [];

        $queries = [
            $this->query('Task', 'overdue')->where(['dateEnd>=' => $this->staleBefore])->order([['dateEnd', 'DESC']]),
            $this->query('Task', 'todays')->order([['dateEnd', 'ASC']]),
        ];

        foreach ($queries as $query) {
            foreach ($this->fetchCandidates('Task', $query) as $task) {
                $tasks[$task->getId()] = $task;
            }
        }

        // The "today" filter also returns tasks that are already done.
        $closed = $this->metadata->get(['entityDefs', 'Task', 'fields', 'status', 'notActualOptions']) ?? [];

        return array_values(array_filter(array_map(fn ($task) => $this->taskItem($task, $closed), $tasks)));
    }

    private function staleTaskQuery(): SelectBuilder
    {
        return $this->query('Task', 'overdue')->where([
            'dateEnd<' => $this->staleBefore,
            'status!=' => 'Deferred',
        ]);
    }

    private function countStaleTasks(): int
    {
        if (!$this->canRead('Task')) {
            return 0;
        }

        return $this->entityManager
            ->getRDBRepository('Task')
            ->clone($this->staleTaskQuery()->build())
            ->count();
    }

    /**
     * @param string[] $closed
     * @return ?array<string, mixed>
     */
    private function taskItem(Entity $task, array $closed): ?array
    {
        if (in_array($task->get('status'), $closed, true)) {
            return null;
        }

        $dateEnd = $task->get('dateEnd');
        $allDay = $task->get('dateEndDate');
        $end = $allDay ?
            new DateTimeImmutable($allDay . ' 23:59:59', $this->now->getTimezone()) :
            ($dateEnd ? $this->toLocal($dateEnd) : null);

        if (!$end) {
            return null;
        }

        $late = $end < $this->now;
        $days = max(0, $this->daysSince($end));
        $bonus = self::PRIORITY_BONUS[$task->get('priority')] ?? 0;

        return [
            'kind' => 'task',
            'entity' => $task,
            'title' => $this->taskTitle($task),
            'subtitle' => $this->parentOf($task)['name'] ?? null,
            'reason' => $late ?
                ['code' => $days === 0 ? 'taskOverdueToday' : 'taskOverdue', 'count' => $days] :
                ['code' => $allDay ? 'taskToday' : 'taskTodayAt', 'time' => $end->format('H:i')],
            'urgent' => $late,
            'primaryAction' => 'complete',
            'target' => $this->parentOf($task),
            'score' => ($late ? 75 - min(20, $days) / 2 : 70) + $bonus,
            'snooze' => $this->acl->checkEntityEdit($task) ? [
                'method' => 'PUT',
                'url' => 'Task/' . $task->getId(),
                'schedule' => ['allDay' => (bool) $allDay, 'time' => self::WORKDAY_START, 'duration' => 0],
            ] : null,
        ];
    }

    /**
     * Demo and imported tasks are often called "Do something — Company": no need to say it twice.
     */
    private function taskTitle(Entity $entity): string
    {
        $name = (string) $entity->get('name');
        $parent = (string) $entity->get('parentName');
        $suffix = ' — ' . $parent;

        return $parent && str_ends_with($name, $suffix) ? substr($name, 0, -strlen($suffix)) : $name;
    }

    /**
     * Planned calls and meetings of today, and those of the last days that were never closed.
     *
     * @return array<int, array<string, mixed>>
     */
    private function activityItems(): array
    {
        $items = [];
        $from = $this->today()->modify('-' . self::ACTIVITY_WINDOW_DAYS . ' days');
        $to = $this->today()->modify('+1 day');

        foreach (['Call' => 'call', 'Meeting' => 'meeting'] as $entityType => $kind) {
            if (!$this->canRead($entityType)) {
                continue;
            }

            $list = $this->fetchCandidates($entityType, $this->query($entityType)
                ->where([
                    'status' => 'Planned',
                    'dateStart>=' => $this->toUtc($from),
                    'dateStart<' => $this->toUtc($to),
                ])
                ->order([['dateStart', 'ASC']]));

            foreach ($list as $activity) {
                $start = $this->toLocal($activity->get('dateStart'));
                $past = $start < $this->now;
                $days = $this->daysSince($start);
                $hours = ($start->getTimestamp() - $this->now->getTimestamp()) / 3600;

                $items[] = [
                    'kind' => $kind,
                    'entity' => $activity,
                    'title' => null,
                    'subtitle' => $this->parentOf($activity)['name'] ?? null,
                    'reason' => [
                        'code' => !$past ? 'activityToday' : ($days === 0 ? 'activityLate' : 'activityMissed'),
                        'time' => $start->format('H:i'),
                        'date' => $start->format('Y-m-d'),
                        'label' => $this->taskTitle($activity),
                    ],
                    'urgent' => $past,
                    'primaryAction' => $kind === 'call' ? 'call' : ($past ? 'close' : 'open'),
                    'target' => $this->parentOf($activity),
                    'score' => $past ? 100 - min(10, $days) : 90 - min(30, max(0, $hours) * 2),
                    'snooze' => $this->acl->checkEntityEdit($activity) ? $this->snoozeActivity($activity, $start) : null,
                ];
            }
        }

        return $items;
    }

    /**
     * @return array<string, mixed>
     */
    private function snoozeActivity(Entity $activity, DateTimeImmutable $start): array
    {
        $end = $activity->get('dateEnd') ? $this->toLocal($activity->get('dateEnd')) : $start;
        $startDate = $activity->hasAttribute('dateStartDate') ? $activity->get('dateStartDate') : null;
        $endDate = $activity->hasAttribute('dateEndDate') ? $activity->get('dateEndDate') : null;

        return [
            'method' => 'PUT',
            'url' => $activity->getEntityType() . '/' . $activity->getId(),
            'schedule' => [
                'allDay' => (bool) $startDate,
                'time' => $start->format('H:i'),
                'duration' => max(0, $end->getTimestamp() - $start->getTimestamp()),
                // An all-day meeting over several days keeps its length.
                'days' => $startDate && $endDate ?
                    max(0, (int) (new DateTimeImmutable($startDate))->diff(new DateTimeImmutable($endDate))->days) :
                    0,
            ],
        ];
    }

    /**
     * @param Entity[] $leads
     * @return array<int, array<string, mixed>>
     */
    private function leadItems(array $leads): array
    {
        $items = [];

        foreach ($leads as $lead) {
            $keys = ['Lead:' . $lead->getId()];

            if ($this->latestTouch($keys) || $this->hasPlanned($keys)) {
                continue;
            }

            $days = max(0, $this->daysSince($this->toLocal($lead->get('createdAt'))));

            $items[] = [
                'kind' => 'lead',
                'entity' => $lead,
                'title' => $this->nameOf($lead),
                'subtitle' => $this->acl->checkField('Lead', 'accountName') ? $lead->get('accountName') : null,
                'reason' => ['code' => 'leadNew', 'count' => $days],
                'urgent' => false,
                'primaryAction' => 'call',
                'target' => ['type' => 'Lead', 'id' => $lead->getId(), 'name' => $this->nameOf($lead)],
                'score' => 85 - min(30, $days * 3),
                'snooze' => $this->followUpTask('Lead', $lead->getId()),
            ];
        }

        return $items;
    }

    /**
     * Open deals without a recent exchange nor a next step.
     *
     * @param Entity[] $deals
     * @return array<int, array<string, mixed>>
     */
    private function dealItems(array $deals, int $dormantDays): array
    {
        $items = [];
        $withAmount = $this->canReadAmount();
        $maxAmount = max(1.0, ...array_map(fn ($deal) => (float) $deal->get('amountConverted'), $deals ?: []) ?: [1.0]);

        foreach ($deals as $deal) {
            $keys = $this->relatedKeys('Opportunity', $deal->getId(), $deal->get('accountId'), $deal->get('contactId'));

            if ($this->hasPlanned($keys)) {
                continue;
            }

            $touch = $this->latestTouch($keys);
            $days = $this->daysSince($this->toLocal($touch ?? $deal->get('createdAt')));

            if ($days < $dormantDays) {
                continue;
            }

            $amount = $withAmount ? (float) $deal->get('amountConverted') : null;
            $reason = ['code' => $touch ? 'dealDormant' : 'dealNoExchange', 'count' => $days];

            if ($amount !== null) {
                $reason['amount'] = $amount;
            } else {
                $reason['code'] .= 'NoAmount';
            }

            $items[] = [
                'kind' => 'deal',
                'entity' => $deal,
                'title' => null,
                'subtitle' => ($this->canReadName('Account') ? $deal->get('accountName') : null) ?: $this->nameOf($deal),
                'reason' => $reason,
                'urgent' => false,
                'primaryAction' => 'call',
                'target' => ['type' => 'Opportunity', 'id' => $deal->getId(), 'name' => $this->nameOf($deal)],
                'score' => 60 + ($amount === null ? 7.5 : 15 * $amount / $maxAmount) + min(10, ($days - $dormantDays) / 3),
                'snooze' => $this->followUpTask('Opportunity', $deal->getId()),
                'touch' => ['keys' => $keys, 'date' => $touch],
            ];
        }

        return $items;
    }

    /**
     * The last exchange of each deal shown, read at once: the index already gave its date, so only
     * the calls, meetings and emails of those dates, linked to those records, are looked for.
     *
     * @param array<int, array<string, mixed>> $items
     */
    private function loadDealExchanges(array $items): void
    {
        $wanted = array_filter($items, fn ($item) => $item['kind'] === 'deal' && $item['touch']['date']);

        if (!$wanted) {
            return;
        }

        $dates = array_values(array_unique(array_map(fn ($item) => $item['touch']['date'], $wanted)));
        $ids = [];

        foreach ($wanted as $item) {
            foreach ($item['touch']['keys'] as $key) {
                [$type, $id] = explode(':', $key, 2);
                $ids[$type][] = $id;
            }
        }

        $ids = array_map(fn ($list) => array_values(array_unique($list)), $ids);

        /** @var array<string, array{string, string}> $found Entity type and id by "key|date". */
        $found = [];

        foreach (['Call' => ['Held', 'Not Held'], 'Meeting' => ['Held']] as $type => $statusList) {
            if ($this->canRead($type)) {
                $this->indexExchanges($type, 'dateStart', ['status' => $statusList, 'dateStart' => $dates], $ids, $found);
            }
        }

        if ($this->canRead('Email')) {
            $this->indexExchanges('Email', 'dateSent', ['status' => ['Sent', 'Archived'], 'dateSent' => $dates], $ids, $found);
        }

        $chosen = [];
        $idsByType = [];

        foreach ($wanted as $item) {
            foreach ($item['touch']['keys'] as $key) {
                $exchange = $found[$key . '|' . $item['touch']['date']] ?? null;

                if ($exchange) {
                    $chosen[$item['entity']->getId()] = [...$exchange, $item['touch']['date']];
                    $idsByType[$exchange[0]][] = $exchange[1];

                    break;
                }
            }
        }

        $entities = [];

        foreach ($idsByType as $type => $list) {
            $list = array_values(array_unique($list));

            foreach ($this->fetch($type, $this->query($type, null, false)->where(['id' => $list]), count($list)) as $entity) {
                $entities[$type . ':' . $entity->getId()] = $entity;
            }
        }

        foreach ($chosen as $dealId => [$type, $id, $date]) {
            if (isset($entities[$type . ':' . $id])) {
                $this->dealExchanges[$dealId] = $this->describeExchange($entities[$type . ':' . $id], $date);
            }
        }
    }

    /**
     * Which call, meeting or email of those dates belongs to which record, as the index counts
     * them: one row per record and date, so that no record is left out, however many there are.
     * Emails count for their parent only.
     *
     * @param array<string|int, mixed> $where
     * @param array<string, string[]> $ids
     * @param array<string, array{string, string}> $found
     */
    private function indexExchanges(string $entityType, string $dateField, array $where, array $ids, array &$found): void
    {
        $subQuery = $this->query($entityType, null, false)
            ->select(['id'])
            ->order([])
            ->where($where)
            ->build();

        $run = function (array $select, array $condition, array $group, ?string $join, callable $key) use (
            $entityType, $dateField, $subQuery, &$found
        ): void {
            $builder = $this->entityManager
                ->getQueryBuilder()
                ->select()
                ->from($entityType)
                ->select([...$select, [$dateField, 'itemDate'], ['MIN:id', 'exchangeId']])
                ->where(['id=s' => $subQuery, ...$condition])
                ->group([...$group, $dateField]);

            if ($join) {
                $builder->join($join);
            }

            foreach ($this->entityManager->getQueryExecutor()->execute($builder->build())->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $found[$key($row) . '|' . $row['itemDate']] ??= [$entityType, $row['exchangeId']];
            }
        };

        $run(
            [['parentType', 'itemType'], ['parentId', 'itemId']],
            ['parentId' => array_merge(...array_values($ids))],
            ['parentType', 'parentId'],
            null,
            fn ($row) => $row['itemType'] . ':' . $row['itemId']
        );

        if ($entityType === 'Email') {
            return;
        }

        if (!empty($ids['Account']) && $this->hasAttribute($entityType, 'accountId')) {
            $run([['accountId', 'itemId']], ['accountId' => $ids['Account']], ['accountId'], null,
                fn ($row) => 'Account:' . $row['itemId']);
        }

        foreach (['Contact' => 'contacts', 'Lead' => 'leads'] as $personType => $link) {
            if (!empty($ids[$personType])) {
                $run([[$link . '.id', 'itemId']], [$link . '.id' => $ids[$personType]], [$link . '.id'], $link,
                    fn ($row) => $personType . ':' . $row['itemId']);
            }
        }
    }

    /**
     * Meetings held recently with nothing after them.
     *
     * @param Entity[] $meetings
     * @return array<int, array<string, mixed>>
     */
    private function followUpItems(array $meetings): array
    {
        $items = [];

        foreach ($meetings as $meeting) {
            $type = $meeting->get('parentType');
            $id = $meeting->get('parentId');
            $keys = $this->relatedKeys($type, $id);
            $start = $meeting->get('dateStart');
            $touch = $this->latestTouch($keys);

            if ($this->hasPlanned($keys) || ($touch && $touch > $start)) {
                continue;
            }

            $date = $this->toLocal($start);

            $items[] = [
                'kind' => 'followUp',
                'entity' => $meeting,
                'title' => null,
                'subtitle' => $this->parentOf($meeting)['name'] ?? null,
                'reason' => ['code' => 'followUp', 'date' => $date->format('Y-m-d'), 'label' => $this->taskTitle($meeting)],
                'urgent' => false,
                'primaryAction' => 'followUp',
                'target' => $this->parentOf($meeting),
                'score' => 65 - 2 * max(0, $this->daysSince($date)),
                'snooze' => $this->followUpTask($type, $id),
            ];
        }

        return $items;
    }

    /**
     * Postponing a record that has no date means planning a task for the next working day: it
     * leaves the list, and the task brings it back when it is due.
     *
     * @return ?array<string, mixed>
     */
    private function followUpTask(string $parentType, string $parentId): ?array
    {
        if (!$this->canCreate('Task')) {
            return null;
        }

        return [
            'method' => 'POST',
            'url' => 'Task',
            'data' => [
                'status' => 'Not Started',
                'priority' => 'Normal',
                'parentType' => $parentType,
                'parentId' => $parentId,
                'assignedUserId' => $this->user->getId(),
            ],
            'schedule' => ['allDay' => false, 'time' => self::WORKDAY_START, 'duration' => 0],
        ];
    }

    /**
     * @return ?array{type: string, id: string, name: ?string}
     */
    private function parentOf(Entity $entity): ?array
    {
        $type = $entity->get('parentType');
        $id = $entity->get('parentId');

        if (!$type || !$id) {
            return null;
        }

        // The parent may be a person whose name the user's role hides.
        return ['type' => $type, 'id' => $id, 'name' => $this->canReadName($type) ? $entity->get('parentName') : null];
    }

    // -----------------------------------------------------------------------------------------
    // Output.
    // -----------------------------------------------------------------------------------------

    /**
     * @param array<string, mixed> $item
     * @return array<string, mixed>
     */
    private function finalize(array $item): array
    {
        /** @var Entity $entity */
        $entity = $item['entity'];
        $person = $this->findPerson($entity, $item['target']);
        $links = $this->findLinks($item, $person);

        return [
            'key' => $entity->getEntityType() . ':' . $entity->getId() . ':' . $item['kind'],
            'kind' => $item['kind'],
            'entityType' => $entity->getEntityType(),
            'id' => $entity->getId(),
            'title' => $item['title'] ?? $person['name'] ?? $item['subtitle'] ?? $this->nameOf($entity),
            'subtitle' => ($item['subtitle'] ?? null) !== ($item['title'] ?? $person['name'] ?? null) ?
                $item['subtitle'] : null,
            'reason' => $item['reason'],
            'urgent' => $item['urgent'],
            'primaryAction' => $item['primaryAction'],
            'canEdit' => $this->acl->checkEntityEdit($entity),
            'target' => $item['target'],
            'person' => $person,
            'snooze' => $item['snooze'],
            'restore' => $this->restoreData($entity),
            'context' => $this->findContext($item),
            'links' => $links,
        ];
    }

    /**
     * Why act: the task's details, the agenda of a call or a meeting, what a lead asked for,
     * what was said at a meeting, or, for a deal, the note of the last exchange. Read only
     * through fields the user may read.
     *
     * @param array<string, mixed> $item
     * @return ?array{text: string, exchange: ?array{kind: string, date: string}}
     */
    private function findContext(array $item): ?array
    {
        /** @var Entity $entity */
        $entity = $item['entity'];

        if ($item['kind'] === 'deal') {
            $exchange = $this->dealExchanges[$entity->getId()] ?? null;

            if ($exchange && $exchange['note'] !== '') {
                return [
                    'text' => $exchange['note'],
                    'exchange' => ['kind' => $exchange['kind'], 'date' => $exchange['date']],
                ];
            }
        }

        $text = $this->noteOf($entity, 160);

        return $text !== '' ? ['text' => $text, 'exchange' => null] : null;
    }

    /**
     * What puts a task, call or meeting back as it is now, for "Undo".
     *
     * @return ?array{url: string, data: array<string, mixed>}
     */
    private function restoreData(Entity $entity): ?array
    {
        $type = $entity->getEntityType();

        if (!in_array($type, ['Task', 'Call', 'Meeting'], true) || !$this->acl->checkEntityEdit($entity)) {
            return null;
        }

        $data = ['status' => $entity->get('status')];

        foreach (['dateStart', 'dateEnd'] as $field) {
            if (!$entity->hasAttribute($field)) {
                continue;
            }

            $dateOnly = $entity->hasAttribute($field . 'Date') ? $entity->get($field . 'Date') : null;

            if ($dateOnly) {
                $data[$field . 'Date'] = $dateOnly;
            } elseif ($entity->get($field)) {
                $data[$field] = $entity->get($field);
            }
        }

        return ['url' => "$type/" . $entity->getId(), 'data' => $data];
    }

    /**
     * What the texts of a row open: only records the user may read.
     *
     * @param array<string, mixed> $item
     * @param ?array<string, ?string> $person
     * @return array{title: ?array<string, string>, subtitle: ?array<string, string>, reason: ?array<string, string>}
     */
    private function findLinks(array $item, ?array $person): array
    {
        /** @var Entity $entity */
        $entity = $item['entity'];
        $own = ['type' => $entity->getEntityType(), 'id' => $entity->getId()];
        $target = $item['target'];

        $subtitle = match ($item['kind']) {
            'deal' => $this->readableLink('Account', $entity->get('accountId')),
            'lead' => null,
            default => $target ? $this->readableLink($target['type'], $target['id']) : null,
        };

        $title = $item['title'] !== null ?
            $own :
            ($person ? ['type' => $person['type'], 'id' => $person['id']] : ($subtitle ?? $own));

        return [
            'title' => $title,
            'subtitle' => $subtitle,
            'reason' => in_array($item['kind'], ['call', 'meeting', 'followUp', 'deal'], true) ? $own : null,
        ];
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

    /**
     * Who to reach for this item, with the coordinates the user is allowed to see.
     *
     * @param ?array{type: string, id: string, name: ?string} $target
     * @return ?array<string, ?string>
     */
    private function findPerson(Entity $entity, ?array $target): ?array
    {
        if (in_array($entity->getEntityType(), ['Lead', 'Contact'], true)) {
            return $this->describePerson($entity);
        }

        // The person a call or a meeting is with, rather than any contact of its account.
        if (
            in_array($entity->getEntityType(), ['Call', 'Meeting'], true) &&
            !in_array($target['type'] ?? null, ['Lead', 'Contact'], true)
        ) {
            $participant = $this->findParticipant($entity, $target);

            if ($participant) {
                return $this->describePerson($participant);
            }
        }

        $source = $target && $target['type'] !== $entity->getEntityType() && $this->canRead($target['type']) ?
            $this->entityManager->getEntityById($target['type'], $target['id']) :
            $entity;

        if (!$source || !$this->acl->checkEntityRead($source)) {
            return null;
        }

        if (in_array($source->getEntityType(), ['Lead', 'Contact'], true)) {
            return $this->describePerson($source);
        }

        $contactId = $source->hasAttribute('contactId') ? $source->get('contactId') : null;
        $accountId = $source->getEntityType() === 'Account' ?
            $source->getId() :
            ($source->hasAttribute('accountId') ? $source->get('accountId') : null);

        if (!$contactId && $accountId && $this->canRead('Contact')) {
            $contact = $this->fetch('Contact', $this->query('Contact', null, false)
                ->where(['accountId' => $accountId])
                ->order([['createdAt', 'ASC']]), 1)[0] ?? null;

            if ($contact) {
                return $this->describePerson($contact);
            }
        }

        if ($contactId && $this->canRead('Contact')) {
            $contact = $this->entityManager->getEntityById('Contact', $contactId);

            if ($contact && $this->acl->checkEntityRead($contact)) {
                return $this->describePerson($contact);
            }
        }

        if ($accountId && $this->canRead('Account')) {
            $account = $this->entityManager->getEntityById('Account', $accountId);

            if ($account && $this->acl->checkEntityRead($account)) {
                return $this->describePerson($account);
            }
        }

        return null;
    }

    /**
     * A readable contact or lead linked to the activity, from its account first.
     *
     * @param ?array{type: string, id: string, name: ?string} $target
     */
    private function findParticipant(Entity $activity, ?array $target): ?Entity
    {
        $accountId = ($target['type'] ?? null) === 'Account' ? $target['id'] : null;
        $other = null;

        foreach (['contacts' => 'Contact', 'leads' => 'Lead'] as $link => $type) {
            if (!$activity->hasRelation($link) || !$this->canRead($type)) {
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

                $isOfAccount = $accountId && $person->hasAttribute('accountId') && $person->get('accountId') === $accountId;

                if (!$accountId || $isOfAccount) {
                    return $person;
                }

                $other ??= $person;
            }
        }

        return $other;
    }

    /**
     * @return array<string, ?string>
     */
    private function describePerson(Entity $entity): array
    {
        $type = $entity->getEntityType();

        return [
            'type' => $type,
            'id' => $entity->getId(),
            'name' => $this->nameOf($entity),
            'phone' => $this->acl->checkField($type, 'phoneNumber') ? $entity->get('phoneNumber') : null,
            'email' => $this->acl->checkField($type, 'emailAddress') ? $entity->get('emailAddress') : null,
        ];
    }

    /**
     * What comes next when the list is empty.
     *
     * @return ?array{date: string, time: string}
     */
    private function findNextPlanned(): ?array
    {
        $dates = [];
        $now = $this->toUtc($this->now);

        foreach (['Call', 'Meeting'] as $entityType) {
            if ($this->canRead($entityType)) {
                $row = $this->fetch($entityType, $this->query($entityType)
                    ->where(['status' => 'Planned', 'dateStart>' => $now])
                    ->order([['dateStart', 'ASC']]), 1)[0] ?? null;

                if ($row) {
                    $dates[] = $row->get('dateStart');
                }
            }
        }

        if ($this->canRead('Task')) {
            $row = $this->fetch('Task', $this->query('Task', 'actual')
                ->where(['dateEnd>' => $now])
                ->order([['dateEnd', 'ASC']]), 1)[0] ?? null;

            if ($row) {
                $dates[] = $row->get('dateEnd');
            }
        }

        if (!$dates) {
            return null;
        }

        $next = $this->toLocal(min($dates));

        return ['date' => $next->format('Y-m-d'), 'time' => $next->format('H:i')];
    }
}
