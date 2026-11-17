<?php

namespace Espo\Modules\LiveDashlets\Tools;

use DateTimeImmutable;

/**
 * A time range in the user's time zone. The end is exclusive.
 */
final class Period
{
    public function __construct(
        public readonly DateTimeImmutable $start,
        public readonly DateTimeImmutable $end,
    ) {}

    /**
     * Part of the period already elapsed at `$now`, from 0 to 1.
     */
    public function getProgress(DateTimeImmutable $now): float
    {
        $length = $this->end->getTimestamp() - $this->start->getTimestamp();

        if ($length <= 0) {
            return 1.0;
        }

        $elapsed = ($now->getTimestamp() - $this->start->getTimestamp()) / $length;

        return max(0.0, min(1.0, $elapsed));
    }

    /**
     * Calendar days left until the end, today included.
     */
    public function getDaysLeft(DateTimeImmutable $now): int
    {
        $today = $now->setTime(0, 0);

        if ($today >= $this->end) {
            return 0;
        }

        return (int) $today->diff($this->end)->days;
    }

    /**
     * @return array{start: string, end: string}
     */
    public function toArray(): array
    {
        return [
            'start' => $this->start->format('Y-m-d'),
            // Last day included in the period.
            'end' => $this->end->modify('-1 second')->format('Y-m-d'),
        ];
    }
}
