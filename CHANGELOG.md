# Changelog

## Unreleased

**Videos found by the search are easy to find**
- Matches: a "N possible videos to check" bar shows the games the YouTube search found something for; one tap lists just those. Once you confirm a video (or "None of these") the game leaves that list.
- The video filter is now All games / To check / With video ("only with video" only showed confirmed ones, so found videos seemed to be missing).
- After a search run: "Show the N to check". "Searches left" is read again after every run, and when YouTube says the quota is used up, the message says so plainly.

**The detection learns from your tags**
- Each detection run now keeps every sound peak it heard, also the faint ones it did not count, with how loud and how long each was.
- The server tries other settings against the touches you tagged (in every match with such a run): which would have heard the most of your touches with the least noise between rallies. Once 150 touches are tagged (about four sets), the next run uses the best ones by itself.
- Auto → "Learning from your tags": touches heard and noise per minute with the standard and the learned settings, and a switch to go back to the standard ones. The sensitivity slider still works on top.
- Needs the new Android app (the runs of older versions have no sound peaks to learn from).

**More from the YouTube search**
- Matches: "Search YouTube for N" searches every played game in the filtered list that has no video and was not searched yet, one after the other (with a stop button), as far as today's quota goes. Found videos show as "possible video" in the list; open a game to check them.
- Matches: pick the period as a week, any dates (last 7 / 30 days; at most a month without a region) or a region's whole season.
- About → YouTube video search: searches left today, units used of the 10,000 free ones, and when they start over (9:00 Swiss time). Searches stop by themselves when the quota is used up.

**Testing the auto-detection on any video**
- "How well did the detection do?" now only judges the parts of the video you tagged. A run always covers the whole video; when only one set was tagged to test it, the detections in the untagged sets used to count as extras. It says how many it left out.

**Matches: every game in Swiss Volley**
- New "Matches" page in the menu (and "All games" on the public team page): every Swiss Volley game, of any team. A week of all of Switzerland, or a whole season of one region.
- Filters: region, week (or whole season), women / men, league, results / upcoming, team, hall or town, only games with a video. On the phone they fold into one line.
- A game shows date, result with set scores, league, group and hall. Coaches can search YouTube for it, confirm a video or paste one, see videos sent by visitors, and tag the video. On the public page a confirmed video plays in the page, and visitors can send a link.

**Public team page: Overview**
- The public team link opens on a new Overview tab: the next game, upcoming games and results (with videos), the season record with the last results, the key numbers from the tagged matches, the leaders and the tagged matches. Stats moved to their own tab.
- A game shows its hall, its video (played on the page) and, once tagged, links to its stats and replays.
- Visitors can send a video link for a game (with their shirt number). It shows on the page only after the coach has used it: the coach sees sent videos on Home and in the game ("Use" or ✕).
- The guided tour of the team page now covers the Overview; the Stats tab has its own short tour.

**Schedules from Swiss Volley**
- Link a team once with its page in the Swiss Volley game center (team page → Schedule from Swiss Volley). Its games and results then show on Home (Upcoming / Results) and on the team page, and update by themselves twice a day.
- Tap a game: date, time, hall with a map link, result. "Tag this match" opens a new match with team, opponent, date and the game already filled in; a match tagged that day is linked to the game by itself.
- A club calendar link (webcal://…, all teams of the club) works too: VolleyIQ lists the club's teams and you pick which one this is (a team in two leagues, e.g. a league and U23, can be picked per league).
- "<Opponent>: games this season" shows every game of the other team (league and cup, from its own calendar), with set scores where the league has them.
- Videos: search YouTube for any of these games (needs YOUTUBE_API_KEY on the server), check the suggestions and confirm the right one, or paste a link. With a video, an opponent's game can be tagged for scouting.

**New look**
- Light design by default, like a stats portal: white panels on a light grey page, one blue for what is selected, a dark blue bar at the top. The dark design is still there: About → Appearance (Light, Dark or like the device).
- On a computer the pages sit next to a narrow menu on the left; on the phone the menu is at the bottom. Plain line icons instead of emoji.
- Stats topics are one grey panel of buttons (on a wide screen a list beside the report, always in view). Tables have a tinted header row and alternating rows. Tabs are underlined.
- Courts and diagrams are drawn on a light floor in the light design.
- The public link has the team name in the top bar and its tabs stay at the top while scrolling.

**Match videos in your own storage**
- Video conversion at night: TRANSCODE_HOURS=23-7 in .env. A conversion still running in the morning is paused, not stopped, and goes on the next night; the match page shows "paused until tonight". 50/60 fps videos are converted to 25/30 fps (about half the work) and the converter may use two cores (still at the lowest priority).
- A streamed video shows "Loading video… (slow connection?)" while it buffers and a message when it fails, instead of a black picture; an expired link (page left open for hours) is renewed by itself. In Replays you can switch to your own copy any time.
- With a bucket set up (S3_* in .env, e.g. Hetzner Object Storage), the app uploads a match video straight into it in the background (resumes after a lost connection, progress notification). The match page and the public Replays stream it from there with links that expire, so nobody needs their own copy. Delete it per match. The upload does not pass through the server.
- The server makes a 720p and a 480p version of each uploaded video (one video at a time, at the lowest CPU priority, about as long as the match on one core). Pick the size under the video: Original, 720p or 480p. It goes on from the same moment, at the same speed. The public Replays start with 720p; "Video not playing?" offers the 480p version. The match page shows how far the conversion is, and can make the versions for videos uploaded before this.

**Privacy**
- Teams → "Export for training (numbers only)": the tags of a team for training the auto-detection, with shirt numbers and roles only (no names, team or opponent names, dates, video file names or match sheets).

**Background jobs**
- App updates (About → Download and install) download as a background job with a notification: progress, MB and about how long is left. It goes on in other apps; tap the notification to install when it is done.
- "AI check all rallies" runs as a background job in the app too, with a progress notification (rally N of M, about how long is left); it no longer stops when you switch apps.

**Measuring the auto-detection**
- Every detection run is kept on the server as it came from the phone (the last 10 per match, with its settings).
- Auto → "How well did the detection do?": against the touches you saved for the match, the share of your touches it found (per skill), how many it reported for the other team or as extras, timing, how often the action and the shirt number were right, the most common action mix-ups, and how reliable heard / quiet / gap detections and each confidence level were.

**Set chart**
- Setting (team stats, and the Setting chart on a setter's page): the setter's sets from the side, like a set-call chart: an arc per place the sets went (left to the antenna or inside it, middle in front of the setter, behind the setter, right, and the back row: left, pipe, alpha; shoot sets drawn straight, quicks flat), drawn in 3D on our half with the court, the 3 m line and a shadow on the floor for each set, so front-row and back-row sets are easy to tell apart as thick as it is frequent, with share, kill % and efficiency of the attack after it. Only sets by players with the setter role.

**Blocks without a touch**
- New action "Block, no touch" (Block → No touch): a blocker who jumped while their attack went past, with where it was hit from and where it went.
- Fast to tag: after They won → Their attack, the "who touched it last" screen has an optional row with our front row; tap the blockers who were there without a touch. Nothing changes if you skip it.
- Blocks are placed along the net: the dot starts on the net and is dragged along it, or moved with a slider and arrows that lock in 0.2 m steps (tagging, Review and Replays). A block without a touch: first where the block was at the net, then where the ball went.
- "Blocks along the net": every block per metre from zone 4 to zone 2, as points, touches, no touch and errors, to see the holes in the block.
- Stats: a "No touch" column for the blockers, and charts of where their attacks went past our block (arrows and by zone), for the team (Defence) and on each player's page (Block).

**Public link: corrections on the phone**
- With Suggest corrections on, every touch in the Replays list has its own ✎ edit button. It jumps up to the video, plays the touch, and opens the correction under the video one question at a time (who → what → where → send), like the tag pad in the app, so the video stays in view while choosing, sliding the block or tapping the court. Replay and slow-mo are in the panel.

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
