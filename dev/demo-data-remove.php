<?php

/**
 * Deletes the demo data created by demo-data.php (records whose description is a demo marker).
 *
 * Run from the EspoCRM root, as the web server user:
 *     php demo-data-remove.php
 */

include 'bootstrap.php';

use Espo\Core\Application;
use Espo\ORM\EntityManager;

// The first one is the marker of earlier versions of demo-data.php.
const DESCRIPTIONS = ['Donnée de démonstration (Live Dashlets).', 'Demo data (Live Dashlets).'];

$app = new Application();
$app->setupSystemUser();

$em = $app->getContainer()->getByClass(EntityManager::class);

$counts = [];

foreach (['Call', 'Meeting', 'Task', 'Case', 'Opportunity', 'Lead', 'Contact', 'Account'] as $entityType) {
    $counts[$entityType] = 0;

    foreach ($em->getRDBRepository($entityType)->where(['description' => DESCRIPTIONS])->find() as $entity) {
        $em->removeEntity($entity, ['silent' => true]);
        $counts[$entityType]++;
    }
}

echo json_encode(['removed' => $counts], JSON_PRETTY_PRINT), "\n";
