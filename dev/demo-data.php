<?php

/**
 * Demo data for the Live Dashlets extension: accounts, contacts, leads and opportunities from April,
 * calls, meetings, tasks and cases from August, up to today (plus planned items in the next two
 * weeks), with an activity that grows over time so that trends and curves have something to show.
 *
 * Run from the EspoCRM root, as the web server user:
 *     php demo-data.php [--boost=1.25] [--seed=101]
 *
 * --boost multiplies the number of leads in the current month (default 1.25). Raise it when existing
 * data makes the previous month look busier.
 *
 * Every account, contact, lead, deal and case has DESCRIPTION in its description: demo-data-remove.php
 * deletes them with the activities attached to them. Phone numbers are in the +33 1 99 00 range, reserved for fiction.
 * Records are saved silently (no stream notes, no notifications) and dated in the past.
 */

include 'bootstrap.php';

use Espo\Core\Application;
use Espo\Core\Utils\Config;
use Espo\ORM\EntityManager;

const DESCRIPTION = 'Demo data (Live Dashlets).';

$app = new Application();
$app->setupSystemUser();

$container = $app->getContainer();
$em = $container->getByClass(EntityManager::class);
$config = $container->getByClass(Config::class);

// Also the marker of earlier versions.
$existing = $em->getRDBRepository('Account')
    ->where(['description' => [DESCRIPTION, 'Donnée de démonstration (Live Dashlets).']])
    ->count();

if ($existing) {
    fwrite(STDERR, "Demo data already present ($existing accounts). Run demo-data-remove.php first.\n");
    exit(1);
}

$cliOptions = getopt('', ['boost:', 'seed:']);
$boostFactor = isset($cliOptions['boost']) ? max(0.1, (float) $cliOptions['boost']) : 1.25;

// The same seed gives the same data (relative to today).
mt_srand(isset($cliOptions['seed']) ? (int) $cliOptions['seed'] : 101);

$utc = new DateTimeZone('UTC');
$now = new DateTimeImmutable('now', $utc);
$today = $now->setTime(0, 0);
$start = new DateTimeImmutable('2026-04-01', $utc);
$activityStart = new DateTimeImmutable('2026-08-01', $utc);
$monthStart = $today->modify('first day of this month');
$currency = $config->get('defaultCurrency') ?: 'USD';

// ---------------------------------------------------------------------------------------------
// Users, teams, pipeline.
// ---------------------------------------------------------------------------------------------

$users = [];

foreach ($em->getRDBRepository('User')->where(['isActive' => true, 'type' => ['admin', 'regular']])->find() as $user) {
    $users[$user->get('userName')] = [
        'id' => $user->getId(),
        'teamsIds' => array_values(array_map(
            fn ($team) => $team->getId(),
            iterator_to_array($em->getRDBRepository('User')->getRelation($user, 'teams')->find())
        )),
    ];
}

// Who does what: the admin (the person looking at the demo) gets a good share.
$weights = [
    'sales' => ['admin' => 4, 'sophie.laurent' => 3, 'thomas.bernard' => 3, 'claire.moreau' => 1, 'test' => 1],
    'support' => ['claire.moreau' => 5, 'admin' => 2, 'thomas.bernard' => 1],
];

$pipeline = $em->getRDBRepository('Pipeline')
    ->where(['entityType' => 'Lead', 'status' => 'Active'])
    ->order('order')
    ->findOne();

$stageByStatus = [];

if ($pipeline) {
    foreach ($em->getRDBRepository('PipelineStage')->where(['pipelineId' => $pipeline->getId()])->find() as $stage) {
        $stageByStatus[$stage->get('mappedStatus')] = $stage->getId();
    }
}

// ---------------------------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------------------------

function chance(float $probability): bool
{
    return mt_rand() / mt_getrandmax() < $probability;
}

function pick(array $list): mixed
{
    return $list[mt_rand(0, count($list) - 1)];
}

/** @param array<string, int> $weights */
function pickWeighted(array $weights): string
{
    $total = array_sum($weights);
    $value = mt_rand(1, $total);

    foreach ($weights as $key => $weight) {
        $value -= $weight;

        if ($value <= 0) {
            return $key;
        }
    }

    return array_key_first($weights);
}

function poisson(float $lambda): int
{
    $limit = exp(-$lambda);
    $k = 0;
    $p = 1.0;

    do {
        $k++;
        $p *= mt_rand() / mt_getrandmax();
    } while ($p > $limit);

    return $k - 1;
}

/**
 * How many records on a day: grows linearly from $from to $to over the period, fewer at weekends.
 */
function dailyCount(DateTimeImmutable $day, DateTimeImmutable $start, DateTimeImmutable $end, float $from, float $to): int
{
    $total = max(1, $end->getTimestamp() - $start->getTimestamp());
    $ratio = ($day->getTimestamp() - $start->getTimestamp()) / $total;
    $rate = $from + ($to - $from) * max(0, min(1, $ratio));

    if ((int) $day->format('N') >= 6) {
        $rate *= 0.15;
    }

    return poisson($rate);
}

/** A working-hours time on that day. */
function at(DateTimeImmutable $day, int $fromHour = 8, int $toHour = 18): DateTimeImmutable
{
    return $day->setTime(mt_rand($fromHour, $toHour - 1), pick([0, 0, 15, 30, 30, 45]));
}

function days(DateTimeImmutable $from, DateTimeImmutable $to): Generator
{
    for ($day = $from; $day <= $to; $day = $day->modify('+1 day')) {
        yield $day;
    }
}

/**
 * $from moved by $modify, or a random moment between $from and now when that falls in the future
 * (clamping to now would pile everything up today).
 */
function later(DateTimeImmutable $from, string $modify, DateTimeImmutable $now): DateTimeImmutable
{
    $value = $from->modify($modify);

    if ($value <= $now) {
        return $value;
    }

    $span = max(0, $now->getTimestamp() - $from->getTimestamp());

    return $from->modify('+' . mt_rand(0, $span) . ' seconds');
}

/** A text that depends on the record only: the random sequence, hence the figures, stay the same. */
function textFor(array $list, string $seed): string
{
    return $list[crc32($seed) % count($list)];
}

function format(DateTimeImmutable $value): string
{
    return $value->format('Y-m-d H:i:s');
}

$created = [];

/**
 * Saves silently, then sets the creation date and author, and the $forced attributes: EspoCRM
 * dates records (and a task's completion) at the moment they are saved.
 *
 * @param array<string, mixed> $data
 * @param array<string, mixed> $forced
 */
function create(
    EntityManager $em,
    string $entityType,
    array $data,
    DateTimeImmutable $createdAt,
    array &$created,
    array $forced = []
): string {
    $entity = $em->getNewEntity($entityType);
    $entity->set($data + [$entityType === 'Email' ? 'body' : 'description' => DESCRIPTION]);

    $em->saveEntity($entity, ['silent' => true]);

    $update = $em->getQueryBuilder()
        ->update()
        ->in($entityType)
        ->set([
            'createdAt' => format($createdAt),
            'modifiedAt' => format($createdAt),
            'createdById' => $data['assignedUserId'] ?? ($data['usersIds'][0] ?? null),
            ...$forced,
        ])
        ->where(['id' => $entity->getId()])
        ->build();

    $em->getQueryExecutor()->execute($update);

    $created[$entityType][] = $entity->getId();

    return $entity->getId();
}

/** @return array{assignedUserId: string, teamsIds: string[]} */
function owner(array $users, array $weights): array
{
    $available = array_intersect_key($weights, $users) ?: array_fill_keys(array_keys($users), 1);
    $user = $users[pickWeighted($available)];

    return ['assignedUserId' => $user['id'], 'teamsIds' => $user['teamsIds']];
}

// ---------------------------------------------------------------------------------------------
// Vocabulary.
// ---------------------------------------------------------------------------------------------

$firstNames = ['Camille', 'Léa', 'Manon', 'Chloé', 'Inès', 'Sarah', 'Julie', 'Emma', 'Clara', 'Lucie', 'Hugo', 'Lucas',
    'Louis', 'Nathan', 'Théo', 'Antoine', 'Maxime', 'Julien', 'Nicolas', 'Paul', 'Mathilde', 'Pauline', 'Élise',
    'Romain', 'Thomas', 'Adrien', 'Margaux', 'Céline', 'Olivier', 'Sophie'];
$lastNames = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau',
    'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel',
    'Girard', 'André', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand', 'Garnier',
    'Faure', 'Rousseau', 'Blanc', 'Guerin', 'Muller', 'Henry', 'Roussel', 'Nicolas', 'Perrin'];
$companyPrefixes = ['Atelier', 'Groupe', 'Maison', 'Studio', 'Laboratoires', 'Éditions', 'Transports', 'Cabinet',
    'Domaine', 'Fonderie', 'Brasserie', 'Imprimerie', 'Menuiserie', 'Optique', 'Agence'];
$companyNames = ['Lumière', 'Horizon', 'Boréal', 'Sésame', 'Alizé', 'Cèdre', 'Vauban', 'Garance', 'Opale', 'Mistral',
    'Azur', 'Colbert', 'Arcane', 'Pégase', 'Orée', 'Lys', 'Tramontane', 'Céleste', 'Ondine', 'Granit', 'Saule',
    'Rivage', 'Phare', 'Comète', 'Sirocco'];
$cities = ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nantes', 'Bordeaux', 'Lille', 'Rennes', 'Strasbourg',
    'Montpellier', 'Grenoble', 'Dijon', 'Angers', 'Tours', 'Clermont-Ferrand'];
$industries = ['Consulting', 'Construction', 'Education', 'Electronics', 'Computer', 'Creative', 'Agriculture',
    'Architecture', 'Banking', 'Biotechnology', 'Automotive', 'Culture'];
$sources = ['Call', 'Email', 'Existing Customer', 'Partner', 'Public Relations', 'Web Site', 'Web Site', 'Campaign'];

// Record names follow the system language: French, or English otherwise.
$french = str_starts_with((string) $config->get('language'), 'fr');

$titles = $french ?
    ['Directrice générale', 'Directeur commercial', 'Responsable achats', 'Office manager', 'DSI',
        'Responsable marketing', 'Gérant', 'Chargée de projet', 'Directeur financier', 'Assistante de direction'] :
    ['CEO', 'Sales Director', 'Head of Purchasing', 'Office Manager', 'CIO', 'Marketing Manager', 'Managing Director',
        'Project Manager', 'CFO', 'Executive Assistant'];
$offers = $french ?
    ['Abonnement annuel', 'Déploiement', 'Formation des équipes', 'Licences supplémentaires', 'Accompagnement',
        'Migration des données', 'Support premium', 'Extension du contrat', 'Audit', 'Pack démarrage'] :
    ['Annual subscription', 'Rollout', 'Team training', 'Additional licences', 'Consulting', 'Data migration',
        'Premium support', 'Contract extension', 'Audit', 'Starter pack'];
$callTopics = $french ?
    ['Premier contact', 'Relance devis', 'Point d\'avancement', 'Qualification du besoin', 'Suivi commande',
        'Prise de rendez-vous', 'Retour sur la démo', 'Renouvellement'] :
    ['First contact', 'Quote follow-up', 'Status update', 'Needs assessment', 'Order follow-up',
        'Booking a meeting', 'Demo feedback', 'Renewal'];
$callNotes = $french ?
    ['Intéressé, attend le devis révisé avant de décider.', 'Budget validé en interne, signature visée ce trimestre.',
        'Veut comparer avec son prestataire actuel, à rappeler après sa réunion.',
        'Questions sur les délais de mise en place, réponses envoyées par e-mail.',
        'Très satisfait du dernier échange, souhaite associer sa direction.',
        'Demande une remise pour un engagement sur deux ans.'] :
    ['Interested, waiting for the revised quote before deciding.', 'Budget approved internally, aiming to sign this quarter.',
        'Wants to compare with the current supplier, call back after their meeting.',
        'Questions about rollout time, answers sent by email.',
        'Very happy with our last exchange, wants to involve management.',
        'Asking for a discount on a two-year commitment.'];

$missedCallNotes = $french ?
    ['Messagerie, message laissé.', 'Pas de réponse, réessayer en fin de journée.', 'Absent jusqu\'à lundi selon le standard.'] :
    ['Voicemail, message left.', 'No answer, try again late in the day.', 'Away until Monday according to reception.'];

$meetingNotes = $french ?
    ['Démonstration appréciée, deux points à préciser sur l\'intégration.', 'Périmètre validé, planning à confirmer sous huitaine.',
        'Décideur présent, attend une proposition chiffrée.', 'Bon accueil de l\'équipe, pilote envisagé sur un service.'] :
    ['Demo went well, two integration points to clarify.', 'Scope approved, schedule to confirm within a week.',
        'Decision maker attended, expects a priced proposal.', 'Warm welcome from the team, pilot considered in one department.'];

$emailBodies = $french ?
    ['Bonjour, vous trouverez ci-joint notre proposition mise à jour. Je reste disponible pour en parler.',
        'Merci pour votre temps. Comme convenu, voici le récapitulatif de notre échange et les prochaines étapes.',
        'Bonjour, voici les documents demandés. N\'hésitez pas à revenir vers moi si un élément manque.'] :
    ['Hello, please find our updated proposal attached. Happy to talk it through.',
        'Thank you for your time. As agreed, here is a summary of our discussion and the next steps.',
        'Hello, here are the documents you asked for. Let me know if anything is missing.'];

$meetingTopics = $french ?
    ['Démonstration', 'Atelier de cadrage', 'Revue de projet', 'Présentation de l\'offre', 'Comité de pilotage',
        'Signature', 'Lancement'] :
    ['Product demo', 'Scoping workshop', 'Project review', 'Proposal presentation', 'Steering committee',
        'Contract signing', 'Kick-off'];
$taskTopics = $french ?
    ['Envoyer le devis', 'Préparer la démo', 'Mettre à jour la fiche', 'Relancer le contact',
        'Rédiger la proposition', 'Planifier la formation', 'Vérifier la facturation', 'Préparer le compte rendu'] :
    ['Send the quote', 'Prepare the demo', 'Update the account', 'Follow up with the contact', 'Write the proposal',
        'Schedule the training', 'Check the invoicing', 'Write the meeting notes'];
$caseTopics = $french ?
    ['Accès impossible', 'Erreur à l\'export', 'Question sur la facture', 'Demande de formation',
        'Lenteur de l\'application', 'Import de contacts', 'Mot de passe oublié', 'Synchronisation des emails',
        'Droits d\'accès', 'Champ manquant dans le formulaire'] :
    ['Cannot log in', 'Export error', 'Invoice question', 'Training request', 'Application is slow',
        'Contact import', 'Forgotten password', 'Email sync', 'Access rights', 'Missing field in the form'];

$usedCompanyNames = [];

$companyName = function () use ($companyPrefixes, $companyNames, $lastNames, &$usedCompanyNames): string {
    do {
        $name = chance(0.6) ?
            pick($companyPrefixes) . ' ' . pick($companyNames) :
            pick($companyNames) . ' & ' . pick($lastNames);
    } while (isset($usedCompanyNames[$name]));

    $usedCompanyNames[$name] = true;

    return $name;
};

$email = fn (string $first, string $last, string $company) =>
    strtolower(
        iconv('UTF-8', 'ASCII//TRANSLIT', $first) . '.' . iconv('UTF-8', 'ASCII//TRANSLIT', $last) . '@' .
        preg_replace('/[^a-z]/', '', strtolower(iconv('UTF-8', 'ASCII//TRANSLIT', $company)))
    ) . '.example';

// ---------------------------------------------------------------------------------------------
// Accounts and contacts.
// ---------------------------------------------------------------------------------------------

$phone = fn () => '+3319900' . str_pad((string) mt_rand(0, 9999), 4, '0', STR_PAD_LEFT);

$accounts = [];

foreach (days($start, $today) as $day) {
    for ($i = dailyCount($day, $start, $today, 0.25, 0.55); $i > 0; $i--) {
        $createdAt = at($day);

        if ($createdAt > $now) {
            continue;
        }

        $name = $companyName();
        $owner = owner($users, $weights['sales']);

        $id = create($em, 'Account', [
            'name' => $name,
            'type' => pickWeighted(['Customer' => 6, 'Partner' => 2, 'Reseller' => 1, 'Investor' => 1]),
            'industry' => pick($industries),
            'billingAddressCity' => pick($cities),
            'billingAddressCountry' => 'France',
            'phoneNumber' => $phone(),
            'website' => 'https://www.' . preg_replace('/[^a-z]/', '', strtolower(iconv('UTF-8', 'ASCII//TRANSLIT', $name))) . '.example',
        ] + $owner, $createdAt, $created);

        $contactIds = [];

        for ($c = mt_rand(1, 3); $c > 0; $c--) {
            $first = pick($firstNames);
            $last = pick($lastNames);
            $contactCreatedAt = later($createdAt, '+' . mt_rand(0, 10) . ' days', $now);

            $contactIds[] = create($em, 'Contact', [
                'firstName' => $first,
                'lastName' => $last,
                'title' => pick($titles),
                'accountId' => $id,
                'emailAddress' => $email($first, $last, $name),
                'phoneNumber' => $phone(),
                'addressCity' => pick($cities),
            ] + $owner, $contactCreatedAt, $created);
        }

        // Some accounts go quiet: their deals are the ones to follow up.
        $accounts[] = [
            'id' => $id,
            'name' => $name,
            'createdAt' => $createdAt,
            'contactIds' => $contactIds,
            'quiet' => chance(0.3),
        ] + $owner;
    }
}

$quietSince = $today->modify('-21 days');

/** An account for an activity on that date: quiet accounts have no recent activity. */
$accountForActivity = function (DateTimeImmutable $date) use ($accounts, $now, $quietSince): ?array {
    $limit = min($date, $now);

    $candidates = array_values(array_filter(
        $accounts,
        fn ($account) => $account['createdAt'] <= $limit && (!$account['quiet'] || $date < $quietSince)
    ));

    return $candidates ? pick($candidates) : null;
};

$accountsUntil = fn (DateTimeImmutable $date) => array_values(array_filter($accounts, fn ($a) => $a['createdAt'] <= $date));

// ---------------------------------------------------------------------------------------------
// Leads.
// ---------------------------------------------------------------------------------------------

foreach (days($start, $today) as $day) {
    // A busy current month, for a demo that starts well.
    $boost = $day >= $monthStart ? $boostFactor : 1;

    for ($i = dailyCount($day, $start, $today, 0.5 * $boost, 1.6 * $boost); $i > 0; $i--) {
        $createdAt = at($day);

        if ($createdAt > $now) {
            continue;
        }

        $ageDays = (int) $createdAt->diff($now)->days;

        // Older leads have moved on; recent ones are still being worked.
        $status = $ageDays > 25 ?
            pickWeighted(['Converted' => 4, 'Dead' => 2, 'Recycled' => 1, 'In Process' => 2, 'Assigned' => 1]) :
            ($ageDays > 7 ?
                pickWeighted(['In Process' => 4, 'Assigned' => 3, 'Converted' => 2, 'New' => 1, 'Dead' => 1]) :
                pickWeighted(['New' => 5, 'Assigned' => 3, 'In Process' => 1]));

        $data = [
            'firstName' => pick($firstNames),
            'lastName' => pick($lastNames),
            'accountName' => $companyName(),
            'title' => pick($titles),
            'source' => pick($sources),
            'status' => $status,
            'addressCity' => pick($cities),
            'opportunityAmount' => chance(0.5) ? mt_rand(4, 80) * 500 : null,
            'opportunityAmountCurrency' => $currency,
        ] + owner($users, $weights['sales']);

        $data['emailAddress'] = $email($data['firstName'], $data['lastName'], $data['accountName']);
        $data['phoneNumber'] = $phone();

        if ($pipeline && isset($stageByStatus[$status])) {
            $data['pipelineId'] = $pipeline->getId();
            $data['pipelineStageId'] = $stageByStatus[$status];
        }

        if ($status === 'Converted') {
            $data['convertedAt'] = format(later($createdAt, '+' . mt_rand(2, 20) . ' days', $now));
        }

        $leadId = create($em, 'Lead', $data, $createdAt, $created);

        // Leads being worked have been called; the new ones are still waiting.
        if ($status !== 'New') {
            $callDate = later($createdAt, '+' . mt_rand(0, 3) . ' days', $now);

            create($em, 'Call', [
                'name' => pick($callTopics) . ' — ' . $data['lastName'],
                'status' => 'Held',
                'direction' => 'Outbound',
                'dateStart' => format($callDate),
                'dateEnd' => format($callDate->modify('+10 minutes')),
                'parentType' => 'Lead',
                'parentId' => $leadId,
                'leadsIds' => [$leadId],
                'assignedUserId' => $data['assignedUserId'],
                'teamsIds' => $data['teamsIds'],
                'usersIds' => [$data['assignedUserId']],
                'description' => textFor($callNotes, $leadId),
            ], $callDate, $created);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Opportunities: closed ones in the past, open ones closing in the coming weeks.
// ---------------------------------------------------------------------------------------------

$probability = ['Prospecting' => 10, 'Qualification' => 20, 'Proposal' => 50, 'Negotiation' => 80,
    'Closed Won' => 100, 'Closed Lost' => 0];

foreach (days($start, $today) as $day) {
    for ($i = dailyCount($day, $start, $today, 0.3, 1.0); $i > 0; $i--) {
        $createdAt = at($day);
        $candidates = $accountsUntil($createdAt);

        if ($createdAt > $now || !$candidates) {
            continue;
        }

        $account = pick($candidates);
        $closeDate = $createdAt->modify('+' . mt_rand(10, 60) . ' days')->setTime(0, 0);

        // The team gets better: the win rate goes from 45 % in April to 70 % today.
        $winRate = 45 + (int) round(25 * ($closeDate->getTimestamp() - $start->getTimestamp()) /
            max(1, $today->getTimestamp() - $start->getTimestamp()));

        $stage = $closeDate <= $today ?
            pickWeighted(['Closed Won' => $winRate, 'Closed Lost' => 100 - $winRate]) :
            pickWeighted(['Prospecting' => 3, 'Qualification' => 3, 'Proposal' => 3, 'Negotiation' => 2]);

        create($em, 'Opportunity', [
            'name' => pick($offers) . ' — ' . $account['name'],
            'accountId' => $account['id'],
            'contactId' => $account['contactIds'][0] ?? null,
            'amount' => mt_rand(2, 14) * 500,
            'amountCurrency' => $currency,
            'stage' => $stage,
            'probability' => $probability[$stage],
            'closeDate' => $closeDate->format('Y-m-d'),
            'leadSource' => pick($sources),
            'assignedUserId' => $account['assignedUserId'],
            'teamsIds' => $account['teamsIds'],
        ], $createdAt, $created);
    }
}

// ---------------------------------------------------------------------------------------------
// Calls and meetings: held in the past, planned in the next two weeks.
// ---------------------------------------------------------------------------------------------

$activityEnd = $today->modify('+14 days');

foreach (['Call', 'Meeting'] as $entityType) {
    foreach (days($activityStart, $activityEnd) as $day) {
        foreach ($users as $userName => $user) {
            $base = $userName === 'admin' ? 2.3 : ($userName === 'test' ? 0.4 : 1.1);
            $base = $entityType === 'Meeting' ? $base * 0.25 : $base;

            for ($i = dailyCount($day, $activityStart, $today, $base * 0.6, $base); $i > 0; $i--) {
                $dateStart = at($day, 8, 18);
                $isPast = $dateStart <= $now;
                $account = $accountForActivity($dateStart);

                if (!$account) {
                    continue;
                }

                $minutes = $entityType === 'Call' ? pick([5, 10, 15, 15, 20, 30]) : pick([30, 45, 60, 60, 90]);

                $status = $isPast ?
                    (chance(0.1) ? 'Not Held' : 'Held') :
                    'Planned';

                $data = [
                    'name' => ($entityType === 'Call' ? pick($callTopics) : pick($meetingTopics)) . ' — ' . $account['name'],
                    'status' => $status,
                    'dateStart' => format($dateStart),
                    'dateEnd' => format($dateStart->modify("+$minutes minutes")),
                    'parentType' => 'Account',
                    'parentId' => $account['id'],
                    'assignedUserId' => $user['id'],
                    'teamsIds' => $user['teamsIds'],
                    'usersIds' => [$user['id']],
                    'contactsIds' => array_slice($account['contactIds'], 0, 1),
                ];

                if ($entityType === 'Call') {
                    $data['direction'] = chance(0.7) ? 'Outbound' : 'Inbound';
                }

                if ($isPast) {
                    $notes = match (true) {
                        $status === 'Not Held' => $missedCallNotes,
                        $entityType === 'Call' => $callNotes,
                        default => $meetingNotes,
                    };

                    $data['description'] = textFor($notes, $data['name'] . $data['dateStart']);
                } else {
                    // A note added when closing it must not follow a demo marker.
                    $data['description'] = null;
                }

                $createdAt = $isPast ? $dateStart : $now->modify('-' . mt_rand(0, 5) . ' days');

                create($em, $entityType, $data, $createdAt, $created);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Emails sent to accounts.
// ---------------------------------------------------------------------------------------------

$emailSubjects = $french ?
    ['Votre proposition', 'Suite à notre échange', 'Compte rendu', 'Documents demandés', 'Prochaines étapes'] :
    ['Your proposal', 'Following our call', 'Meeting notes', 'The documents you asked for', 'Next steps'];

foreach (days($activityStart, $today) as $day) {
    foreach ($users as $user) {
        for ($i = dailyCount($day, $activityStart, $today, 0.2, 0.4); $i > 0; $i--) {
            $sentAt = at($day);
            $account = $accountForActivity($sentAt);

            if ($sentAt > $now || !$account) {
                continue;
            }

            create($em, 'Email', [
                'name' => pick($emailSubjects),
                'status' => 'Sent',
                'dateSent' => format($sentAt),
                'isHtml' => false,
                'body' => textFor($emailBodies, $account['id'] . format($sentAt)),
                'parentType' => 'Account',
                'parentId' => $account['id'],
                'usersIds' => [$user['id']],
                'assignedUsersIds' => [$user['id']],
                'teamsIds' => $user['teamsIds'],
            ], $sentAt, $created);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Tasks: mostly completed, a few overdue, some ahead.
// ---------------------------------------------------------------------------------------------

foreach (days($activityStart, $today) as $day) {
    for ($i = dailyCount($day, $activityStart, $today, 0.8, 1.6); $i > 0; $i--) {
        $createdAt = at($day);
        $candidates = $accountsUntil($createdAt);

        if ($createdAt > $now || !$candidates) {
            continue;
        }

        $account = pick($candidates);
        $owner = owner($users, $weights['sales']);
        $dateEnd = at($createdAt->modify('+' . mt_rand(1, 14) . ' days'));

        $data = [
            'name' => pick($taskTopics) . ' — ' . $account['name'],
            'priority' => pickWeighted(['Low' => 2, 'Normal' => 5, 'High' => 2, 'Urgent' => 1]),
            'dateEnd' => format($dateEnd),
            'parentType' => 'Account',
            'parentId' => $account['id'],
        ] + $owner;

        if ($dateEnd <= $now) {
            if (chance(0.85)) {
                $data['status'] = 'Completed';
                // Done before the due date, or a little after.
                $data['dateCompleted'] = format(later($createdAt, '+' . mt_rand(1, (int) $createdAt->diff($dateEnd)->days + 2) . ' days', $now));
            } else {
                $data['status'] = pick(['Not Started', 'Started']);
            }
        } else {
            $completedEarly = chance(0.3);

            $data['status'] = $completedEarly ? 'Completed' : pick(['Not Started', 'Started']);

            if ($completedEarly) {
                $data['dateCompleted'] = format(later($createdAt, '+' . mt_rand(0, 2) . ' days', $now));
            }
        }

        create($em, 'Task', $data, $createdAt, $created, array_intersect_key($data, ['dateCompleted' => true]));
    }
}

// ---------------------------------------------------------------------------------------------
// Cases: the older ones are closed.
// ---------------------------------------------------------------------------------------------

foreach (days($activityStart, $today) as $day) {
    for ($i = dailyCount($day, $activityStart, $today, 0.35, 0.8); $i > 0; $i--) {
        $createdAt = at($day);
        $candidates = $accountsUntil($createdAt);

        if ($createdAt > $now || !$candidates) {
            continue;
        }

        $ageDays = (int) $createdAt->diff($now)->days;

        $status = $ageDays > 10 ?
            pickWeighted(['Closed' => 8, 'Rejected' => 1, 'Pending' => 1]) :
            pickWeighted(['New' => 3, 'Assigned' => 3, 'Pending' => 1, 'Closed' => 1]);

        create($em, 'Case', [
            'name' => pick($caseTopics),
            'status' => $status,
            'priority' => pickWeighted(['Low' => 2, 'Normal' => 5, 'High' => 2, 'Urgent' => 1]),
            'type' => pick(['Question', 'Incident', 'Problem']),
            'accountId' => pick($candidates)['id'],
        ] + owner($users, $weights['support']), $createdAt, $created);
    }
}

$counts = array_map('count', $created);

echo json_encode(['created' => $counts, 'total' => array_sum($counts)], JSON_PRETTY_PRINT), "\n";
