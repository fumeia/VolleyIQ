import { PassGrades } from './PassGrades';
import type { TourStep } from './Tour';

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
  return [
    {
      title: `${team}: match stats`,
      text: (
        <>
          <p>Everything here comes from the match videos, tagged touch by touch: every serve, pass, set, attack, block and dig, who played it and where the ball went.</p>
          <p>A quick look at what you can find, in 8 steps.</p>
        </>
      ),
    },
    {
      target: '[data-tour="tabs"]',
      title: 'Four views',
      text: (
        <ul>
          <li><b>Stats</b>: the numbers of the season or of one match</li>
          <li><b>Trends</b>: how they develop from match to match</li>
          <li><b>Players</b>: a page for every player</li>
          <li><b>Replays</b>: watch the touches themselves</li>
        </ul>
      ),
    },
    {
      target: '[data-tour="match-picker"]',
      title: 'Season or one match',
      text: <>Stats and Trends start with all matches together. Pick a match here to see only that one.</>,
    },
    sections,
    passes,
    tone,
    {
      target: '[data-tour="tab-players"]',
      title: 'A page per player',
      text: <>Under <b>Players</b>, tap a name: strengths, faults, charts per skill and how it changed over the matches. The address of that page can be sent on its own.</>,
    },
    {
      target: '[data-tour="tab-replays"]',
      title: 'Watch every touch',
      text: (
        <>
          <p>Every tagged touch as a short clip, filtered by player, skill and set, one by one or all in a row.</p>
          <p>You choose your own copy of the match video; it plays on your device and is not uploaded. Spot a wrong tag? Switch on <b>Suggest corrections</b> and send the fix.</p>
        </>
      ),
    },
    {
      title: 'That is the tour',
      text: <>The <b>? Guide</b> button in the corner brings it back any time.</>,
    },
  ];
}

export function playerTour(name: string): TourStep[] {
  return [
    {
      title: `${name}'s page`,
      text: <>Built from {name}'s own tagged touches in every match. A quick look in 4 steps.</>,
    },
    {
      target: '[data-tour="learn"]',
      title: 'Strengths and faults',
      text: <>What stands out in the numbers, good and bad, each with the figures behind it. Further down: charts per skill and the match-by-match trend.</>,
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
