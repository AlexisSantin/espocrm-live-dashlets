<?php

/**
 * Deletes the demo data created by demo-data.php: the records whose description is a demo marker,
 * and every email, call, meeting or task attached to them, including those added since.
 *
 * Run from the EspoCRM root, as the web server user:
 *     php demo-data-remove.php
 */

include 'bootstrap.php';

use Espo\Core\Application;
use Espo\ORM\EntityManager;

// The first one is the marker of earlier versions of demo-data.php.
const DESCRIPTIONS = ['Donnée de démonstration (Live Dashlets).', 'Demo data (Live Dashlets).'];
const PARENT_TYPES = ['Account', 'Contact', 'Lead', 'Opportunity', 'Case'];
const ACTIVITY_TYPES = ['Email', 'Call', 'Meeting', 'Task'];

$app = new Application();
$app->setupSystemUser();

$em = $app->getContainer()->getByClass(EntityManager::class);

// Read before anything is deleted.
$parentConditions = [];

foreach (PARENT_TYPES as $parentType) {
    $ids = [];

    foreach ($em->getRDBRepository($parentType)->select(['id'])->where(['description' => DESCRIPTIONS])->find() as $entity) {
        $ids[] = $entity->getId();
    }

    if ($ids) {
        $parentConditions[] = ['parentType' => $parentType, 'parentId' => $ids];
    }
}

$counts = [];

foreach ([...ACTIVITY_TYPES, 'Case', 'Opportunity', 'Lead', 'Contact', 'Account'] as $entityType) {
    $counts[$entityType] = 0;
    $marker = $entityType === 'Email' ? 'body' : 'description';
    $conditions = [[$marker => DESCRIPTIONS]];

    if (in_array($entityType, ACTIVITY_TYPES, true)) {
        array_push($conditions, ...$parentConditions);
    }

    foreach ($em->getRDBRepository($entityType)->where(['OR' => $conditions])->find() as $entity) {
        $em->removeEntity($entity, ['silent' => true]);
        $counts[$entityType]++;
    }
}

echo json_encode(['removed' => $counts], JSON_PRETTY_PRINT), "\n";
