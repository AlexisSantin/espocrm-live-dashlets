<?php
/************************************************************************
 * This file is part of Live Dashlets for EspoCRM.
 *
 * Copyright (C) 2026 Alexis SANTIN
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 ************************************************************************/

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
