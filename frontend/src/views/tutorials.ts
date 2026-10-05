export const tutorials = {
  "marshal": {
    "title": "Marshal Tutorial",
    "steps": [
      {
        "num": 1,
        "filename": "01-create-game",
        "title": "Create your game",
        "caption": "Click New Game. You become the Marshal of a new game."
      },
      {
        "num": 2,
        "filename": "02-share-game-id",
        "title": "Invite your players",
        "caption": "Click Copy Game ID, then send the copied ID to your friends. Each friend uses it to join from their own browser."
      },
      {
        "num": 3,
        "filename": "03-character-mode",
        "title": "Choose character assignment",
        "caption": "Keep CHOICE so players pick their own figure, or select RANDOM to assign figures randomly. This guide uses CHOICE."
      },
      {
        "num": 4,
        "filename": "04-start-session",
        "title": "Start when everyone is ready",
        "caption": "Players become ready after choosing their figure, name, and feature. When everyone is ready, click Start Game."
      },
      {
        "num": 5,
        "filename": "05-choose-story",
        "title": "Choose the opening story",
        "caption": "Choose a suggested narrative hook or prepare your own. Then click Bring the Frontier to life!! to move to the game table."
      },
      {
        "num": 6,
        "filename": "06-select-participants",
        "title": "Choose who is in the scene",
        "caption": "Click each player who takes part in the challenge. Selected characters appear in Scene Participants. Leave other players outside the scene."
      },
      {
        "num": 7,
        "filename": "07-draw-difficulty",
        "title": "Set the challenge",
        "caption": "For this ordinary scene, leave the Dark off and click the deck once to draw the difficulty. Players must match or exceed it without busting."
      },
      {
        "num": 8,
        "filename": "08-start-scene",
        "title": "Deal the first hands",
        "caption": "The difficulty is set. Click Start Scene to deal one card to each participant. For this introductory scene, skip the optional Azzardo."
      },
      {
        "num": 9,
        "filename": "09-follow-turns",
        "title": "Follow the player turns",
        "caption": "The highest initial hand acts first. Watch Acting now and each total while players draw, stand, and use their resources. Let each player control their own hand."
      },
      {
        "num": 10,
        "filename": "10-review-results",
        "title": "Review results and wait",
        "caption": "The scene resolves when everyone has stood or busted. Players may still react before acknowledging. Wait for their acknowledgments; Force Acknowledge is an emergency control."
      },
      {
        "num": 11,
        "filename": "11-close-scene",
        "title": "Close the completed scene",
        "caption": "Once acknowledgments are complete, click Close Scene. This deals earned Rewards and clears the played cards. Optional bonus Scum or Vengeance can be assigned before closing."
      },
      {
        "num": 12,
        "filename": "12-next-scene",
        "title": "Prepare the next scene",
        "caption": "Click New Scene in the Next Scene panel. If it is blocked, wait for required healing choices or Reward discards to finish, then continue with the next challenge."
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
        "caption": "Paste the Game ID shared by the Marshal, then click Join Game. Do not click New Game to join an existing session."
      },
      {
        "num": 2,
        "filename": "02-choose-figure",
        "title": "Choose your figure",
        "caption": "In CHOICE mode, click an available Jack, Queen, or King. Its suit gives your faction power; its rank sets your starting Scum and Vengeance."
      },
      {
        "num": 3,
        "filename": "03-name-character",
        "title": "Name your character",
        "caption": "Click a suggested name. To write your own instead, scroll to the custom-name field, enter the name, and click Submit."
      },
      {
        "num": 4,
        "filename": "04-choose-feature",
        "title": "Give your character a feature",
        "caption": "Pick a suggested feature, or write your own and click Submit. This completes the character’s description."
      },
      {
        "num": 5,
        "filename": "05-ready-and-wait",
        "title": "Your character is ready",
        "caption": "After choosing your name and feature, you are marked ready automatically. Keep this browser open and wait for the Marshal to start."
      },
      {
        "num": 6,
        "filename": "06-read-your-board",
        "title": "Read your character board",
        "caption": "Your character contributes 10 to scene hands. Scum is on the left, Vengeance on the right, and earned Rewards below. Reward points are separate from your hand total."
      },
      {
        "num": 7,
        "filename": "07-wait-your-turn",
        "title": "Wait for your turn",
        "caption": "Watch the status message and Acting now. The deck stays disabled while another participant is acting; your turn follows the initial hand order."
      },
      {
        "num": 8,
        "filename": "08-draw-or-stay",
        "title": "Draw or Stay",
        "caption": "On your turn, click the deck to draw another card, or click Stay to stop. Match or beat the difficulty without going over 21. Your total already includes your character’s 10 points."
      },
      {
        "num": 9,
        "filename": "09-play-vengeance",
        "title": "Boost your hand with Vengeance",
        "caption": "Click your Vengeance pile to spend its top card: +1 to your total, or +2 when its suit matches your character. A boost can still take you over 21."
      },
      {
        "num": 10,
        "filename": "10-faction-power",
        "title": "Optional: use your faction power",
        "caption": "Criollo example: click Law of Lead · Convert, select a resource card, then Confirm conversion. Other factions have different powers. Cancel returns to ordinary play."
      },
      {
        "num": 11,
        "filename": "11-play-scum",
        "title": "Optional: target another player",
        "caption": "Click your Scum pile, then click an in-scene opponent’s figure. Scum lowers their total by 1, or by 2 when the spent card matches your own character’s suit. Busted players cannot be targeted."
      },
      {
        "num": 12,
        "filename": "12-acknowledge",
        "title": "Confirm the scene result",
        "caption": "Review your outcome, then click Acknowledge when finished. A bust causes a wound. At two wounds, your character is eliminated."
      },
      {
        "num": 13,
        "filename": "13-rewards-and-next",
        "title": "Collect Rewards and continue",
        "caption": "Here is the successful player’s board: earned Rewards appear after Close Scene. Aim for exactly 21 Reward points. If Heal/Skip or Reward-discard choices appear, complete them before the next scene."
      }
    ]
  }
} as const;
