# Changelog

## Unreleased

**Public link: Replays**
- A Replays tab plays every tagged touch of a match as a short clip, filtered by skill, player, set and points / errors, one at a time or all in a row. Viewers choose their own copy of the match video; it plays on their device and is never uploaded (a YouTube match plays from YouTube).
- With "Suggest corrections" on, a viewer who spots a wrong tag can send a correction (player, action, grade, court spot, an optional note); their shirt number is required. The court is drawn as the camera sees it, following the side switches of your court marking. It shows up in the app under the match's ✎ Edits tab (and as a badge in the match list), where you accept it (the tag changes) or reject it.

**Review**
- Swipe a touch chip up to remove it; removed touches stay as a small ↺ chip to bring them back.
- Clear, labelled tools: Touch here, New rally here, Join next rally, Clear touches; on an open touch Back, New rally from here, Their touch, Not a touch, Next.
- A touch added by hand gets the likely action and side from the touch before it (serve → their pass → set → attack → their dig).

**AI check**
- Learns from your reviews: every saved rally records which AI answers were right (noise, ours / theirs, action, shirt number, court position). A kind of answer that is right less than 70% of the time is only shown, no longer filled in; one that is right 90%+ is also used when the AI is a bit less sure.
- Finds the player by court position when no number is readable (through the line-up and rotation).
- Optional: show the AI your corrected touches as examples with each check (costs more per check).
- Check every rally at once, by hand or right after the auto-detection.
- The Auto screen shows the AI credit left, today's checks, the cost of checking the rallies waiting in Review and whether it fits.
- A long rally is sent in several smaller requests, so gateways with a request size limit ("413 Request Entity Too Large") work; `AI_MAX_REQUEST_KB` sets the size.
- Server: `AI_MONTHLY_BUDGET` and `AI_CURRENCY` (only needed when the gateway does not report a budget).

## v1.0.0

First stable release.

**Tagging (Android app)**
- Tag pad: player, action, and two court taps (where the ball was played from, where it went), with the likely next action first and the setter / attackers pre-selected.
- "They won" asks how they scored (their attack, ace or block, or our error), where it landed and who of ours missed it.
- Line-ups, rotation and substitutions; offline queue; video import from WeTransfer, Drive, Dropbox, YouTube and more.
- Auto-detection on the phone (sound, edit cuts, rallies, jersey numbers), reviewed rally by rally, with an optional AI check of each touch.
- Official match sheet scan (optional AI): teams, rosters (existing names kept, matched by jersey number), set scores and the full match flow, which also fills in the line-ups.
- Check the tags against the match sheet point by point, and saved versions of a match to go back to.

**Analysis (website)**
- Overview, rotations (from the tags and from the match sheet), attack (shot direction, front vs back row), serve and pass, setting, defence, errors (how the opponent scored), players.
- A learning page per player, report images, PDF report, CSV export.
- One public link per team (no login) with Stats, Trends and Players.
