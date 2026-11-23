<?php

/**
 * Deletes the demo data created by demo-data.php: the records it listed in MANIFEST or whose description
 * is a demo marker, and every email, call, meeting or task attached to them, including those added since.
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
const MANIFEST = 'data/live-dashlets-demo.json';

$app = new Application();
$app->setupSystemUser();

$em = $app->getContainer()->getByClass(EntityManager::class);

// The records listed by demo-data.php; earlier versions only marked their description.
$listed = is_file(MANIFEST) ? (json_decode((string) file_get_contents(MANIFEST), true) ?: []) : [];

// Read before anything is deleted.
$parentConditions = [];

foreach (PARENT_TYPES as $parentType) {
    $ids = $listed[$parentType] ?? [];

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

    if (!empty($listed[$entityType])) {
        $conditions[] = ['id' => $listed[$entityType]];
    }

    if (in_array($entityType, ACTIVITY_TYPES, true)) {
        array_push($conditions, ...$parentConditions);
    }

    foreach ($em->getRDBRepository($entityType)->where(['OR' => $conditions])->find() as $entity) {
        $em->removeEntity($entity, ['silent' => true]);
        $counts[$entityType]++;
    }
}

if (is_file(MANIFEST)) {
    unlink(MANIFEST);
}

echo json_encode(['removed' => $counts], JSON_PRETTY_PRINT), "\n";
