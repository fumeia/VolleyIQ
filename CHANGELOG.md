# Changelog

## Unreleased

**Blocks without a touch**
- New action "Block, no touch" (Block → No touch): a blocker who jumped while their attack went past, with where it was hit from and where it went.
- Fast to tag: after They won → Their attack, the "who touched it last" screen has an optional row with our front row; tap the blockers who were there without a touch. Nothing changes if you skip it.
- Stats: a "No touch" column for the blockers, and charts of where their attacks went past our block (arrows and by zone), for the team (Defence) and on each player's page (Block).

**Public link: suggest a missing touch**
- In Replays with Suggest corrections on, "Missing touch? Add one at the current video time" sends a new touch (player, action, spots) to the Edits pile in the app, where "Add it" saves it as a tag.

**Player pages**
- Charts for the player alone below the numbers, strengths, faults and practice tips: Attack (efficiency by pass and by where it was hit from, shot directions, kill % by zone, shot chart), Serve & pass (zones, depth, pass quality by zone, where the passes went) and Court maps. The same charts on the team pages are unchanged.
- The "What to practise" switch is also on the team page, and shows for players with few touches too.

**Playback**
- Speed picker with 0.1×, 0.25×, 0.5×, 0.75×, 1×, 1.5×, 2× (one tap to open, one to pick), and frame-by-frame steps for video files: in Replays, Review and the match video.

**Public link: Replays**
- A short guided tour on the public links (team, player page, single match) shows what is in them: the four views, season or one match, the stats topics, green / red, player pages and Replays. It opens once per device, can be skipped at any step and comes back with the ? Guide button.
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
