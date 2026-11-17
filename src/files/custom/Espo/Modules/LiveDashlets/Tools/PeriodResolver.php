<?php

namespace Espo\Modules\LiveDashlets\Tools;

use DateTimeImmutable;
use DateTimeZone;
use Espo\Core\Utils\Config;
use Espo\Entities\Preferences;
use Exception;

/**
 * Turns a period name ("currentMonth"…) into dates, in the time zone and with the week start
 * of the current user, so that "this month" means the same thing as in the rest of EspoCRM.
 */
class PeriodResolver
{
    public const EVER = 'ever';

    public const PERIOD_LIST = [
        'today',
        'currentWeek',
        'currentMonth',
        'currentQuarter',
        'currentYear',
        'currentFiscalQuarter',
        'currentFiscalYear',
        'lastSevenDays',
        'lastThirtyDays',
        self::EVER,
    ];

    /** Previous period cut at the same point as now (fair comparison while the period runs). */
    public const COMPARISON_TO_DATE = 'toDate';
    /** Whole previous period. */
    public const COMPARISON_FULL = 'full';
    public const COMPARISON_NONE = 'none';

    public const COMPARISON_LIST = [
        self::COMPARISON_TO_DATE,
        self::COMPARISON_FULL,
        self::COMPARISON_NONE,
    ];

    public function __construct(
        private Config $config,
        private Preferences $preferences,
    ) {}

    /**
     * A rolling window always ends today: it has no "days left" nor expected pace.
     */
    public function isRolling(string $period): bool
    {
        return in_array($period, ['lastSevenDays', 'lastThirtyDays'], true);
    }

    public function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', $this->getTimeZone());
    }

    /**
     * Null for "ever".
     */
    public function resolve(string $period, DateTimeImmutable $now): ?Period
    {
        $today = $now->setTime(0, 0);
        $year = (int) $today->format('Y');
        $month = (int) $today->format('n');

        return match ($period) {
            'today' => new Period($today, $today->modify('+1 day')),
            'currentWeek' => $this->span($this->getWeekStart($today), '+7 days'),
            'currentMonth' => $this->span($today->setDate($year, $month, 1), '+1 month'),
            'currentQuarter' => $this->span($today->setDate($year, intdiv($month - 1, 3) * 3 + 1, 1), '+3 months'),
            'currentYear' => $this->span($today->setDate($year, 1, 1), '+1 year'),
            'currentFiscalYear' => $this->span($this->getFiscalYearStart($today), '+1 year'),
            'currentFiscalQuarter' => $this->span($this->getFiscalQuarterStart($today), '+3 months'),
            'lastSevenDays' => new Period($today->modify('-6 days'), $today->modify('+1 day')),
            'lastThirtyDays' => new Period($today->modify('-29 days'), $today->modify('+1 day')),
            default => null,
        };
    }

    /**
     * The period just before `$current`, either whole or cut at the same elapsed time.
     */
    public function resolvePrevious(
        string $period,
        Period $current,
        DateTimeImmutable $now,
        string $comparison
    ): ?Period {

        $step = match ($period) {
            'today' => '1 day',
            'currentWeek', 'lastSevenDays' => '7 days',
            'currentMonth' => '1 month',
            'currentQuarter', 'currentFiscalQuarter' => '3 months',
            'currentYear', 'currentFiscalYear' => '1 year',
            'lastThirtyDays' => '30 days',
            default => null,
        };

        if ($step === null || $comparison === self::COMPARISON_NONE) {
            return null;
        }

        $start = $current->start->modify('-' . $step);

        if ($comparison === self::COMPARISON_FULL) {
            return new Period($start, $current->start);
        }

        // Same calendar offset: 17 Nov 14:30 in the month compares with 17 Oct 14:30.
        $end = $start->add($current->start->diff($now));

        if ($end > $current->start) {
            $end = $current->start;
        }

        return new Period($start, $end);
    }

    private function span(DateTimeImmutable $start, string $length): Period
    {
        return new Period($start, $start->modify($length));
    }

    private function getWeekStart(DateTimeImmutable $today): DateTimeImmutable
    {
        $weekStart = $this->preferences->get('weekStart');

        if (!is_int($weekStart) || $weekStart < 0 || $weekStart > 6) {
            $weekStart = (int) ($this->config->get('weekStart') ?? 0);
        }

        $offset = ((int) $today->format('w') - $weekStart + 7) % 7;

        return $today->modify('-' . $offset . ' days');
    }

    private function getFiscalYearStart(DateTimeImmutable $today): DateTimeImmutable
    {
        $shift = (int) ($this->config->get('fiscalYearShift') ?? 0);
        $startMonth = max(0, min(11, $shift)) + 1;

        $year = (int) $today->format('Y');

        if ((int) $today->format('n') < $startMonth) {
            $year--;
        }

        return $today->setDate($year, $startMonth, 1);
    }

    private function getFiscalQuarterStart(DateTimeImmutable $today): DateTimeImmutable
    {
        $yearStart = $this->getFiscalYearStart($today);

        $months = ((int) $today->format('Y') - (int) $yearStart->format('Y')) * 12 +
            (int) $today->format('n') - (int) $yearStart->format('n');

        return $yearStart->modify('+' . (intdiv($months, 3) * 3) . ' months');
    }

    private function getTimeZone(): DateTimeZone
    {
        $name = $this->preferences->get('timeZone') ?: $this->config->get('timeZone') ?: 'UTC';

        try {
            return new DateTimeZone($name);
        } catch (Exception) {
            return new DateTimeZone('UTC');
        }
    }
}
