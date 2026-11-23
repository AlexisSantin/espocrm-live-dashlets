<?php

namespace Espo\Modules\LiveDashlets\Tools;

use Espo\Core\Exceptions\NotFound;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;
use Espo\ORM\Repository\RDBSelectBuilder;
use stdClass;

/**
 * Deploys a dashboard template to every user at once.
 *
 * Unlike EspoCRM's own deployment, deploying again updates the tab given before instead of adding
 * it a second time: the tab is recognised by its id or, when it was deployed without one, by its
 * dashlets. Copies left by earlier deployments are removed. The lock applies to regular users only:
 * it would only get in the way of administrators.
 */
class TemplateDeployer
{
    /** Users with a dashboard of their own: neither portal, API nor system users. */
    private const USER_TYPES = ['regular', 'admin', 'super-admin'];

    public function __construct(
        private EntityManager $entityManager,
    ) {}

    public function countUsers(): int
    {
        return $this->users()->count();
    }

    /**
     * @return int The number of users who got the template.
     * @throws NotFound
     */
    public function deployToEveryone(string $templateId, bool $append, bool $lock): int
    {
        $template = $this->entityManager->getEntityById('DashboardTemplate', $templateId);

        if (!$template) {
            throw new NotFound();
        }

        $count = 0;

        foreach ($this->users()->select(['id', 'type'])->find() as $user) {
            $preferences = $this->entityManager->getEntityById('Preferences', $user->getId());

            if (!$preferences) {
                continue;
            }

            $this->apply($preferences, $template, $append);

            if ($lock && $user->get('type') === 'regular') {
                $preferences->set('dashboardLocked', true);
            }

            $this->entityManager->saveEntity($preferences);
            $count++;
        }

        return $count;
    }

    private function users(): RDBSelectBuilder
    {
        return $this->entityManager
            ->getRDBRepository('User')
            ->where(['isActive' => true, 'type' => self::USER_TYPES]);
    }

    private function apply(Entity $preferences, Entity $template, bool $append): void
    {
        /** @var stdClass[] $tabs */
        $tabs = $this->copy($template->get('layout') ?? []);
        $templateOptions = $this->copy($template->get('dashletsOptions') ?? new stdClass());

        if (!$append) {
            $preferences->set([
                'dashboardLayout' => $tabs,
                'dashletsOptions' => $templateOptions,
            ]);

            return;
        }

        /** @var stdClass[] $layout */
        $layout = $this->copy($preferences->get('dashboardLayout') ?? []);
        $options = $this->copy($preferences->get('dashletsOptions') ?? new stdClass());

        if (!is_array($layout)) {
            $layout = [];
        }

        if (!$options instanceof stdClass) {
            $options = new stdClass();
        }

        foreach ($tabs as $tab) {
            $found = $this->findTabs($layout, $tab);

            if (!$found) {
                $layout[] = $tab;

                continue;
            }

            $layout[$found[0]] = $tab;

            foreach (array_slice($found, 1) as $index) {
                unset($layout[$index]);
            }

            $layout = array_values($layout);
        }

        foreach ((array) $templateOptions as $id => $item) {
            $options->$id = $item;
        }

        $preferences->set([
            'dashboardLayout' => array_values($layout),
            'dashletsOptions' => $options,
        ]);
    }

    /**
     * The tabs a user already got from this template tab: the same id or, for a tab deployed
     * without an id, the same dashlets.
     *
     * @param stdClass[] $layout
     * @return int[]
     */
    private function findTabs(array $layout, stdClass $tab): array
    {
        $dashletIds = $this->dashletIds($tab);
        $found = [];

        foreach ($layout as $index => $userTab) {
            if (!$userTab instanceof stdClass) {
                continue;
            }

            $sameId = isset($tab->id, $userTab->id) && $tab->id === $userTab->id;
            $sameDashlets = $dashletIds && array_intersect($dashletIds, $this->dashletIds($userTab));

            if ($sameId || $sameDashlets) {
                $found[] = $index;
            }
        }

        return $found;
    }

    /**
     * @return string[]
     */
    private function dashletIds(stdClass $tab): array
    {
        $ids = [];

        foreach (is_array($tab->layout ?? null) ? $tab->layout : [] as $dashlet) {
            if ($dashlet instanceof stdClass && is_string($dashlet->id ?? null) && $dashlet->id !== '') {
                $ids[] = $dashlet->id;
            }
        }

        return $ids;
    }

    /**
     * A deep copy: the template's values are not shared with the users' preferences.
     */
    private function copy(mixed $value): mixed
    {
        return json_decode((string) json_encode($value));
    }
}
