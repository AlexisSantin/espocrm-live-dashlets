<?php

/**
 * Adds a showcase of Live Dashlets to a user's dashboard, as extra tabs: the next actions, a cockpit,
 * every ready-made indicator, the styles and colors, the periods and calculations. Existing tabs are left untouched.
 * Goal targets are computed from the current figures, so that each goal status can be seen.
 *
 * Run from the EspoCRM root, as the web server user, after demo-data.php:
 *     php demo-dashboard.php [--user=admin]
 *     php demo-dashboard.php [--user=admin] --remove
 *
 * Running it again replaces the demo tabs. Their ids start with "lddemo".
 */

include 'bootstrap.php';

use Espo\Core\Acl;
use Espo\Core\Application;
use Espo\Core\ApplicationUser;
use Espo\Core\InjectableFactory;
use Espo\Core\Utils\Config;
use Espo\Core\Utils\Language;
use Espo\Core\Utils\Metadata;
use Espo\Modules\LiveDashlets\Tools\MetricService;
use Espo\ORM\EntityManager;

const DEMO_PREFIX = 'lddemo';
const COLUMNS = 4;

$cliOptions = getopt('', ['user:', 'remove']);
$userName = $cliOptions['user'] ?? 'admin';

$app = new Application();
$container = $app->getContainer();
$em = $container->getByClass(EntityManager::class);

$user = $em->getRDBRepository('User')->where(['userName' => $userName])->findOne();

if (!$user) {
    fwrite(STDERR, "User '$userName' not found.\n");
    exit(1);
}

$container->getByClass(ApplicationUser::class)->setUser($user);

$preferences = $em->getEntityById('Preferences', $user->getId());

// ---------------------------------------------------------------------------------------------
// Keep everything that is not ours.
// ---------------------------------------------------------------------------------------------

$isDemo = fn (mixed $id) => str_starts_with((string) $id, DEMO_PREFIX);

$dashboardLayout = array_values(array_filter(
    $preferences->get('dashboardLayout') ?? [],
    fn ($tab) => !$isDemo($tab->id ?? '')
));

$dashletsOptions = array_filter(
    (array) ($preferences->get('dashletsOptions') ?? []),
    fn ($id) => !$isDemo($id),
    ARRAY_FILTER_USE_KEY
);

$save = function (array $layout, array $options) use ($preferences, $em): void {
    $preferences->set([
        'dashboardLayout' => $layout,
        'dashletsOptions' => (object) $options,
    ]);

    $em->saveEntity($preferences);
};

if (isset($cliOptions['remove'])) {
    $save($dashboardLayout, $dashletsOptions);

    echo "Demo tabs removed for $userName.\n";
    exit(0);
}

// ---------------------------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------------------------

$acl = $container->getByClass(Acl::class);
$metadata = $container->getByClass(Metadata::class);
$config = $container->getByClass(Config::class);
$language = $container->getByClass(Language::class);
$metricService = $container->getByClass(InjectableFactory::class)->create(MetricService::class);

$languageCode = $preferences->get('language') ?: $config->get('language');
$french = str_starts_with((string) $languageCode, 'fr');
$t = fn (string $en, string $fr) => $french ? $fr : $en;

$period = fn (string $name) => $language->translateLabel($name, 'periods', 'LiveDashlets');

$presets = [];

foreach ($metadata->get(['app', 'liveDashlets', 'presetList']) ?? [] as $preset) {
    $presets[$preset['name']] = $preset;
}

$counter = 0;
$skipped = [];

$canRead = function (array $options) use ($acl, $metadata): bool {
    $entityType = $options['entityType'] ?? null;

    if ($entityType === null) {
        return true;
    }

    if (!$metadata->get(['scopes', $entityType, 'entity']) || $metadata->get(['scopes', $entityType, 'disabled'])) {
        return false;
    }

    if (!$acl->checkScope($entityType, 'read')) {
        return false;
    }

    foreach (['valueField', 'dateField'] as $key) {
        if (!empty($options[$key]) && !$acl->checkField($entityType, $options[$key])) {
            return false;
        }
    }

    return true;
};

/** A dashlet of the tab at a position, unless the user can't read its data. */
$place = function (array &$tab, string $name, int $x, int $y, int $width, int $height, ?array $options = null) use (
    &$counter, &$skipped, &$dashletsOptions, $canRead, $acl, $metadata
): void {
    if ($options !== null && !$canRead($options)) {
        $skipped[] = $options['title'];

        return;
    }

    $scope = $metadata->get(['dashlets', $name, 'aclScope']);

    if (!$metadata->get(['dashlets', $name]) || ($scope && !$acl->checkScope($scope, 'read'))) {
        $skipped[] = $name;

        return;
    }

    $id = DEMO_PREFIX . (++$counter);

    $tab['layout'][] = (object) [
        'id' => $id,
        'name' => $name,
        'x' => $x,
        'y' => $y,
        'width' => $width,
        'height' => $height,
    ];

    if ($options !== null) {
        $dashletsOptions[$id] = (object) $options;
    }
};

/** Tiles one row high, from left to right, starting at row $y. Returns the next free row. */
$flow = function (array &$tab, array $tiles, int $y = 0) use ($place): int {
    $x = 0;

    foreach ($tiles as [$name, $width, $options]) {
        if ($x + $width > COLUMNS) {
            $x = 0;
            $y++;
        }

        $place($tab, $name, $x, $y, $width, 1, $options);
        $x += $width;
    }

    return $y + 1;
};

$fromPreset = function (string $name, array $overrides = []) use ($presets, $language): array {
    return [
        'title' => $language->translateLabel($name, 'presets', 'LiveDashlets'),
        ...$presets[$name]['options'],
        ...$overrides,
    ];
};

$kpi = fn (array $options) => ['LiveDashletsKpi', 1, $options];

/** Rounded to two significant digits, in the given direction. */
$roundTarget = function (float $value, bool $up): float {
    $unit = 10 ** max(0, floor(log10(max(1, $value))) - 1);

    return ($up ? ceil($value / $unit) : floor($value / $unit)) * $unit;
};

/** The options of a goal, with a target that gives it the wanted status today. */
$goalInState = function (array $options, string $state) use ($metricService, $canRead, $roundTarget): array {
    if (!$canRead($options)) {
        return $options;
    }

    $result = $metricService->get(
        $options['entityType'],
        $options['metric'] ?? 'count',
        $options['valueField'] ?? null,
        $options['primaryFilter'] ?? null,
        $options['boolFilterList'] ?? [],
        $options['dateField'] ?? null,
        $options['period'],
        'none'
    );

    $value = (float) ($result['value'] ?? 0);
    $progress = (float) ($result['period']['progress'] ?? 0.5);

    if ($value <= 0) {
        return $options;
    }

    $target = match ($state) {
        'reached' => $roundTarget($value * 0.8, false),
        'behind' => $roundTarget($value / max(0.05, $progress * 0.7), true),
        default => $roundTarget($value / min(0.95, max(0.1, $progress * 1.2)), false),
    };

    // Rounding must not turn a goal in progress into a reached one.
    if ($state !== 'reached' && $target <= $value) {
        $target = $value + max(1, $value * 0.1);
    }

    return [...$options, 'target' => $target];
};

// Figures shared by several tabs.
$wonDeals = [
    'entityType' => 'Opportunity',
    'primaryFilter' => 'won',
    'dateField' => 'closeDate',
    'period' => 'currentQuarter',
    'comparison' => 'toDate',
    'boolFilterList' => [],
    'tileStyle' => 'soft',
];
$heldCalls = [
    'entityType' => 'Call',
    'primaryFilter' => 'held',
    'metric' => 'count',
    'dateField' => 'dateStart',
    'period' => 'currentMonth',
    'comparison' => 'toDate',
    'boolFilterList' => [],
    'tileStyle' => 'soft',
];

$averageDeal = [
    ...$wonDeals,
    'title' => $t('Average deal', 'Affaire moyenne'),
    'metric' => 'avg',
    'valueField' => 'amount',
    'accentColor' => 'primary',
];
$leadPotential = [
    'title' => $t('Potential in open leads', 'Potentiel des leads ouverts'),
    'entityType' => 'Lead',
    'primaryFilter' => 'actual',
    'metric' => 'sum',
    'valueField' => 'opportunityAmount',
    'period' => 'ever',
    'comparison' => 'none',
    'boolFilterList' => [],
    'accentColor' => 'primary',
    'tileStyle' => 'soft',
];

// ---------------------------------------------------------------------------------------------
// First tab: what to do now, with the figures next to it.
// ---------------------------------------------------------------------------------------------

$actions = ['id' => DEMO_PREFIX . '-actions', 'name' => $language->translateLabel('nextActions', 'presets', 'LiveDashlets'), 'layout' => []];

$place($actions, 'LiveDashletsActions', 0, 0, 2, 3, $fromPreset('nextActions'));
$place($actions, 'LiveDashletsKpi', 2, 0, 1, 1, $fromPreset('newLeads'));
$place($actions, 'LiveDashletsKpi', 3, 0, 1, 1, $fromPreset('wonDeals'));
$place($actions, 'LiveDashletsKpi', 2, 1, 1, 1, $fromPreset('callsHeld'));
$place($actions, 'LiveDashletsKpi', 3, 1, 1, 1, $fromPreset('convertedLeads'));
$place($actions, 'LiveDashletsGoal', 2, 2, 2, 1, $goalInState($fromPreset('myCallsGoal'), 'behind'));

// ---------------------------------------------------------------------------------------------
// A complete dashboard.
// ---------------------------------------------------------------------------------------------

$cockpit = ['id' => DEMO_PREFIX . '-cockpit', 'name' => $t('Cockpit', 'Cockpit'), 'layout' => []];

$place($cockpit, 'LiveDashletsKpi', 0, 0, 2, 2, $fromPreset('wonRevenue'));
$place($cockpit, 'LiveDashletsKpi', 2, 0, 1, 1, $fromPreset('newLeads'));
$place($cockpit, 'LiveDashletsKpi', 3, 0, 1, 1, $fromPreset('convertedLeads'));
$place($cockpit, 'LiveDashletsKpi', 2, 1, 1, 1, $fromPreset('wonDeals'));
$place($cockpit, 'LiveDashletsKpi', 3, 1, 1, 1, $fromPreset('callsHeld'));
$place($cockpit, 'LiveDashletsGoal', 0, 2, 2, 1, $goalInState($fromPreset('revenueGoal'), 'ahead'));
$place($cockpit, 'LiveDashletsGoal', 2, 2, 2, 1, $goalInState($fromPreset('myCallsGoal'), 'behind'));
$place($cockpit, 'SalesByMonth', 0, 3, 2, 2);
$place($cockpit, 'OpportunitiesByStage', 2, 3, 2, 2);
$place($cockpit, 'SalesPipeline', 0, 5, 2, 2);
$place($cockpit, 'OpportunitiesByLeadSource', 2, 5, 2, 2);
$place($cockpit, 'Tasks', 0, 7, 2, 3);
$place($cockpit, 'Activities', 2, 7, 2, 3);

// ---------------------------------------------------------------------------------------------
// Tab 2: every ready-made indicator of the gallery, and two more calculations.
// ---------------------------------------------------------------------------------------------

$all = ['id' => DEMO_PREFIX . '-indicators', 'name' => $t('All indicators', 'Tous les indicateurs'), 'layout' => []];

$order = [
    'newLeads', 'convertedLeads', 'myNewLeads', 'newContacts',
    'wonRevenue', 'wonDeals', 'openPipeline', 'newAccounts',
    'revenueGoal', 'myCallsGoal',
    'callsHeld', 'meetingsHeld', 'tasksCompleted', 'overdueTasks',
    'openCases', 'newCases',
];

// Indicators added to the gallery later are shown too.
$order = [...$order, ...array_diff(array_keys($presets), $order)];

$tiles = [];

foreach ($order as $name) {
    // The next actions have their own tab: this one is made of small tiles.
    if (!isset($presets[$name]) || $presets[$name]['dashlet'] === 'LiveDashletsActions') {
        continue;
    }

    $options = $fromPreset($name);
    $isGoal = $presets[$name]['dashlet'] === 'LiveDashletsGoal';

    if ($isGoal) {
        $options = $goalInState($options, $name === 'revenueGoal' ? 'ahead' : 'behind');
    }

    $tiles[] = [$presets[$name]['dashlet'], $presets[$name]['width'] ?? 1, $options];
}

$tiles[] = $kpi($averageDeal);
$tiles[] = $kpi($leadPotential);

$flow($all, $tiles);

// ---------------------------------------------------------------------------------------------
// Tab 3: three styles, six colors, three goal statuses.
// ---------------------------------------------------------------------------------------------

$styles = ['id' => DEMO_PREFIX . '-styles', 'name' => $t('Styles and colors', 'Styles et couleurs'), 'layout' => []];

$colorSamples = [
    'primary' => [$t('Blue', 'Bleu'), ['entityType' => 'Lead', 'dateField' => 'createdAt']],
    'success' => [$t('Green', 'Vert'), ['entityType' => 'Call', 'primaryFilter' => 'held', 'dateField' => 'dateStart']],
    'info' => [$t('Purple', 'Violet'), [
        ...$wonDeals, 'metric' => 'sum', 'valueField' => 'amount', 'period' => 'currentQuarter',
    ]],
    'warning' => [$t('Orange', 'Orange'), ['entityType' => 'Task', 'dateField' => 'createdAt']],
    'danger' => [$t('Red', 'Rouge'), ['entityType' => 'Case', 'dateField' => 'createdAt', 'lowerIsBetter' => true]],
    'default' => [$t('Gray', 'Gris'), ['entityType' => 'Account', 'dateField' => 'createdAt']],
];

$styleSamples = [
    'soft' => [$t('Soft', 'Doux'), 'ahead', $t('on track', 'en avance')],
    'minimal' => [$t('Minimal', 'Épuré'), 'behind', $t('behind', 'en retard')],
    'solid' => [$t('Solid', 'Plein'), 'reached', $t('reached', 'atteint')],
];

$tiles = [];

foreach ($styleSamples as $style => [$styleLabel, $state, $stateLabel]) {
    foreach ($colorSamples as $color => [$colorLabel, $sample]) {
        $tiles[] = $kpi([
            'metric' => 'count',
            'period' => 'currentMonth',
            'comparison' => 'toDate',
            'boolFilterList' => [],
            ...$sample,
            'title' => "$styleLabel · $colorLabel",
            'accentColor' => $color,
            'tileStyle' => $style,
        ]);
    }

    $tiles[] = ['LiveDashletsGoal', 2, $goalInState([
        ...$heldCalls,
        'title' => $t('Goal', 'Objectif') . " · $stateLabel",
        'accentColor' => 'primary',
        'tileStyle' => $style,
    ], $state)];
}

$flow($styles, $tiles);

// ---------------------------------------------------------------------------------------------
// Tab 4: periods, comparisons and calculations.
// ---------------------------------------------------------------------------------------------

$periods = ['id' => DEMO_PREFIX . '-periods', 'name' => $t('Periods and calculations', 'Périodes et calculs'), 'layout' => []];

$tiles = [];

// Nothing is held yet early in the day: "today" counts the calls of the day.
$tiles[] = $kpi([
    ...$heldCalls,
    'title' => $t('Calls scheduled', 'Appels prévus') . ' · ' . $period('today'),
    'primaryFilter' => null,
    'period' => 'today',
    'comparison' => 'full',
    'accentColor' => 'primary',
]);

foreach (['currentWeek', 'currentMonth', 'currentQuarter', 'currentYear', 'lastSevenDays', 'lastThirtyDays', 'ever'] as $name) {
    $tiles[] = $kpi([
        ...$heldCalls,
        'title' => $t('Calls held', 'Appels passés') . ' · ' . $period($name),
        'period' => $name,
        'comparison' => $name === 'ever' ? 'none' : 'toDate',
        'accentColor' => 'primary',
    ]);
}

$newLeads = [...$fromPreset('newLeads'), 'accentColor' => 'primary'];

$tiles[] = $kpi([...$newLeads, 'title' => $t('Vs same point last month', 'Contre le même moment')]);
$tiles[] = $kpi([...$newLeads, 'title' => $t('Vs whole last month', 'Contre tout le mois dernier'), 'comparison' => 'full']);
$tiles[] = $kpi([...$newLeads, 'title' => $t('No comparison', 'Sans comparaison'), 'comparison' => 'none']);
$tiles[] = $kpi([
    ...$fromPreset('newCases', ['tileStyle' => 'soft', 'period' => 'currentMonth']),
    'title' => $t('A decrease is good news', 'Une baisse est une bonne nouvelle'),
]);

$tiles[] = $kpi([...$wonDeals, 'title' => $t('Count: deals won', 'Nombre : affaires gagnées'), 'metric' => 'count', 'accentColor' => 'primary']);
$tiles[] = $kpi([...$wonDeals, 'title' => $t('Sum: amount won', 'Somme : montant gagné'), 'metric' => 'sum', 'valueField' => 'amount', 'accentColor' => 'primary']);
$tiles[] = $kpi([...$averageDeal, 'title' => $t('Average: deal size', 'Moyenne : affaire')]);
$tiles[] = $kpi([
    ...$wonDeals,
    'title' => $t('Average: win probability', 'Moyenne : probabilité'),
    'primaryFilter' => 'open',
    'metric' => 'avg',
    'valueField' => 'probability',
    'period' => 'ever',
    'dateField' => null,
    'comparison' => 'none',
    'accentColor' => 'primary',
]);

$flow($periods, $tiles);

// ---------------------------------------------------------------------------------------------
// Save: the user's tabs first, then the demo.
// ---------------------------------------------------------------------------------------------

$demoTabs = [$actions, $cockpit, $all, $styles, $periods];

foreach ($demoTabs as $tab) {
    $dashboardLayout[] = (object) $tab;
}

$save($dashboardLayout, $dashletsOptions);

echo json_encode([
    'user' => $userName,
    'tabs' => array_map(fn ($tab) => [$tab['name'] => count($tab['layout'])], $demoTabs),
    'skipped (no access)' => $skipped,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), "\n";
