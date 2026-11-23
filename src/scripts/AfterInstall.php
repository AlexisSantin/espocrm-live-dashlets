<?php

use Espo\Core\Container;
use Espo\Core\InjectableFactory;
use Espo\Core\Utils\Config;
use Espo\Core\Utils\Config\ConfigWriter;
use Espo\Core\Utils\Metadata;
use Espo\ORM\EntityManager;

/**
 * Creates a ready-made dashboard template (Administration → Dashboard Templates).
 *
 * - Nothing is imposed on users: the administrator chooses whom to deploy it to.
 * - It is created once: its id is remembered, so an upgrade neither duplicates it nor brings it
 *   back after the administrator deleted it.
 * - Its tab has an id, so that deploying it again updates the tab users got instead of adding it
 *   a second time. A template created by an earlier version gets that id on upgrade.
 * - One tile only, the amount won this quarter, is highlighted. The style and the color of the tiles
 *   follow the company's choice (at the top of the + Add window).
 * - Dashlets on a disabled entity are left out. Every figure is computed with the viewer's own
 *   access rights, so the same template can be deployed to everyone.
 */
class AfterInstall
{
    private const CONFIG_KEY = 'liveDashletsTemplateId';

    public function run(Container $container): void
    {
        $config = $container->getByClass(Config::class);

        $entityManager = $container->getByClass(EntityManager::class);

        if ($config->has(self::CONFIG_KEY)) {
            $this->addTabIds($entityManager, (string) $config->get(self::CONFIG_KEY));

            return;
        }

        $metadata = $container->getByClass(Metadata::class);

        $isFrench = str_starts_with((string) $config->get('language'), 'fr');
        $t = fn (string $en, string $fr) => $isFrench ? $fr : $en;

        $dashlets = [
            [
                'name' => 'LiveDashletsActions', 'x' => 0, 'y' => 0, 'width' => 2, 'height' => 3,
                'options' => [
                    'title' => $t('Next actions', 'À faire maintenant'),
                    'displayRecords' => 6,
                    'dormantDays' => 14,
                    'autorefreshInterval' => 5,
                ],
            ],
            [
                'name' => 'LiveDashletsKpi', 'x' => 2, 'y' => 0, 'width' => 1, 'height' => 1,
                'options' => [
                    'title' => $t('New leads', 'Nouveaux leads'),
                    'entityType' => 'Lead',
                    'metric' => 'count',
                    'period' => 'currentMonth',
                    'dateField' => 'createdAt',
                    'comparison' => 'toDate',
                ],
            ],
            [
                'name' => 'LiveDashletsKpi', 'x' => 3, 'y' => 0, 'width' => 1, 'height' => 1,
                'options' => [
                    'title' => $t('Converted leads', 'Leads convertis'),
                    'entityType' => 'Lead',
                    'primaryFilter' => 'converted',
                    'metric' => 'count',
                    'period' => 'currentMonth',
                    'dateField' => 'convertedAt',
                    'comparison' => 'toDate',
                ],
            ],
            [
                'name' => 'LiveDashletsKpi', 'x' => 2, 'y' => 1, 'width' => 1, 'height' => 1,
                'options' => [
                    'title' => $t('Won this quarter', 'Gagné ce trimestre'),
                    'entityType' => 'Opportunity',
                    'primaryFilter' => 'won',
                    'metric' => 'sum',
                    'valueField' => 'amount',
                    'period' => 'currentQuarter',
                    'dateField' => 'closeDate',
                    'comparison' => 'toDate',
                    'highlight' => true,
                ],
            ],
            [
                'name' => 'LiveDashletsKpi', 'x' => 3, 'y' => 1, 'width' => 1, 'height' => 1,
                'options' => [
                    'title' => $t('Open cases', 'Tickets ouverts'),
                    'entityType' => 'Case',
                    'primaryFilter' => 'open',
                    'metric' => 'count',
                    'period' => 'ever',
                    'comparison' => 'none',
                    'lowerIsBetter' => true,
                ],
            ],
            [
                'name' => 'LiveDashletsGoal', 'x' => 2, 'y' => 2, 'width' => 2, 'height' => 1,
                'options' => [
                    'title' => $t('My calls this month', 'Mes appels du mois'),
                    'entityType' => 'Call',
                    'primaryFilter' => 'held',
                    'boolFilterList' => ['onlyMy'],
                    'metric' => 'count',
                    'target' => 40,
                    'period' => 'currentMonth',
                    'dateField' => 'dateStart',
                ],
            ],
            [
                'name' => 'LiveDashletsGoal', 'x' => 0, 'y' => 3, 'width' => 2, 'height' => 1,
                'options' => [
                    'title' => $t('Quarterly revenue', "Chiffre d'affaires du trimestre"),
                    'entityType' => 'Opportunity',
                    'primaryFilter' => 'won',
                    'metric' => 'sum',
                    'valueField' => 'amount',
                    'target' => 50000,
                    'period' => 'currentQuarter',
                    'dateField' => 'closeDate',
                ],
            ],
            ['name' => 'Stream', 'x' => 2, 'y' => 3, 'width' => 2, 'height' => 4, 'options' => null],
            ['name' => 'Tasks', 'x' => 0, 'y' => 4, 'width' => 2, 'height' => 3, 'options' => null],
        ];

        $layout = [];
        $dashletsOptions = [];

        foreach ($dashlets as $i => $dashlet) {
            $entityType = $dashlet['options']['entityType'] ??
                ($dashlet['name'] === 'Tasks' ? 'Task' : null);

            if (
                $entityType &&
                (
                    !$metadata->get(['scopes', $entityType, 'entity']) ||
                    $metadata->get(['scopes', $entityType, 'disabled'])
                )
            ) {
                continue;
            }

            $id = 'live' . ($i + 1) . bin2hex(random_bytes(3));

            $layout[] = (object) [
                'id' => $id,
                'name' => $dashlet['name'],
                'x' => $dashlet['x'],
                'y' => $dashlet['y'],
                'width' => $dashlet['width'],
                'height' => $dashlet['height'],
            ];

            if ($dashlet['options']) {
                $dashletsOptions[$id] = (object) $dashlet['options'];
            }
        }

        $template = $entityManager->createEntity('DashboardTemplate', [
            'name' => $t('Live dashboard', 'Tableau de bord vivant'),
            'layout' => [
                (object) [
                    'id' => $this->newTabId(),
                    'name' => $t('Activity', 'Activité'),
                    'layout' => $layout,
                ],
            ],
            'dashletsOptions' => (object) $dashletsOptions,
        ]);

        $configWriter = $container->getByClass(InjectableFactory::class)->create(ConfigWriter::class);

        $configWriter->set(self::CONFIG_KEY, $template->getId());
        $configWriter->save();
    }

    /**
     * Templates created before 1.4.2 had a tab without an id: EspoCRM then added it again at each
     * deployment.
     */
    private function addTabIds(EntityManager $entityManager, string $templateId): void
    {
        $template = $templateId ? $entityManager->getEntityById('DashboardTemplate', $templateId) : null;

        if (!$template) {
            return;
        }

        $layout = json_decode((string) json_encode($template->get('layout') ?? []));
        $changed = false;

        foreach (is_array($layout) ? $layout : [] as $tab) {
            if ($tab instanceof stdClass && empty($tab->id)) {
                $tab->id = $this->newTabId();
                $changed = true;
            }
        }

        if ($changed) {
            $template->set('layout', $layout);
            $entityManager->saveEntity($template);
        }
    }

    private function newTabId(): string
    {
        return 'live' . bin2hex(random_bytes(5));
    }
}
