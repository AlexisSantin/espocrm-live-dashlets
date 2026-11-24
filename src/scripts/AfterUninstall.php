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
