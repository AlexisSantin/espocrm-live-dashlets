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

import EnumFieldView from 'views/fields/enum';

/** Teams listed in the options at most. */
const MAX_TEAMS = 200;

/**
 * Whose records a tile counts: the team chosen for the whole dashboard (the default), everything
 * the user can see, or one team, theirs or another one they may read along with every user. The
 * server checks the team again, and every figure keeps the user's access rights.
 */
class LiveDashletsTeamFieldView extends EnumFieldView {

    setup() {
        super.setup();

        this.wait(this.loadTeams().then(teams => {
            this.teams = teams;
            this.setupOptions();
        }));
    }

    setupOptions() {
        const label = key => this.translate(key, 'labels', 'LiveDashlets');

        this.translatedOptions = {'': label('teamFollow'), all: label('teamAll')};
        this.params.options = ['', 'all'];

        for (const team of this.teams || []) {
            this.translatedOptions[team.id] = team.name;
            this.params.options.push(team.id);
        }

        // A team chosen before and no longer listed (another user's template, a team gone).
        const value = this.model.get(this.name);

        if (value && !this.params.options.includes(value)) {
            this.translatedOptions[value] = this.model.get(this.name + 'Name') || value;
            this.params.options.push(value);
        }
    }

    /**
     * The user's teams first, then the other teams they may read, when they may also read every
     * user (as the server requires: the members of another team are not theirs to know otherwise).
     *
     * @private
     * @return {Promise<{id: string, name: string}[]>}
     */
    async loadTeams() {
        const user = this.getUser();
        const names = user.get('teamsNames') || {};
        const own = (user.get('teamsIds') || []).map(id => ({id, name: names[id] || id}));
        const byName = (a, b) => a.name.localeCompare(b.name);

        own.sort(byName);

        const allUsers = user.isAdmin() || this.getAcl().getLevel('User', 'read') === 'all';

        if (!allUsers || !this.getAcl().checkScope('Team', 'read')) {
            return own;
        }

        let others = [];

        try {
            const response = await Espo.Ajax.getRequest('Team', {
                select: 'id,name',
                orderBy: 'name',
                order: 'asc',
                maxSize: MAX_TEAMS,
            });

            others = (response.list || [])
                .filter(team => !own.some(item => item.id === team.id))
                .map(team => ({id: team.id, name: team.name || team.id}));
        } catch (e) {
            return own;
        }

        return [...own, ...others.sort(byName)];
    }

    fetch() {
        const data = super.fetch();
        const value = data[this.name];

        // The name is kept with the choice, for whoever cannot list that team.
        data[this.name + 'Name'] = value && value !== 'all' ? (this.translatedOptions[value] || null) : null;

        return data;
    }
}

export default LiveDashletsTeamFieldView;
