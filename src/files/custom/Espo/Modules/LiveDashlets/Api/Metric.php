<?php

namespace Espo\Modules\LiveDashlets\Api;

use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Forbidden;
use Espo\Modules\LiveDashlets\Tools\MetricService;
use Espo\Modules\LiveDashlets\Tools\PeriodResolver;

/**
 * GET LiveDashlets/metric — the figure of a KPI or goal dashlet, for the current user.
 */
class Metric implements Action
{
    public function __construct(
        private MetricService $service,
    ) {}

    /**
     * @throws BadRequest
     * @throws Forbidden
     */
    public function process(Request $request): Response
    {
        $params = $request->getQueryParams();

        $boolFilterList = $params['boolFilterList'] ?? [];

        if (!is_array($boolFilterList)) {
            throw new BadRequest("Bad boolFilterList.");
        }

        $result = $this->service->get(
            entityType: $this->getString($params, 'entityType') ?? '',
            metric: $this->getString($params, 'metric') ?? MetricService::METRIC_COUNT,
            valueField: $this->getString($params, 'valueField'),
            primaryFilter: $this->getString($params, 'primaryFilter'),
            boolFilterList: $boolFilterList,
            dateField: $this->getString($params, 'dateField'),
            period: $this->getString($params, 'period') ?? PeriodResolver::EVER,
            comparison: $this->getString($params, 'comparison') ?? PeriodResolver::COMPARISON_NONE,
            withSeries: ($params['series'] ?? null) === 'true',
        );

        return ResponseComposer::json($result)->setHeader('Cache-Control', 'no-store');
    }

    /**
     * @param array<string, mixed> $params
     * @throws BadRequest
     */
    private function getString(array $params, string $name): ?string
    {
        $value = $params[$name] ?? null;

        if ($value === null || $value === '') {
            return null;
        }

        if (!is_string($value)) {
            throw new BadRequest("Bad $name.");
        }

        return $value;
    }
}
