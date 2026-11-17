<?php

namespace Espo\Modules\LiveDashlets\Tools;

use DateTimeImmutable;
use DateTimeZone;
use Espo\Core\Acl;
use Espo\Core\Acl\Table;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\Select\SearchParams;
use Espo\Core\Select\SelectBuilderFactory;
use Espo\Core\Utils\Config;
use Espo\Core\Utils\Metadata;
use Espo\ORM\EntityManager;
use Espo\ORM\Query\Select;
use PDO;

/**
 * Computes the figure shown by a dashlet.
 *
 * Every read goes through the current user's access rights: the entity type and each field used
 * must be readable, and the records are selected with EspoCRM's strict access control (same
 * filtering as list views), so two users can get different figures for the same dashlet.
 */
class MetricService
{
    public const METRIC_COUNT = 'count';
    public const METRIC_SUM = 'sum';
    public const METRIC_AVG = 'avg';

    private const METRIC_LIST = [self::METRIC_COUNT, self::METRIC_SUM, self::METRIC_AVG];

    private const VALUE_FIELD_TYPE_LIST = ['int', 'float', 'currency'];
    private const DATE_FIELD_TYPE_LIST = ['date', 'datetime', 'datetimeOptional'];

    private const NAME_PATTERN = '/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/';

    public function __construct(
        private Acl $acl,
        private Metadata $metadata,
        private Config $config,
        private EntityManager $entityManager,
        private SelectBuilderFactory $selectBuilderFactory,
        private PeriodResolver $periodResolver,
    ) {}

    /**
     * @param string[] $boolFilterList
     * @return array<string, mixed>
     * @throws BadRequest
     * @throws Forbidden
     */
    public function get(
        string $entityType,
        string $metric,
        ?string $valueField,
        ?string $primaryFilter,
        array $boolFilterList,
        ?string $dateField,
        string $period,
        string $comparison,
        bool $withSeries = false,
    ): array {

        $this->checkEntityType($entityType);

        if (!in_array($metric, self::METRIC_LIST, true)) {
            throw new BadRequest("Unknown metric.");
        }

        if (!in_array($period, PeriodResolver::PERIOD_LIST, true)) {
            throw new BadRequest("Unknown period.");
        }

        if (!in_array($comparison, PeriodResolver::COMPARISON_LIST, true)) {
            throw new BadRequest("Unknown comparison.");
        }

        $valueType = 'int';
        $expression = 'COUNT:id';
        $currency = null;

        if ($metric !== self::METRIC_COUNT) {
            if (!$valueField) {
                throw new BadRequest("No value field.");
            }

            $valueType = $this->checkField($entityType, $valueField, self::VALUE_FIELD_TYPE_LIST);
            $attribute = $this->getValueAttribute($entityType, $valueField, $valueType);

            if ($valueType === 'currency') {
                $currency = $attribute === $valueField ? null : $this->config->get('defaultCurrency');
            }

            $expression = ($metric === self::METRIC_SUM ? 'SUM:' : 'AVG:') . $attribute;

            if ($metric === self::METRIC_AVG && $valueType === 'int') {
                $valueType = 'float';
            }
        }

        $dateType = null;

        if ($period !== PeriodResolver::EVER) {
            if (!$dateField) {
                throw new BadRequest("No date field.");
            }

            $dateType = $this->checkField($entityType, $dateField, self::DATE_FIELD_TYPE_LIST);
            $this->checkStorable($entityType, $dateField);
        }

        $searchParams = SearchParams::fromRaw([
            'primaryFilter' => $primaryFilter && $primaryFilter !== 'all' ? $primaryFilter : null,
            'boolFilterList' => array_values(array_filter($boolFilterList, 'is_string')),
        ]);

        $now = $this->periodResolver->now();
        $current = $this->periodResolver->resolve($period, $now);
        $previous = $current ?
            $this->periodResolver->resolvePrevious($period, $current, $now, $comparison) :
            null;

        $value = $this->compute($entityType, $searchParams, $expression, $dateField, $dateType, $current);
        $previousValue = $previous ?
            $this->compute($entityType, $searchParams, $expression, $dateField, $dateType, $previous) :
            null;

        if ($metric === self::METRIC_SUM) {
            $value ??= 0.0;
            $previousValue = $previous ? ($previousValue ?? 0.0) : null;
        }

        $isRolling = $this->periodResolver->isRolling($period);

        $series = $withSeries && $current && $dateField && $dateType && $metric !== self::METRIC_AVG ?
            $this->computeSeries(
                $entityType,
                $searchParams,
                $expression,
                $dateField,
                $dateType,
                $period,
                $current,
                $previous ? $this->periodResolver->resolvePrevious(
                    $period,
                    $current,
                    $now,
                    PeriodResolver::COMPARISON_FULL
                ) : null,
                $now
            ) :
            null;

        return [
            'value' => $value,
            'previousValue' => $previousValue,
            'valueType' => $valueType,
            'currency' => $currency,
            'period' => $current ? [
                ...$current->toArray(),
                'progress' => $isRolling ? null : $current->getProgress($now),
                'daysLeft' => $isRolling ? null : $current->getDaysLeft($now),
            ] : null,
            'previousPeriod' => $previous?->toArray(),
            'series' => $series,
        ];
    }

    /**
     * @throws BadRequest
     * @throws Forbidden
     */
    private function checkEntityType(string $entityType): void
    {
        if (
            !preg_match(self::NAME_PATTERN, $entityType) ||
            !$this->metadata->get(['scopes', $entityType, 'entity']) ||
            !$this->metadata->get(['scopes', $entityType, 'object']) ||
            $this->metadata->get(['scopes', $entityType, 'disabled']) ||
            !$this->entityManager->getDefs()->hasEntity($entityType)
        ) {
            throw new BadRequest("Unknown entity type.");
        }

        if (!$this->acl->checkScope($entityType, Table::ACTION_READ)) {
            throw new Forbidden("No read access to '$entityType'.");
        }
    }

    /**
     * @param string[] $typeList
     * @return string The field type.
     * @throws BadRequest
     * @throws Forbidden
     */
    private function checkField(string $entityType, string $field, array $typeList): string
    {
        if (!preg_match(self::NAME_PATTERN, $field)) {
            throw new BadRequest("Bad field name.");
        }

        $defs = $this->metadata->get(['entityDefs', $entityType, 'fields', $field]);
        $type = is_array($defs) ? ($defs['type'] ?? null) : null;

        if (
            !in_array($type, $typeList, true) ||
            !empty($defs['disabled']) ||
            !empty($defs['utility'])
        ) {
            throw new BadRequest("Field '$field' can't be used.");
        }

        if (!$this->acl->checkField($entityType, $field, Table::ACTION_READ)) {
            throw new Forbidden("No read access to field '$field'.");
        }

        return $type;
    }

    /**
     * Currency amounts are added up in the default currency, like EspoCRM's own charts.
     *
     * @throws BadRequest
     */
    private function getValueAttribute(string $entityType, string $field, string $type): string
    {
        $entityDefs = $this->entityManager->getDefs()->getEntity($entityType);

        if ($type === 'currency' && $entityDefs->hasAttribute($field . 'Converted')) {
            return $field . 'Converted';
        }

        $this->checkStorable($entityType, $field);

        return $field;
    }

    /**
     * A non-stored attribute can be aggregated only when it has an SQL expression.
     *
     * @throws BadRequest
     */
    private function checkStorable(string $entityType, string $attribute): void
    {
        $entityDefs = $this->entityManager->getDefs()->getEntity($entityType);

        if (!$entityDefs->hasAttribute($attribute)) {
            throw new BadRequest("Field '$attribute' can't be used.");
        }

        $attributeDefs = $entityDefs->getAttribute($attribute);

        if ($attributeDefs->isNotStorable() && !$attributeDefs->getParam('select')) {
            throw new BadRequest("Field '$attribute' can't be used.");
        }
    }

    /**
     * The records are first selected with access control and filters (ids only), then
     * aggregated: joins added by the filters can't count a record twice.
     *
     * @throws BadRequest
     * @throws Forbidden
     */
    private function compute(
        string $entityType,
        SearchParams $searchParams,
        string $expression,
        ?string $dateField,
        ?string $dateType,
        ?Period $period,
    ): int|float|null {

        $query = $this->entityManager
            ->getQueryBuilder()
            ->select()
            ->from($entityType)
            ->select([[$expression, 'value']])
            ->where(['id=s' => $this->buildIdQuery($entityType, $searchParams, $dateField, $dateType, $period)])
            ->build();

        $value = $this->fetchValue($query);

        if ($value === null) {
            return null;
        }

        return $expression === 'COUNT:id' ? (int) $value : (float) $value;
    }

    /**
     * Ids of the records the user can read, with the dashlet's filters, dated in the period.
     *
     * @throws BadRequest
     * @throws Forbidden
     */
    private function buildIdQuery(
        string $entityType,
        SearchParams $searchParams,
        ?string $dateField,
        ?string $dateType,
        ?Period $period,
    ): Select {

        $builder = $this->selectBuilderFactory
            ->create()
            ->from($entityType)
            ->withStrictAccessControl()
            ->withSearchParams($searchParams)
            ->buildQueryBuilder()
            ->select(['id'])
            ->order([]);

        if ($period && $dateField && $dateType) {
            $builder->where($this->buildDateWhere($dateField, $dateType, $period));
        }

        return $builder->build();
    }

    /**
     * Cumulative values, day by day (hour by hour for "today"), for the sparkline: the current
     * period up to now, and the whole previous period when there is a comparison.
     *
     * @return array{unit: string, length: int, current: float[], previous: ?float[]}
     * @throws BadRequest
     * @throws Forbidden
     */
    private function computeSeries(
        string $entityType,
        SearchParams $searchParams,
        string $expression,
        string $dateField,
        string $dateType,
        string $period,
        Period $current,
        ?Period $previous,
        DateTimeImmutable $now,
    ): array {

        $byHour = $period === 'today' && $dateType !== 'date';

        $range = new Period($previous->start ?? $current->start, $current->end);

        $offset = $now->getOffset() / 3600;
        $dateExpression = match ($dateType) {
            'date' => $dateField,
            'datetimeOptional' => "COALESCE:({$dateField}Date, DATE:(TZ:($dateField, $offset)))",
            default => "DATE:(TZ:($dateField, $offset))",
        };

        $select = [[$dateExpression, 'day'], [$expression, 'value']];
        $group = [$dateExpression];

        if ($byHour) {
            $hourExpression = "HOUR_NUMBER:(TZ:($dateField, $offset))";
            $select[] = [$hourExpression, 'hour'];
            $group[] = $hourExpression;
        }

        $query = $this->entityManager
            ->getQueryBuilder()
            ->select()
            ->from($entityType)
            ->select($select)
            ->where(['id=s' => $this->buildIdQuery($entityType, $searchParams, $dateField, $dateType, $range)])
            ->group($group)
            ->build();

        $rows = $this->entityManager->getQueryExecutor()->execute($query)->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $length = $this->countSteps($current->start, $current->end, $byHour);
        $nowIndex = min($length - 1, $this->countSteps($current->start, $now, $byHour));

        $currentBuckets = array_fill(0, $length, 0.0);
        $previousBuckets = $previous ?
            array_fill(0, max(1, $this->countSteps($previous->start, $previous->end, $byHour)), 0.0) :
            null;

        $timeZone = $now->getTimezone();

        foreach ($rows as $row) {
            if (!$row['day']) {
                continue;
            }

            $time = new DateTimeImmutable(substr((string) $row['day'], 0, 10), $timeZone);

            if ($byHour) {
                $time = $time->setTime((int) ($row['hour'] ?? 0), 0);
            }

            $value = (float) $row['value'];

            if ($time >= $current->start) {
                // Records dated later in the period are added to the last point.
                $index = min($nowIndex, $this->countSteps($current->start, $time, $byHour));
                $currentBuckets[$index] += $value;

                continue;
            }

            if ($previous && $previousBuckets !== null && $time >= $previous->start) {
                $index = min(count($previousBuckets) - 1, $this->countSteps($previous->start, $time, $byHour));
                $previousBuckets[$index] += $value;
            }
        }

        return [
            'unit' => $byHour ? 'hour' : 'day',
            'length' => max($length, $previousBuckets ? count($previousBuckets) : 0),
            'current' => $this->accumulate(array_slice($currentBuckets, 0, $nowIndex + 1)),
            'previous' => $previousBuckets !== null ? $this->accumulate($previousBuckets) : null,
        ];
    }

    /**
     * Whole days (or hours) from `$start` to `$time`, in the user's calendar.
     */
    private function countSteps(DateTimeImmutable $start, DateTimeImmutable $time, bool $byHour): int
    {
        if ($time <= $start) {
            return 0;
        }

        $diff = $start->diff($time);

        if ($byHour) {
            return $diff->days * 24 + $diff->h;
        }

        return (int) $diff->days;
    }

    /**
     * @param float[] $values
     * @return float[]
     */
    private function accumulate(array $values): array
    {
        $total = 0.0;
        $output = [];

        foreach ($values as $value) {
            $total += $value;
            $output[] = round($total, 2);
        }

        return $output;
    }

    private function fetchValue(Select $query): mixed
    {
        $row = $this->entityManager
            ->getQueryExecutor()
            ->execute($query)
            ->fetch(PDO::FETCH_ASSOC);

        return is_array($row) ? ($row['value'] ?? null) : null;
    }

    /**
     * @return array<string|int, mixed>
     */
    private function buildDateWhere(string $field, string $type, Period $period): array
    {
        $dateWhere = fn (string $attribute) => [
            $attribute . '>=' => $period->start->format('Y-m-d'),
            $attribute . '<' => $this->getExclusiveEndDate($period->end),
        ];

        if ($type === 'date') {
            return $dateWhere($field);
        }

        $utc = new DateTimeZone('UTC');

        $dateTimeWhere = [
            $field . '>=' => $period->start->setTimezone($utc)->format('Y-m-d H:i:s'),
            $field . '<' => $period->end->setTimezone($utc)->format('Y-m-d H:i:s'),
        ];

        if ($type === 'datetimeOptional') {
            // All-day events also carry a plain date.
            return ['OR' => [$dateTimeWhere, $dateWhere($field . 'Date')]];
        }

        return $dateTimeWhere;
    }

    /**
     * A date column holds whole days: a period ending at 14:30 includes that day.
     */
    private function getExclusiveEndDate(DateTimeImmutable $end): string
    {
        if ($end->format('H:i:s') !== '00:00:00') {
            $end = $end->setTime(0, 0)->modify('+1 day');
        }

        return $end->format('Y-m-d');
    }
}
