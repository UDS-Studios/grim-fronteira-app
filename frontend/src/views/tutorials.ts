export const tutorials = {
  "marshal": {
    "title": "Marshal Tutorial",
    "steps": [
      {
        "num": 1,
        "filename": "01-create-game",
        "title": "Create your game",
        "caption": "Click New Game (1). You become the Marshal of a new game."
      },
      {
        "num": 2,
        "filename": "02-share-game-id",
        "title": "Invite your players",
        "caption": "Click Copy Game ID (1), then send the copied ID to your friends. Each friend uses it to join from their own browser."
      },
      {
        "num": 3,
        "filename": "03-character-mode",
        "title": "Choose character assignment",
        "caption": "Keep CHOICE (1) so players pick their own figure, or select RANDOM (2) to assign figures randomly. This guide uses CHOICE."
      },
      {
        "num": 4,
        "filename": "04-start-session",
        "title": "Start when everyone is ready",
        "caption": "Once at least one player has joined and every joined player has chosen a figure, name, and feature, click Start Game (1). Players become ready automatically when their character is complete."
      },
      {
        "num": 5,
        "filename": "05-choose-story",
        "title": "Choose the opening story",
        "caption": "Choose a suggested narrative hook, such as the highlighted Story Hook (1), or prepare your own. Then click Bring the Frontier to life!! (2) to move to the game table."
      },
      {
        "num": 6,
        "filename": "06-select-participants",
        "title": "Choose who is in the scene",
        "caption": "Click Leonor del Paso’s player panel (1) and Abner Coldiron’s player panel (2) to include both in this challenge. Selected characters appear in Scene Participants. Leave other players outside the scene."
      },
      {
        "num": 7,
        "filename": "07-draw-difficulty",
        "title": "Set the challenge",
        "caption": "For this ordinary scene, leave the Dark off and click the deck (1) once to draw the difficulty. Players must match or exceed it without busting."
      },
      {
        "num": 8,
        "filename": "08-start-scene",
        "title": "Deal the first hands",
        "caption": "The difficulty is set. Click Start Scene (1) to deal one card to each participant. For this introductory scene, skip the optional Azzardo."
      },
      {
        "num": 9,
        "filename": "09-follow-turns",
        "title": "Follow the player turns",
        "caption": "The highest initial hand acts first. The Acting now label (1) identifies the current player—in this screenshot, Abner Coldiron. Follow each total while players draw, Stay, and use their resources. Let each player control their own hand."
      },
      {
        "num": 10,
        "filename": "10-review-results",
        "title": "Review results and wait",
        "caption": "The status message (1) says the scene is resolved and is waiting for acknowledgments from 2 participants. Players may still react before acknowledging. Wait for their acknowledgments; Force Acknowledge is an emergency control."
      },
      {
        "num": 11,
        "filename": "11-close-scene",
        "title": "Close the completed scene",
        "caption": "Once acknowledgments are complete, click Close Scene (1). This deals earned Rewards and clears the played cards. Optional bonus Scum or Vengeance can be assigned before closing."
      },
      {
        "num": 12,
        "filename": "12-next-scene",
        "title": "Prepare the next scene",
        "caption": "Click New Scene (1) in the Next Scene panel. If it is blocked, wait for required healing choices or Reward discards to finish, then continue with the next challenge."
      },
      {
        "num": 13,
        "filename": "13-azzardo-setup",
        "title": "Advanced: add or return Azzardo",
        "caption": "After choosing participants and drawing an ordinary numbered difficulty below 21, click the deck once more to add optional Azzardo. The extra card stays face down (1), and the total shows '+ ?'. Before Start Scene (2), click that face-down card to return it to the deck if you change your mind. Starting locks this choice. The deck disables Azzardo for Ace, figure and Joker difficulties; Azzardo is also unavailable in Dark and PvP duels."
      },
      {
        "num": 14,
        "filename": "14-azzardo-result",
        "title": "Advanced: resolve an Azzardo scene",
        "caption": "Players draw and Stay normally without knowing the extra difficulty. Azzardo turns face up (1) automatically when the scene resolves. Here the opening difficulty is 10 + 4 = 14, and Azzardo adds 4 for a final target of 18. Mae's 19 and Ash's 18 both succeed. If Azzardo pushes the Marshal's target over 21, non-busted participants succeed. Wait for player reactions and acknowledgments, then Close Scene to deal one Reward to each successful participant. Azzardo does not grant Dark's double Rewards."
      },
      {
        "num": 15,
        "filename": "15-declare-dark",
        "title": "Advanced: declare the Dark before dealing",
        "caption": "Start with a fresh scene and choose its participants. Before drawing any difficulty or choosing Azzardo, click Declare the Dark (1), the small Dark icon in Difficulty / Scene. Then click the deck (2) for the opening hidden difficulty and Start Scene to deal the players' hands. The Marshal sees the opening card; players see a concealed hand and no target value. Use Dark for a final confrontation or a moment of high tension. Dark cannot be combined with Azzardo or a PvP duel; it resets on New Scene."
      },
      {
        "num": 16,
        "filename": "16-dark-hand",
        "title": "Advanced: manage and reveal the Dark hand",
        "caption": "During setup or while players act, click the deck (1) to add cards to your private Dark hand (2). If your total exceeds 21, click the last extra Dark card to discard it before continuing; you cannot reveal while over 21. After every participant has Stayed or busted, REVEAL (3) becomes available. Here your hidden total is 10 + 6 + 3 = 19: Mae's 19 succeeds for two Rewards, while Ash's 18 fails and takes one wound. A failed player also loses one Reward if they have one, choosing it after Close Scene. Reveal, allow reactions and acknowledgments, then Close Scene. Resolve Reward losses, healing and overflow choices before New Scene."
      }
    ]
  },
  "player": {
    "title": "Player Tutorial",
    "steps": [
      {
        "num": 1,
        "filename": "01-join-game",
        "title": "Join your friends",
        "caption": "Paste the Game ID shared by the Marshal into the game_id field (1), then click Join Game (2). Do not click New Game to join an existing session."
      },
      {
        "num": 2,
        "filename": "02-choose-figure",
        "title": "Choose your figure",
        "caption": "In CHOICE mode, click an available Jack, Queen, or King; the highlighted Queen of Diamonds (1) is this guide’s example. Its suit gives your faction power; its rank sets your starting Scum and Vengeance."
      },
      {
        "num": 3,
        "filename": "03-name-character",
        "title": "Name your character",
        "caption": "Click a suggested name, such as Leonor del Paso (1). To write your own instead, scroll to the custom-name field, enter the name, and click Submit."
      },
      {
        "num": 4,
        "filename": "04-choose-feature",
        "title": "Give your character a feature",
        "caption": "Pick a suggested feature, such as a chipped saint medallion (1), or write your own and click Submit. This completes the character’s description."
      },
      {
        "num": 5,
        "filename": "05-ready-and-wait",
        "title": "Your character is ready",
        "caption": "After choosing your name and feature, you are marked ready automatically. The waiting message (1) confirms that you are waiting for the Marshal to start the game. Keep this browser open."
      },
      {
        "num": 6,
        "filename": "06-read-your-board",
        "title": "Read your character board",
        "caption": "Your character’s figure (1) contributes 10 to scene hands. Scum is on the left and Vengeance on the right. The Rewards area (2) holds earned Rewards below your character board; its points are separate from your hand total."
      },
      {
        "num": 7,
        "filename": "07-wait-your-turn",
        "title": "Wait for your turn",
        "caption": "The status message (1) shows that Abner Coldiron is acting. The deck stays disabled while another participant is acting. Wait until the message changes to Your turn; turns follow the initial hand order."
      },
      {
        "num": 8,
        "filename": "08-draw-or-stay",
        "title": "Draw or Stay",
        "caption": "On your turn, click the deck (1) to draw another card, or click Stay (2) to stop. Match or beat the difficulty without going over 21. Your total already includes your character’s 10 points."
      },
      {
        "num": 9,
        "filename": "09-play-vengeance",
        "title": "Boost your hand with Vengeance",
        "caption": "Click your Vengeance pile (1) to spend its top card: +1 to your total, or +2 when its suit matches your character. A boost can still take you over 21."
      },
      {
        "num": 10,
        "filename": "10-faction-power",
        "title": "Optional: use your faction power",
        "caption": "Criollo example: Law of Lead · Convert is already open, and the highlighted Scum card (1) is selected for conversion into Vengeance. Click Confirm conversion (2) to apply it, or Cancel to return to ordinary play. To open this selection, click Law of Lead · Convert. Other factions have different powers."
      },
      {
        "num": 11,
        "filename": "11-play-scum",
        "title": "Optional: target another player",
        "caption": "Click your Scum pile (1), then click an in-scene opponent’s figure (2). Scum targeting is already active in this screenshot. Scum lowers their total by 1, or by 2 when the spent card matches your own character’s suit. Busted players cannot be targeted."
      },
      {
        "num": 12,
        "filename": "12-acknowledge",
        "title": "Confirm the scene result",
        "caption": "Review your outcome, then click Acknowledge (1) when finished. This screenshot shows a bust and one wound. At two wounds, your character is eliminated."
      },
      {
        "num": 13,
        "filename": "13-rewards-and-next",
        "title": "Collect Rewards and continue",
        "caption": "Here is the successful player’s board: the earned Reward card (1) appears after Close Scene and contributes 5 Reward points in this example. Aim for exactly 21 Reward points. If Heal/Skip or Reward-discard choices appear, complete them before the next scene."
      }
    ]
  }
} as const;
