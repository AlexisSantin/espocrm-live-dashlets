<?php

use Espo\Core\Container;
use Espo\Core\InjectableFactory;
use Espo\Core\Utils\Config;
use Espo\Core\Utils\Config\ConfigWriter;
use Espo\ORM\EntityManager;

/**
 * Removes the dashboard template created at installation: its dashlets no longer exist.
 * Dashboards already deployed to users are theirs and are left as they are.
 *
 * Not called on upgrades (EspoCRM skips the uninstall "after" script of the replaced version).
 */
class AfterUninstall
{
    private const CONFIG_KEY = 'liveDashletsTemplateId';

    public function run(Container $container): void
    {
        $config = $container->getByClass(Config::class);

        if (!$config->has(self::CONFIG_KEY)) {
            return;
        }

        $id = $config->get(self::CONFIG_KEY);
        $entityManager = $container->getByClass(EntityManager::class);

        $template = is_string($id) ? $entityManager->getEntityById('DashboardTemplate', $id) : null;

        if ($template) {
            $entityManager->removeEntity($template);
        }

        $configWriter = $container->getByClass(InjectableFactory::class)->create(ConfigWriter::class);

        $configWriter->remove(self::CONFIG_KEY);
        $configWriter->save();
    }
}
