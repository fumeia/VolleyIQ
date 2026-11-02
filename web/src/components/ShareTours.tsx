import { PassGrades } from './PassGrades';
import type { TourStep } from './Tour';
import { isGerman } from '../lib/i18n';
import { matchTourDe, playerTourDe, statsTourDe, teamTourDe } from './ShareToursDe';

/** The guided tours of the public links: the team link, a player's page and a single match. */

const sections: TourStep = {
  target: '[data-tour="sections"]',
  title: 'Stats by topic',
  text: (
    <ul>
      <li><b>Overview</b>: side-out and break-point %, set by set, what went well and what to work on</li>
      <li><b>Rotations</b>: how each rotation does on serve and on receive</li>
      <li><b>Attack</b>, <b>Serve & pass</b>, <b>Setting</b>, <b>Defence</b>: efficiency, shot directions, pass quality, who sets whom</li>
      <li><b>Errors</b>: how points were given away and how the opponent scored</li>
      <li><b>Players</b>, <b>Tables</b>, <b>Court maps</b>: numbers per player, and where the ball was played</li>
    </ul>
  ),
};
const passes: TourStep = {
  title: 'How passes are graded',
  text: (
    <>
      <p>Every pass gets 0 to 3 from where it went, our half seen from behind the baseline:</p>
      <PassGrades />
    </>
  ),
};
const tone: TourStep = {
  target: '[data-tour="tone"]',
  title: 'Green ▲ and red ▼',
  text: <>Good values are green ▲, poor ones red ▼, and only when there are enough attempts to judge. Tap this line to read how it is decided.</>,
};

export function teamTour(team: string): TourStep[] {
  if (isGerman()) return teamTourDe(team);
  return [
    {
      title: team,
      text: (
        <>
          <p>The team's games and results, and stats from the match videos, tagged touch by touch: every serve, pass, set, attack, block and dig, who played it and where the ball went.</p>
          <p>A quick look around, in 6 steps.</p>
        </>
      ),
    },
    {
      target: '[data-tour="tabs"]',
      title: 'Five views',
      text: (
        <ul>
          <li><b>Overview</b>: games, results and the season at a glance</li>
          <li><b>Stats</b>: the numbers of the season or of one match</li>
          <li><b>Trends</b>: how they develop from match to match</li>
          <li><b>Players</b>: a page for every player</li>
          <li><b>Replays</b>: watch the touches themselves</li>
        </ul>
      ),
    },
    {
      target: '[data-tour="games"]',
      title: 'Games and videos',
      text: <>Upcoming games and results. Tap a game for the hall, its video and, once tagged, its stats. Know a video of a game? Send the link there; it shows once the team has checked it.</>,
    },
    {
      target: '[data-tour="tab-players"]',
      title: 'A page per player',
      text: <>Under <b>Players</b>, tap a name: strengths, faults, practice tips (switch them on there), charts per skill and how it changed over the matches. The address of that page can be sent on its own.</>,
    },
    {
      target: '[data-tour="tab-replays"]',
      title: 'Watch every touch',
      text: (
        <>
          <p>Every tagged touch as a short clip, filtered by player, skill and set, one by one or all in a row.</p>
          <p>Spot a wrong tag, or a touch that is missing (like a block without a touch)? Switch on <b>Suggest corrections</b> and send it.</p>
        </>
      ),
    },
    {
      title: 'That is the tour',
      text: <>The <b>? Guide</b> button in the corner brings it back any time. The Stats tab has a short tour of its own.</>,
    },
  ];
}

/** The Stats tab: season or one match, the topics, how passes are graded, green and red. */
export function statsTour(): TourStep[] {
  if (isGerman()) return statsTourDe();
  return [
    {
      target: '[data-tour="match-picker"]',
      title: 'Season or one match',
      text: <>Stats and Trends start with all matches together. Pick a match here to see only that one.</>,
    },
    sections,
    passes,
    tone,
    {
      title: 'That is the tour',
      text: <>The <b>? Guide</b> button in the corner brings it back any time.</>,
    },
  ];
}

export function playerTour(name: string): TourStep[] {
  if (isGerman()) return playerTourDe(name);
  return [
    {
      title: `${name}'s page`,
      text: <>Built from {name}'s own tagged touches in every match. A quick look in 6 steps.</>,
    },
    {
      target: '[data-tour="learn"]',
      title: 'Strengths and faults',
      text: <>What stands out in the numbers, good and bad, each with the figures behind it.</>,
    },
    {
      target: '[data-tour="tips"]',
      title: 'Practice tips',
      text: <>Switch on <b>Show practice tips</b> for drills that fit these numbers. They are pre-written suggestions picked from the tagged touches, not a personal assessment.</>,
    },
    {
      target: '.player-charts',
      title: 'Charts',
      text: <>Further down: the attack, serve & pass and court charts of this player alone, and the match-by-match trend.</>,
    },
    {
      target: '[data-tour="tabs"]',
      title: 'The whole team',
      text: <>These tabs open the team's stats, the trends, the other players and <b>Replays</b>, where you can watch your own touches as clips.</>,
    },
    {
      title: 'That is the tour',
      text: <>The <b>? Guide</b> button in the corner brings it back any time.</>,
    },
  ];
}

export function matchTour(title: string): TourStep[] {
  if (isGerman()) return matchTourDe(title);
  return [
    {
      title,
      text: <>The stats of this match, from the video tagged touch by touch. A quick look in 5 steps.</>,
    },
    {
      target: '[data-tour="tabs"]',
      title: 'Stats and report images',
      text: <><b>Stats</b> has all the numbers; <b>Report images</b> has a few pictures ready to send in a chat.</>,
    },
    sections,
    passes,
    {
      title: 'That is the tour',
      text: <>The <b>? Guide</b> button in the corner brings it back any time.</>,
    },
  ];
}
