# Changelog

## Unreleased

**Smooth video from the phone**
- A video picked from the phone stuttered in the app, even in slow motion, while the same file played smoothly from the team link in a browser. The app handed the video to its web view piece by piece through a slow internal bridge. It now plays the video from a small web server inside the app that only this phone can reach (protected by a random key), so the web view streams it like a video from the internet. If that server is ever unavailable, the app falls back to the previous way on its own.
- Match settings in the app: "Video playback check" for a phone video. It shows the file's format (size, frame rate, H.264 profile), which decoder the phone uses for it (hardware or software), the app's web engine version, and frames shown and dropped per second while the video plays.
- A 10-bit phone video (H.264 High 10, for example from a DJI camera) now gets a note under the video: phones have no hardware decoder for it, so it plays with dropped frames. The note gives the one-line ffmpeg command for an 8-bit copy that plays smoothly.
- "Change video" in the app now picks a new file on this phone right away and leaves the team video in storage as it is (before, it fell back to the storage video, so a new phone file could only be chosen after deleting the upload).
- The playback check also counts how often the page is drawn, and can show the video alone on a plain page with the same numbers.

## v1.4.0 (2026-11-08)

**Server install more reliable**
- Building the server image sometimes failed when the database module's ready-made binary could not be downloaded (its fallback, compiling it, had no compiler in the image). The build now has the tools for that fallback in a separate step; the server image itself stays as small as before. This also made the "Server" checks on GitHub fail now and then.

**Chained tags: one tag asks for the rest of the rally**
- Practice matches: right after the tag, a panel under the video lists the other side's players (one tap, or "Not sure"):
  - Attack blocked: who blocked it (one or two players, each gets a block point).
  - Block point: whose attack it was (they get the blocked attack).
  - Kill: who could not keep it up (dig error), or "Nobody touched it".
  - Ace: who it was served at (receive 0), or "Nobody touched it".
  Each still counts as one point for the rally; two block points of a double block too.
- Straight to the pass: in a practice match, tapping a player of the other side right after a serve goes straight to the pass; in a real match, the first tap after the opponent's point does. After a set, tapping a player of the same side shows the attack choices first. "Other actions" brings back all of them.
- Stats: "How the kills ended" (Attack) and "How the aces ended" (Serve & pass), under More charts: straight down against touched but not kept up, per player.
- Fix: tags without a video time (live tagging) that were not saved yet could be read in the wrong order, so for example a blocked attack and its block point were counted as two points. They now keep the order they were tagged in.

**Off the block: one popup for where and who**
- Practice matches: after "Off block → Kill" and "Off block → In play", one popup asks where along the net it touched their block (net slider, or skip) and lists the other side's players: tap one or two and save. After a kill they get "Block touched out" (a block error, no extra point: still one point for the rally); in play they get a block touch, and their side comes first on the tag pad. A recycle uses the same popup (its net spot is already set). It opens in the space under the video, like the court spot steps, so the video stays in view.

**Recycle: where it hit the block, and who blocked**
- A recycle's second step is "Where along the net did it hit their block?" with the net slider (as for a block touch), instead of a landing spot.
- Practice matches: then a sheet lists the other side's players; tap one or two blockers and save. Each gets a block touch at that spot of the net. The attacking side stays on top of the tag pad.
- Voice: "five recycle", "9 attack recycled", "Neun Recycle".

**Practice matches: the next side comes first on the tag pad**
- After a serve or an attack that stays in play, the other side's players move to the top of the tag pad, right under the video, so the pass or the dig is one tap away without scrolling. After a pass, set, dig or block the same side stays on top; after an error, ace or point nothing moves.
- New attack: "Recycle" in the Off block row (also in an attack's edit sheet): hit off the opponent's block on purpose so that it comes back and your side plays it again. Counts as an attack in play off the block; the attacking side stays on top of the tag pad.

## v1.3.0 (2026-11-08)

**Player pages: matches against practice, and the trend over the season**
- "In matches and in practice": the player's numbers (touches, +/−, attack, pass, serve errors, aces) from real matches next to those from practice matches, to see whether it carries over into games. Shown whenever the player has touches in both, also while practice matches are switched off for the rest of the page.
- Trend lines per match in date order: attack efficiency, pass average and serve errors, each its own small chart, for the skills the player has in two or more matches.

**Small helpers while tagging**
- Practice matches: when the current set has no line-up yet for one or both sides, one line under the Line-up buttons says so (the rotations and the analysis per side need them).
- Events tab: when every set's tagged score matches the official Swiss Volley result, the check offers "Mark as fully tagged" right there.

**Stats: the main charts first**
- Every Stats topic now opens with its few main charts for a player looking at their own game; the rest are behind "More charts" at the bottom of the topic (kept open for the visit once opened). Overview: score progression (season: attack and pass per match), volume vs efficiency, how we scored. Attack: attackers, which shots work, shot chart. Serve & pass: servers, receivers, side-out by the first pass. Setting: setters, set distribution, in vs out of system. Defence: defenders, blockers. Errors: points given away per player, how attacks and serves failed. Rotations: the rotation report and pass / first ball per rotation.
- Public player pages have the "Include practice matches" switch too (before, practice matches were left out there without a way to add them). The choice stays for the visit across Overview, Stats, Trends and the player pages.
- Practice matches: Overview shows the score of each set with the sides' names and each player's volume vs efficiency, without the "us" and "them" tiles and charts. Rotations shows each side's rallies won per rotation, set by set.

**Practice matches: Errors per side**
- The Errors topic of a practice match no longer adds both sides together as "us" and "them". It shows, for each set and side, where its points came from (its own kills, aces and block points, or the other side's errors), the errors each side made by kind, each player's errors next to their points, and how attacks and serves failed. Each table has a "?" with what it shows.

## v1.2.0 (2026-11-07)

**Replays keep your filters**
- The match, skill, player, set, points / errors, playlist, clip length, speed and corrections switch you pick on Replays stay when you go to another tab and come back (until the app or browser tab is closed).

**Events list: +1 / +0 on every tag**
- Each tag in the Events tab shows whether it scores a point as the match is read now: +1 (in your team's colour for your points, orange for theirs; in a practice match by side), +0 when it does not, and a dashed +0 for a tag that is counted together with the one next to it (a blocked attack with the block point, a dig error with the kill). Hover for who gets the point.

**Practice matches: kill and dig error count once**
- A kill and a dig error of the other side right next to it (within 3 s, either order) are one point for the attacker, like the blocked attack and the block point. The attacker keeps the kill and the defender the dig error in their stats. This works on the tags you already have, also for the live score on the public link. Matches marked "fully tagged" before keep their score until you unmark them.

**Practice matches: line-ups kept, analysis reworked**
- Fix: saving the sides of a set (Near / Far / Out) deleted the second side's line-ups of all sets. They are kept now. Line-ups lost this way need to be entered again.
- On the server, `node src/restore-lineups.js` brings deleted line-ups of the second side back from the nightly backups (only missing ones, only when the players fit the set's sides; backups from before practice matches are skipped; `--apply` to save).
- Fix: the public team link did not send the line-ups, so its practice analysis showed "No line-up saved" for every side and its rotations had no line-ups to work with.
- A line-up goes to the side whose players it holds, also after "Swap near and far".
- Sides are called after their setter ("Ann's side"); the set table is the whole side's numbers. Sets without tags say so instead of showing zeros.
- Players are judged by their role on the team page: hitters by attack efficiency, passers and liberos by their passes, setters by how the hitters did after their sets. The points-based pairs are gone.
- Combinations: Setters (side-out, break, hitters after their sets, after good and after poor passes, who got their sets), Setter and hitter, Passers (with the attack after their pass), and what changed for a player with another setter.
- A small blue "?" next to each title explains what the table shows and how to read it.

**Practice matches: their own analysis**
- Stats for a practice match open on a new "Practice" topic with no "us" and "them". Each side is named after who set for it in that set ("Ann setting").
- Set by set: each set's two sides next to each other, with their line-ups as a small court, the score, side-out, break, attack, pass, serve, blocks and errors. "Players and rotations" opens each side's players and rotations.
- Combinations: what the data says (best and worst setter and hitter, setters' results); a setter and hitter table (kills-errors / attacks after each setter's set).
- Players: pick a player and see their sets one under the other: setter, teammates, result and what they did.
- "All matches" (Stats and the public link) leaves practice matches out by default, as both sides are your own players. "Include practice matches" brings them back.

**Video conversion: only what makes sense, and a Stop button**
- The server only makes the smaller versions that are clearly smaller than the uploaded video: a 1080p video gets 720p and 480p, a 720p video only 480p, a 540p (or smaller) video none at all ("The video is 540p: no smaller versions needed").
- Downloaded videos are named after the date and the match ("2026-11-07 Home vs Away.mp4"), without "VolleyIQ" in front.
- While the smaller versions wait, run or are paused, the match page has "Stop" next to the progress. "Make them anyway" starts it again.

**Blocks: one point, not two**
- An "Attack blocked" directly followed by a "Block point" of the other side is now one point (for the blocking side), not a point for each. Both players keep the play in their stats (the attacker a blocked attack, the blocker a block point). This works on the tags you already have; nothing in them changes.
- Block point has a second step: "Where did the ball land? (skip if unsure)". New charts in Block and Defense: "Where our block points landed" and "Blocked attacks: where they came down on our side", to see where the cover was missing.

**Practice matches: kill off the block**
- After "Off block → Kill", a sheet asks which blocker of the other side touched it. That player gets "Block touched out": a block error, no extra point.

**Mark as fully tagged**
- In the Events tab of a match: "Mark as fully tagged". The match keeps the tag-reading rules it was finished with, and new detection runs add no suggestions to it. Your own edits still work. "Unmark" undoes it.

**Download the video from Replays**
- Replays of a video uploaded to your storage have a download link (original, plus 720p and 480p when there are smaller copies), also for visitors of the public page. The links work for 6 hours.

**Practice matches: the other side's answer comes first**
- The quick row at the top of the tag pad now knows whose turn it is: a player of the other side than the last touch gets what answers it (after a serve: Receive first; after an attack: Dig, Block touch, No touch; after a set: Block touch, Dig). Before, it always offered what follows your own team's touch (after a serve: Dig, Block touch, Free ball), so Receive was missing there.
- The pass row is called "Receive" ("Receive → tap court").

**Line-up sheet: the right players**
- The libero choices are only players with the libero (L) or middle (MB) role who are not in the six (liberos first). Before, every player not in the six was listed, setters and outside hitters too.
- Practice matches: each side's line-up only offers the players you put on that side for the set.

**AI check rides out a shaky connection**
- "AI check all rallies" no longer stops when Wi-Fi or mobile data drops for a moment: a request that fails is tried again after 5, 10, 20, 40 s … (about 3 minutes in all), with "Waiting for the connection…" in the notification. A longer outage pauses the job; Android starts it again by itself once the phone is online, and it goes on with the next rally (the rallies already checked are remembered, none is sent twice). A short hiccup of the AI service is tried twice more before that rally is skipped.

**A trained model for the touch detection**
- The phone now keeps 10 measurements of every sound it hears in a run (how far it stands out, how fast it fades, its height, how sharply it rises, how wide it is, how tonal, the band level against the surroundings, the energy before and after), not 3.
- The server trains a small model on them from your tagged matches: the sound at each tagged touch is a touch, every sound in the pause between rallies is not, and the rhythm around each sound counts too (time to the sounds before and after, how many there are). Tag times are tapped by hand with a reaction-time lead; the training first finds how far the tags sit from the sound in each match and corrects for it.
- It is tested on parts of the matches it did not learn from, next to the threshold rule on the same tags. Only when it finds more touches for less noise does the next run use it (Auto → "Learning from your tags" shows both, and the switch turns it off). It needs about 150 tagged touches lined up with a sound: one tagged match is plenty.
- Auto → Options → "This match is already tagged: only learn from it": a run on a match you tagged by hand keeps its sounds for the learning and adds nothing to Review; it skips reading the picture, so it is much faster. On by default for a match with 100+ tagged touches.
- Needs the new app: runs of older versions only kept 3 measurements per sound.
- Small on the server: only the newest run of a match keeps its sound peaks (about 1 MB for a 98-minute match; older runs keep their results), and a training uses at most the 10 most recent matches and 8,000 labelled sounds: about a second and under 50 MB of memory even then, retrained only when tags or runs change.

**Fine scrubbing**
- Match page: a second strip under the timeline with the 10 seconds around the current moment, to put the video on the exact ball contact (0.04 s steps; the video pauses while you drag, and the strip stays put). Saved tags show as marks on it.
- "‹ 0.1 s / 0.1 s ›" steps for YouTube videos too (video files keep their frame steps).

**Voice: words that sound alike**
- Words a speech engine writes for ours are understood: "seven past two" is "seven pass two", "attic" is attack, "surf" serve, "ice" ace, "5:00" is 5; any word one letter off one of ours counts as that word ("serwe", "receve", "Anname"). On Android 13 and newer the phone's speech recognizer is also told which words to expect (shirt numbers and the actions), so it hears them more often in the first place.

**Practice matches: rotations**
- Each side gets its own line-up per set ("Line-up Near" / "Line-up Far" above the tag pad): positions 1-6, the libero, and who serves first (the other side's choice follows by itself). While tagging, both sides rotate with the points: the players on court come first on the pad, and the server of the side serving gets the quick "Serve" button.
- Rotation stats (side-out and break per setter position) include practice matches, each side counted from its own view with its own line-up.

**Practice matches: Near and Far**
- The two sides are now called Near and Far by default (the near half is the bottom of the court as you or the camera see it): every player has a row with Near | Far | Out to tap. No separate "which side is near" question any more; "Swap near and far" when the groups change ends. Names can still be changed when creating the match.

**Practice matches: both sides are our players**
- New match → "Practice match": name the two sides (Blue / White by default). For every set you pick who plays on which side (tap a player once for the first side, twice for the second; each set starts from the set before, with "Swap sides").
- The tag pad shows both sides as two groups; every tag remembers its player's side, so a kill of a White player is a point for White. "Point Blue" / "Point White" end a rally (the last touch becomes its kill or error, as with "We won / They won"). The score reads Blue : White; voice works the same ("our point" = the first side, "their point" = the second).
- Court spots are tapped as you (or the camera) see them: the court in the tag pad always has the near half at the bottom, labelled with the sides' names. For every set you say which side is on the near half (a new set starts with the ends switched; with a marked court in the video the marking decides). The spot is saved from the player's own half, so in the analysis the far side's actions are turned to the near side and every player's attacks, passes and serves sit on the same field.
- Analysis: a practice match counts as the match seen from both sides (Blue against White and White against Blue), and every touch counts once for its player. Player stats, court maps, hits / tips, passing and the team totals all include it; the live score on the public page shows the two sides' names.

**Kills off the block**
- Tag pad: an "Off block" row under Attack and Tip: Kill (the ball went out off their block: block-out, tool) or In play (they still played it). Shown as "Kill off the block". In an attack's edit sheet: Hit / Tip / Off the block.
- Voice: "five off the block", "9 attack off the block", "twelve tool", "5 attack block out", "Fünf Angriff vom Block", "neun Blockaus"; "… off the block, in play" when they kept it alive. "12 block out" after one of our blocks stays our block error.
- Stats → Attack: "Hits, tips and off the block" side by side, and an "Off bl." column per attacker. Scouting report: a hitter who scores a lot off the block gets "hands in and firm, don't reach out wide".

**Tips and feints**
- Tag pad: a "Tip" row under Attack with the same outcomes (in play, kill, error, blocked), for a soft placed ball instead of a hit. Tips count as attacks everywhere (kills, efficiency, side-out), and are shown as "Tip kill", "Tip error" … in the lists. An attack tagged before can be made a tip in its edit sheet.
- Voice: "five tip kill", "seven feints, out", "12 tip blocked", "Fünf Finte Punkt", "neun legt den Ball, Punkt".
- Stats → Attack: a "Hits vs tips" table (share, kill %, error %, efficiency of each) and a Tips column per attacker. Scouting report: each attacker's share of tips, and "keep a defender up short behind the block" for a hitter who tips a lot.

**Voice tagging: full sentences, standard German**
- Whole sentences work, not just keywords: "Number seven makes a good pass, one sets, five scores", "a bad pass by twelve", "Sieben nimmt den Ball schlecht an, eins stellt, fünf greift an", "Zwölf schlägt auf ins Aus", "eine gute Annahme von sieben". Verbs (passes, sets, attacks, serves, digs; nimmt an, stellt, greift an, schlägt auf, wehrt ab) and pass grades as words (perfect / good / bad, perfekt / gut / schlecht) are understood; other words are skipped. "eine" / "ein" are no longer taken for player #1.
- DE is now standard German (and EN English); Swiss German is no longer used.

**Fixes**
- Voice tagging in the app showed "error 13" after a second of silence: the phone has no offline speech model for Swiss German, and Android says so each time listening starts again. It now switches to online recognition by itself (and to standard German if the phone lacks Swiss German), and only says something when it really cannot listen, in words instead of error numbers.

## v1.1.0 (2026-11-02)

Everything since v1.0.0. The highlights:
- **Swiss Volley:** your schedule and results, every game in Switzerland in Matches (filter by region, league, date), opponents' pages with their results.
- **YouTube:** videos of games found by themselves every night, tag straight from YouTube (no download), shirt numbers and line-ups read from a YouTube frame.
- **Before the match:** scouting report with a game plan, serve targets per zone and receiver, and a match simulator (win chance, best starting rotation, what to train).
- **During the match:** voice tagging (English and German, also along a video, full-screen video in landscape), pause and resume tagging when you go on court, a time-out card.
- **Public link:** overview with the live score, German, timeline and playlists in Replays (teammates make their own), suggestions of videos and corrections.
- **Video:** zoom, a timeline to jump anywhere, keyboard shortcuts on a computer, conversion of uploaded videos at night, nightly backups.
- **Checks:** tags against the official Swiss Volley result, the auto-detection learns from your tags, browser tests on every change.
- **Updates:** the app's About page shows what's new in each version, and whether a newer build is still being made.

**Release notes in the app**
- About → Updates: "What's new in …" shows the release notes of the newest version (the same as on GitHub), and a note when a newer build is still being made, with how long ago it started.
- Every release and test build on GitHub now lists its changes from this changelog: a release what changed since the last release, a test build what is new since the last release and what that build itself changed.

**Fixes**
- The tag marks on the timeline were drawn 1400 px wide on phones: the match page could be pushed sideways, and in landscape the video was blown up past the screen with no way back. The marks now fit the bar, and nothing on the match page can make it wider than the screen.
- Landscape: the match page keeps clear of the camera cut-out and the system bars.

**Voice tagging along a video**
- Voice tagging now runs as a strip at the bottom of the screen and keeps listening whatever tab is open. Along a video (YouTube or a file), each spoken tag gets the time you started speaking, a second earlier, and the next touches of the phrase follow 0.8 s apart; the video carries on if the phone's speech recognition stopped it. "More": language, "Pause the video while I speak", and the last phrases with what they became.
- Landscape: with voice on, the video takes the screen (header, buttons and tagging panel step aside; the timeline stays, the score is in the strip). Tap the video to play or pause, double-tap a side to jump 5 s. "Panel" brings everything back.

**Serve target planner**
- Scouting report → "Serve targets": their court as seen from our serving line, with their side-out chance per zone (darker = better target), the best receiver-and-zone pairs and every receiver, each with how many points 25 serves there would bring compared with serving anywhere. From their passes (grade and where it was taken) and whether they won those rallies. The best target also goes into "How to play them".

**Voice tagging**
- Match page → "Voice tagging": say who did what and it becomes tags, live without video or while watching one. "7 pass 2, 1 set, 5 kill", "12 serve error", "our point", "their point", "undo"; in German "7 Annahme 2, 1 Zuspiel, 5 Punkt", "12 Aufschlagfehler", "Punkt für uns", "Punkt Gegner", "zurück". "5 attack, our point" makes the attack a kill. Every phrase shows what was heard and which tags it made.
- In the Android app it uses the phone's speech recognition (offline when the phone has the German or English speech pack; asks for the microphone once). In a browser: Chrome, Edge or Safari.

**Pause and resume tagging**
- Match page → "Pause tagging" when you go on court; the page stays paused (also after a reload). "Resume": enter the score as it is now (and the final score of a set that ended meanwhile), who serves, and with a line-up our rotation now. The points you missed are added as untagged points: they count for the score, the live score on the public link and the official result check, but not for the stats, side-out or break.
- "Catch up the score" does the same without pausing first, when a few points went by untagged.

**Match simulator**
- Stats → "Match simulator" (or "Simulate a match" on a scouting report): your team against a scouted team or an average league team, played rally by rally thousands of times from both teams' side-out and break rates (per rotation when the line-ups are entered). Shows the chance to win the match, a set and a tie-break, which starting rotation wins most sets, and what would help most (side-out +5, break points +5, the weakest rotation fixed), as the change in match win chance.
- With few rallies the rates are pulled towards a typical amateur league (side-out 58%), so one tagged match gives a first estimate that sharpens with every match.

**Time-out card**
- Match page → "Time-out": the set so far, to read out in 30 seconds. The last 10 rallies (how the points came and went), side-out and break this set against your season, who is hot and who struggles (attack and pass), a few talking points, and the opponent's game plan when they were scouted.

**Shirt numbers and line-ups from YouTube**
- "Read the shirt numbers" and "Read from the video" (line-up) now also work while tagging from the embedded YouTube player. In the app, the picture is fetched from YouTube (one second of the video at up to 1080p, a few seconds' wait). In a browser, it asks to share the tab once per picture and cuts the video out of it, so make the video big first.

**Scouting report**
- Team page → "Scouting report" (and on an opponent's page from your schedule): from the matches tagged for that team, a short game plan (who to serve at, their main hitters and where they hit, where the setter goes after a good and a bad pass, their toughest server, weakest rotations, unforced errors), with the tables behind it. Each line needs enough touches behind it. Save as PDF / print for the team.
- On an opponent's page, "Tag this video" now tags the video for the opponent (their team is created from the Swiss Volley name), so it counts for their scouting report.

**Browser tests**
- 10 tests in a real browser, at desktop and phone size, run on every push: login, team page, scouting report, match page, stats, and the public link (tabs, German, live score, a teammate's playlist, an invalid link).

**Line-ups read from the video**
- Line-up sheet → "Read from the video": pause at the first serve of a set with all players in view, and the AI reads both teams' shirt numbers and positions 1-6 from the frame. Pick your team (the one on your half is highlighted when the court is marked); the positions fill in from the roster, the libero goes to the libero field, and with "first serve of the set" it also sets who serves first. Numbers not on the roster are listed. Check it against the video before saving. Needs the video file on the device.

**Tags against the official result**
- Match page → Events: for a match linked to a Swiss Volley game, the official set scores next to the score from the tags, set by set, with what is off ("3 points for us missing", "1 point for them too many"). Missing points are usually a rally without its last tag.

**Live score on the public page**
- While a match is being tagged (a tag in the last 15 minutes), the public Overview shows it on top: sets won, the current set's score, the finished sets; it refreshes every 15 seconds. When a side has won three sets it says "Final".

**Teammates' playlists**
- Public link → Replays: with their shirt number, teammates make their own playlists, public (the whole team sees them, with their number) or private (only shown when that number is entered). "Add clips to" puts a ＋ on every clip; in their own playlist ✕ removes one, and they can rename it, switch public / private or delete it. Only the number that made a playlist can change it. A shirt number is not a password: anyone typing #7 sees #7's private playlists.
- The coach sees all playlists on the team page, with who made them, and can delete any.

**Public link in German**
- The public team and match links follow the browser's language (German for German browsers), with a DE / EN switch in the top bar (remembered on the device). Translated: tabs, Overview, games and results, Replays with corrections and playlists, All games with its filters, the video form, the guided tours, the stats topics, the main numbers and the pass grades. The coach app stays English.
- Still in English for now: the generated findings ("What went well" items), the chart titles and explanations inside the stats topics, the player pages' strengths and tips, and the report images.

**Clip playlists**
- In a match's Events tab, select tags (hold one; "All shown" selects the whole filtered list) and pick "Add to playlist…" (or a new one). Playlists can mix matches, e.g. "Our blocked attacks" over the season.
- Team page → Clip playlists: change the order (↑ ↓), remove clips, rename, delete.
- Public link → Replays: the playlists above the clips; a playlist plays in its order and switches to the right match's video by itself.

**Keyboard shortcuts (computer)**
- Type the shirt number to pick the player (1 then 2 = #12; "-" = unknown), then the action letter as before. ↑ ↓ jump a minute, ← → 2 s (Shift: 10 s), , . one frame, [ ] previous / next tag, M slow motion, Backspace undoes the last tag, ? lists every key ("Keys ?" under the video).
- Fix: "Undo last tag" removed the tag latest in the video instead of the one added last.

**Video search by itself**
- Every day after YouTube's quota starts over (9:00), the server searches videos for your linked teams' played games of the last two months, then for the recent games of each team's next two opponents: up to 30 games a day (About → YouTube video search: on/off and 10 to 80 a day), always leaving 10 searches for you. Games without a find are tried once more a few days later (streams come late).
- Found videos are marked "possible video" in the games lists (Home, team page, Matches).

**Video conversion survives updates**
- The 720p / 480p conversion now works in 10-minute pieces kept on the server's disk until the end. A restart (a server update, a reboot) goes on with the next piece instead of starting the whole match over; at most the piece in progress is converted again. The pieces are joined without converting again.

**Backups**
- With the video bucket set up, the server backs up the whole database every night around 3:00 into the bucket (backups/, gzipped, the newest 14 kept). About → Backups shows the last one and has "Back up now". The README says how to restore one.

**Regions in Matches, timeline in Replays**
- Matches (app and public "All games"): every game shows its Swiss Volley region (SVRZ, SVRA, SV for the national leagues, …), also in the game's details; the region filter lists the codes with their names. All of Switzerland is now read region by region for this (first load of a week a few seconds longer, then kept).
- Public Replays: the same timeline under the video as on the match page.

**Timeline under the video**
- Match page: a bar with the whole video under the picture. Drag (or tap) to jump anywhere; the picture follows while dragging. It shows the time and the length, a small mark for every saved tag and where each set starts (S1, S2, …).

**Zoom in the video**
- Pinch with two fingers on the video (Ctrl + mouse wheel or a trackpad pinch on a computer) to zoom in up to 5×, drag to look around, "1×" to see the whole picture again. Taps still play and pause.
- Roster from the video: a zoomed-in frame is sent as exactly the part in view, at the video's full resolution; a frame without zoom is sent as four overlapping quarters (an AI model shrinks a whole frame, and the numbers get lost). Up to 12 pictures at once.

**YouTube streams in the app too**
- A YouTube link no longer starts a download in the app: the match plays the YouTube video, like on the website, and you can tag right away. Downloading is only needed for auto-detection, the AI check and reading shirt numbers: tick "Also download it to this phone" when creating the match, or press "Download the YouTube video" in the Auto tab later (tags keep their times).

**Teams and rosters for test videos**
- Matches → a game with a confirmed video: tag it for either side. That team is taken from your teams (same name) or created with its Swiss Volley name, and the other side is the opponent.
- Match page → ⚙ → "Roster from the video": pause where shirt numbers can be seen (line-up before the game, a time-out, players on court), add up to four frames, and the AI lists the numbers per shirt colour (liberos marked). Tap numbers to leave them out, then add them to the team: players named after their number (#7), liberos as L. Roles and names can be set on the team page. Needs a video file on the device (in the app YouTube videos are downloaded first) and the AI backend; counts toward the daily AI limit.

**Fixes**
- The Android app showed "No connection to the server" on every change that uses PUT (confirming a found video, linking a team, the learned-settings switch). The server's CORS rules did not allow PUT, so the app's requests were blocked before they reached the server.

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
