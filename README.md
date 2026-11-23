# Live Dashlets for EspoCRM

**Key figures and goals that bring the EspoCRM dashboard to life.** Each tile shows a trend, a curve and the records behind it, and you add them in one click. Every figure respects the access rights of the person looking at it.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
![EspoCRM 10.0.3+](https://img.shields.io/badge/EspoCRM-10.0.3%2B-5c7cfa.svg)
![PHP 8.3+](https://img.shields.io/badge/PHP-8.3%2B-777bb4.svg)

![A dashboard built with Live Dashlets](docs/screenshots/dashboard.png)

## Why Live Dashlets

Out of the box, EspoCRM dashboards offer record lists, the stream, a calendar and four charts that only cover opportunities. There is no "how many leads this month, and is that better than last month?" tile, and no goal tracking, unless you write reports or code.

Live Dashlets adds two dashlet types, **Key Figure** and **Goal**, which you configure in their options without writing code. It also makes the dashboard quicker to fill: a gallery of 16 ready-made indicators shows your real figures before you add them.

- **One click to add.** A visible "+ Add" button opens a gallery of ready-made indicators with live previews. A click puts the indicator on the dashboard, already set up.
- **Figures that tell a story.** Each figure shows its change against the same point of the previous period, as a badge and as a cumulative curve.
- **One click to drill down.** Clicking a tile lists the records behind the figure.
- **Same permissions as everywhere else.** Two people can see different numbers on the same tile, because each one only counts the records they are allowed to read.

## Features

### A gallery of ready-made indicators

Click **+ Add** on the dashboard, or **Add Dashlet** in its menu. The gallery starts with **Next Actions** and **What happened**, followed by 16 indicators in five groups: Prospecting, Sales, Activities, Support, and Accounts and contacts. Each card already shows your figure, its trend and its curve. One click adds the indicator to the top of the dashboard, titled in your language; add as many as you like, then click **Done**.

New tiles line up from left to right after the small tiles at the top of the dashboard. A tall dashlet in the way (a stream, a list) moves down one row. The gallery only offers indicators on data you can read. Its **Build your own** section adds an empty Key Figure or Goal, and links to the full list of EspoCRM dashlets.

![The gallery of ready-made indicators](docs/screenshots/gallery.png)

### Key Figure

A large number with the entity icon, the period and the change against the previous period, for example "27 new leads this month, +50 %, +9 vs 18 by Oct 17". The change is given both as a percentage and as a value.

- **What the figure counts.** Resting the pointer on the tile's title, or giving it the keyboard focus, shows the entity and filters, what is counted or added up, the dates of the period and of the comparison, and a reminder that only the records you can read are counted. It opens on hover, keyboard focus or a tap.
- **A fair comparison.** By default, the previous period is cut at the same point: on November 17, this month is compared with October 1 to 17. You can also compare with the whole previous period, or turn the comparison off.
- **The curve of the period.** It shows the cumulative value day by day: the current period in color, the previous one as a thin grey line. Hover the curve to read both values on a given day.
- **When a decrease is good news.** The option of that name turns falling figures green, for things you want to see go down, such as open cases or overdue tasks.

![Hovering the curve shows the value on that day and the previous period's](docs/screenshots/tooltip.png)

### Goal

A progress bar toward a target, with:
- a marker showing where you should be at this point of the period;
- a status: **On track**, **Behind** or **Reached**, which the bar also shows: green when on track or reached, amber when behind;
- what is left to do and the number of days left.

### The records behind a figure

Click a tile, or press Enter when it has focus, to list the records it counts. The list uses the same filters and period, and the standard list API, so the same permissions. It shows the name, the added-up amount, the date that places the record in the period, and the assigned user, most recent first.

![Clicking "Won this quarter" lists the deals behind the amount](docs/screenshots/records.png)

### Next Actions

A dashlet that turns the dashboard into a to-do list for the day: who to contact, why, and a button to do it. It shows the current user's own records, ranked by urgency and stake:

![Next Actions: who to contact, why, and a button to do it](docs/screenshots/next-actions.png)

| Situation | Reason shown | Main action |
|---|---|---|
| Task overdue or due today | "3 days overdue" | Complete |
| Call or meeting today, or planned and never closed | "Today at 2:30 PM" | Call, open or close out |
| New lead never contacted | "Created yesterday, never contacted" | Call |
| Open deal without a recent exchange | "Last recorded exchange 18 days ago · $12,000" | Call |
| Meeting held without a next step | "Demo on Nov 16, no next step planned" | Plan the next step |

- **Why, in one line.** Under the reason, each row says what the action is about: the details of the task, the agenda of the call or the meeting, what the lead wrote, the notes of the meeting held, or, for a deal, the last exchange ("Email on Nov 7: Quote attached"). The line only uses fields the user may read, and stays out when there is nothing to say. Folded, the list keeps to the size of the dashlet; the rows that no longer fit go under **Show more**.
- **Call** dials the number and also shows it, ready to copy, then asks in the row how it went (answered, no answer, message left) and what comes next. Saving records the call and creates the follow-up.
- **The menu** sends an email through EspoCRM's composer (nothing is sent automatically), postpones to the next working day, next Monday, next week or a date you pick, schedules a reminder or opens the record.
- **A row leaves the list** once it is handled, or when a next step is planned for that record.

![The call panel shows the number and the last exchange](docs/screenshots/next-actions-call.png)

- **The last exchange** appears when you are about to call or close out a meeting: its type, date, author and note.
- **Undo** stays available for 8 seconds after completing, postponing or saving a call, and longer while the pointer is on it. It also removes what the action created.
- **What you just did stays in view.** A card takes the place of the row, with the person, the result, your note and the tasks added, all clickable. **Done today** lists the day's work and survives a reload.

![After a call: the result, the note, the follow-up task and Undo](docs/screenshots/next-actions-done.png)

- **To sort out** gathers tasks overdue by more than 30 days (adjustable) at the bottom of the dashlet, out of the daily list. They can be reviewed one by one or closed together, after a confirmation, and this too can be undone.
- **"Last exchange"** is computed from the held calls and meetings and the emails linked to the record, its account or its contacts, among those the user is allowed to read. It is only as complete as what is recorded in the CRM.

### What happened

A dashlet that answers "what happened recently?": calls and meetings held, emails, contacts and accounts added, deals won or lost, tasks completed. One line per event says who, what, the result and the time; a click shows the rest.

- **One line per event.** The person and their company, the result ("Answered", "No answer", "Won · $5,120") and the time, grouped by day.
- **The details on a click.** What was written about the call, the meeting or the email, who did it, how long it lasted, and the next step planned on the same record.
- **Notes on demand.** The **Notes** switch adds the first line of each note under the name, for those who want more at a glance.
- **Whose actions.** Me, My team (by default), or Everything I can see, from the narrowest to the widest. Without a team, only your own actions are shown. The type menu narrows the list to calls, meetings, emails, additions, deals or tasks.
- **What's new.** A blue dot marks what arrived since your last visit.
- **Only what matters.** Emails count only when they are linked to an account, a contact, a lead, a deal or a case. Contacts added together to the same account make one line.

Like everything else, the list only shows records the viewer can read, and it only tells who did something through fields the viewer can read. A deal's time is the time it was last changed, if that was on its close date; otherwise only the day is shown.

### Options without code

| Option | What it does |
|---|---|
| Entity | Any entity you can read, custom entities included |
| Primary filter and additional filters | The entity's own filters, such as "Won", "Open", "Held" or "Only my" |
| Indicator | Number of records, or the sum or average of a number or currency field |
| Period | Today, this week, month, quarter or year, the fiscal quarter or year, the last 7 or 30 days, or all time |
| Date used for the period | Which date places a record in the period: created at, close date, converted at… |
| Compare with | The previous period at the same point, the whole previous period, or nothing |
| Target | For a Goal |
| Highlight | Fills one tile with color to make it stand out |
| Auto-refresh | Every 30 seconds up to every 10 minutes |

![The options of a Key Figure](docs/screenshots/options.png)

### One style for every dashlet

The top of the **+ Add** window sets the style and the color of every Live dashlet at once: the figures and goals, **Next Actions** and **What happened**. The cards of the window preview each style, and a click shows on the dashboard right away; there is nothing to set dashlet by dashlet.

- **Minimal** (the default) stays neutral, with the change in a line under the figure.
- **Outline** draws a line around the dashlet, with no fill or shadow, and sets the figures in a monospaced font.
- **Big figure** lets the number fill the tile in a narrow font, with the change beside it and the comparison below; a goal reads as 20 segments. Its font ships with the extension (Barlow Condensed, SIL Open Font License), so nothing is loaded from outside EspoCRM.
- **Highlight**, in a tile's options, fills that one tile with color. Keep it for one headline figure per dashboard.

An administrator makes the current choice the company's with **Apply to the whole company**. Each user can choose another one for their own dashboard, and go back to the company's at any time.

Green, amber and red keep their meaning on every style: they are left to trends and statuses.

### One team at a time

For someone in several teams, the same line of the **+ Add** window chooses whose work the dashboard shows: all of their teams, or one of them. Figures, goals, the records behind them and the **Team** view of What happened then count only the records assigned to a member of that team, and each tile names the team beside its period. Next Actions stays personal. The choice is kept for each user, and the server ignores a team the user is not in.

![The top of the + Add window sets the style and the color of every dashlet](docs/screenshots/styles.png)

Colors come from the active theme, so tiles follow light and dark themes. The layout adapts to the height of the tile, which varies from one theme to another.

![The same dashboard with EspoCRM's Dark theme](docs/screenshots/dashboard-dark.png)

### A ready-made dashboard template

Installing the extension creates a **Live dashboard** template in **Administration → Dashboard Templates**. On a new installation it contains:
- the next actions;
- new and converted leads this month;
- the amount won this quarter, highlighted;
- open cases;
- two goals, "My calls this month" and "Quarterly revenue";
- the stream and tasks.

Adjust the targets, then deploy it. EspoCRM deploys a template to the users or the team you choose; the extension adds **Deploy to Everyone** to every template, which gives it to all active users in one click:
- their own tabs are kept, unless you choose to replace them;
- deploying again resets the tab they got to the template, layout and dashlet settings included, instead of adding it a second time, including a tab deployed by an earlier version. That is how new goal targets reach everyone; changes users made to that tab are replaced, as with EspoCRM's own deployment;
- you can lock the dashboard of regular users (not administrators): dashlets can then no longer be added, moved or resized. As with EspoCRM's own lock, each user can still unlock it from **Edit Dashboard**.

Nothing is imposed on anyone until you deploy.

### Details that matter

- **Animations.** Figures count up, curves draw themselves, bars fill in, and a reached goal gets a light sweep. Nothing loops. Nothing moves when the system asks for reduced motion.
- **Time zones and calendars.** Periods follow each user's time zone and first day of the week, and the fiscal year setting.
- **Currencies.** Amounts are added up in the default currency, like EspoCRM's own charts, and displayed with the system's currency format and separators.
- **Languages.** English and French.

## Permissions and privacy

- Next Actions lists the user's own records through the same strict access control. Its buttons call EspoCRM's standard API, and they only appear when the user is allowed to act: no phone number without read access to the field, no call button without the right to create or edit calls.
- The server checks read access to the entity and to every field used (the added-up field and the date field). Records are selected with EspoCRM's strict access control, the same as list views. A sales rep with "own" access only counts their own leads.
- The option lists and the gallery only offer entities and fields the user can read. A tile on an entity the user cannot read says so, without sending a request.
- Nothing leaves your EspoCRM: no external service, no tracking.

## Installation

1. Download `live-dashlets-1.4.2.zip` from the [latest release](../../releases/latest).
2. In EspoCRM, go to **Administration → Extensions**, upload the ZIP and click **Install**.
3. Optional: in **Administration → Dashboard Templates**, open **Live dashboard**, adjust the goal targets and deploy it, to chosen users or with **Deploy to Everyone**.

Requirements: EspoCRM 10.0.3 or later, PHP 8.3 or later. Tested on EspoCRM 10.0.3 and 10.0.11.

To update, install the new ZIP over the old one. To uninstall, go to **Administration → Extensions**: the template is removed, and dashboards already deployed keep working (EspoCRM skips dashlets that no longer exist).

## Adding your own ready-made indicators

The gallery is defined in metadata, so you can add company-specific indicators without code, for example in `custom/Espo/Custom/Resources/metadata/app/liveDashlets.json`:

```json
{
    "presetList": [
        "__APPEND__",
        {
            "name": "bigDeals",
            "group": "sales",
            "dashlet": "LiveDashletsKpi",
            "width": 1,
            "height": 1,
            "options": {
                "entityType": "Opportunity",
                "primaryFilter": "won",
                "metric": "count",
                "dateField": "closeDate",
                "period": "currentQuarter",
                "comparison": "toDate"
            }
        }
    ]
}
```

Give it a title in `custom/Espo/Custom/Resources/i18n/en_US/LiveDashlets.json` (`{"presets": {"bigDeals": "Big deals"}}`), then clear the cache.

## How it works

- **Figures.** `GET LiveDashlets/metric` selects the ids of the readable records with EspoCRM's select builder (strict access control, primary and bool filters, period), then aggregates them with `COUNT`, `SUM` or `AVG` through `id IN (subquery)`. A join added by a filter therefore cannot count a record twice.
- **Curves.** With `series=true`, the endpoint also returns cumulative values per day, or per hour for "Today". They are grouped in SQL in the user's time zone.
- **Next actions.** `GET LiveDashlets/actions` builds the list on request; nothing is stored. Changes go through the standard record API, with its validation and hooks.
- **Dashboard.** `clientDefs.Home.view` points the home page to a view that extends EspoCRM's dashboard and adds the gallery. If another extension also replaces the home dashboard view, only one of them can be active.
- **Records list.** The modal queries the standard list API with `primary`, `bool` and `between` where items. It passes the user's time zone explicitly, so the list matches the figure.
- **Packaging.** The front end ships as a bundle declared in `app/client.json`.

## Development

The project uses [espo-extension-tools](https://github.com/espocrm/extension-tools). Point the `site` symlink to an EspoCRM installation, then:

```bash
npm install
npm run sync          # copy src/ to the EspoCRM site
npm run clear-cache   # after a metadata change
npm run extension     # build build/live-dashlets-<version>.zip
```

### Demo data

The screenshots above were taken on EspoCRM 10.0.11 with data from `dev/demo-data.php`, about 1,200 records:
- accounts, contacts, leads and opportunities since April, with phone numbers from a range reserved for fiction;
- calls, meetings, emails, tasks and cases since August, plus planned calls and meetings for the next two weeks.

The data is shared among the active users and their teams, with activity that grows over time. Record names follow the system language (English or French). The records are created silently (no stream entries, no notifications). Leads, deals, tasks and planned calls get a realistic description, or none, as Next Actions shows it. The script lists what it creates in `data/live-dashlets-demo.json`, and marks accounts, contacts and cases "Demo data (Live Dashlets)." in their description, so that `dev/demo-data-remove.php` can delete them, along with every email, call, meeting and task attached to them, including those added since. Neither script is part of the ZIP.

```bash
# From the EspoCRM root, as the web server user. Use only on a test instance.
php demo-data.php [--seed=101] [--boost=1.25]
php demo-data-remove.php
```

`dev/demo-dashboard.php` then adds a showcase to a user's dashboard, as four extra tabs: the next actions, a complete cockpit, every ready-made indicator, and the periods and calculations. The user's own tabs are left untouched.

```bash
php demo-dashboard.php [--user=admin]
php demo-dashboard.php [--user=admin] --remove
```

## License

Copyright (C) 2026 Alexis SANTIN.

Live Dashlets is free software, released under the [GNU Affero General Public License v3.0 or later](LICENSE), the same license as EspoCRM.
