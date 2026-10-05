# Grim Fronteira - Player Tutorial

Real screenshots from a local production build. Game app source files were not changed.

**Branch:** feature/post-deploy-polish
**Commit:** d2592b2731ba0919ed7dd2950be64947bc17e349
**Captured:** 5 October 2026
**Capture size:** 1280 x 720 CSS pixels (browser default).

## Reading order

### 01. Join your friends

![Join your friends](images/01-join-game.png)

Paste the Game ID shared by the Marshal into the game_id field (1), then click Join Game (2). Do not click New Game to join an existing session.

### 02. Choose your figure

![Choose your figure](images/02-choose-figure.png)

In CHOICE mode, click an available Jack, Queen, or King; the highlighted Queen of Diamonds (1) is this guide’s example. Its suit gives your faction power; its rank sets your starting Scum and Vengeance.

### 03. Name your character

![Name your character](images/03-name-character.png)

Click a suggested name, such as Leonor del Paso (1). To write your own instead, scroll to the custom-name field, enter the name, and click Submit.

### 04. Give your character a feature

![Give your character a feature](images/04-choose-feature.png)

Pick a suggested feature, such as a chipped saint medallion (1), or write your own and click Submit. This completes the character’s description.

### 05. Your character is ready

![Your character is ready](images/05-ready-and-wait.png)

After choosing your name and feature, you are marked ready automatically. The waiting message (1) confirms that you are waiting for the Marshal to start the game. Keep this browser open.

### 06. Read your character board

![Read your character board](images/06-read-your-board.png)

Your character’s figure (1) contributes 10 to scene hands. Scum is on the left and Vengeance on the right. The Rewards area (2) holds earned Rewards below your character board; its points are separate from your hand total.

### 07. Wait for your turn

![Wait for your turn](images/07-wait-your-turn.png)

The status message (1) shows that Abner Coldiron is acting. The deck stays disabled while another participant is acting. Wait until the message changes to Your turn; turns follow the initial hand order.

### 08. Draw or Stay

![Draw or Stay](images/08-draw-or-stay.png)

On your turn, click the deck (1) to draw another card, or click Stay (2) to stop. Match or beat the difficulty without going over 21. Your total already includes your character’s 10 points.

### 09. Boost your hand with Vengeance

![Boost your hand with Vengeance](images/09-play-vengeance.png)

Click your Vengeance pile (1) to spend its top card: +1 to your total, or +2 when its suit matches your character. A boost can still take you over 21.

### 10. Optional: use your faction power

![Optional: use your faction power](images/10-faction-power.png)

Criollo example: Law of Lead · Convert is already open, and the highlighted Scum card (1) is selected for conversion into Vengeance. Click Confirm conversion (2) to apply it, or Cancel to return to ordinary play. To open this selection, click Law of Lead · Convert. Other factions have different powers.

### 11. Optional: target another player

![Optional: target another player](images/11-play-scum.png)

Click your Scum pile (1), then click an in-scene opponent’s figure (2). Scum targeting is already active in this screenshot. Scum lowers their total by 1, or by 2 when the spent card matches your own character’s suit. Busted players cannot be targeted.

### 12. Confirm the scene result

![Confirm the scene result](images/12-acknowledge.png)

Review your outcome, then click Acknowledge (1) when finished. This screenshot shows a bust and one wound. At two wounds, your character is eliminated.

### 13. Collect Rewards and continue

![Collect Rewards and continue](images/13-rewards-and-next.png)

Here is the successful player’s board: the earned Reward card (1) appears after Close Scene and contributes 5 Reward points in this example. Aim for exactly 21 Reward points. If Heal/Skip or Reward-discard choices appear, complete them before the next scene.

## Editing and regeneration

Edit the corresponding record in ../captures.json and run ../render_annotations.py with Python 3 and Pillow. The script regenerates PNGs, editable self-contained SVGs, steps.json, and this reading-order guide. Original screenshots remain unchanged.
Use --metadata-only to update steps.json and this README without modifying any images. Numbered markers follow the marks array order, starting at 1. Titles and captions stay outside the PNGs and SVGs.

## Scope and verified flow

Verified through an ordinary two-player scene, player acknowledgments, Close Scene, Reward distribution, and New Scene. The UI automatically marks a character ready after name and feature selection.

Healing, excess-Reward discards, detailed Azzardo and Dark play, and the other faction powers are not illustrated as separate walkthroughs. They are advanced follow-ups. The final Player screenshot shows the successful second player (Abner), while most earlier Player screenshots follow Leonor. The faction screenshot is an optional example: its selection was cancelled before ordinary play continued.

These are local disposable sample games. No invitations were sent, no source files were changed, and nothing was committed or deployed.