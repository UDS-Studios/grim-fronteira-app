# Grim Fronteira graphical tutorials

Steps 1 and 2: local review artifacts only. No app source changes, commits, or deployment.

- [Marshal tutorial](marshal-tutorial/README.md): 12 numbered PNGs.
- [Player tutorial](player-tutorial/README.md): 13 numbered PNGs.

Each tutorial contains `images/` for integration, `originals/` for real browser screenshots, and `annotations/` for editable self-contained SVGs and step metadata. PNG filenames sort into reading order. Captions are included in the images and README files.

## Source

Captured from a local production build of `UDS-Studios/grim-fronteira-app`, branch `feature/post-deploy-polish`, commit `d2592b2731ba0919ed7dd2950be64947bc17e349`, on 5 October 2026. Two player sessions and a Marshal session used separate local addresses connected to the same isolated backend. No gameplay rules or source files were changed.

## Coverage

The guides demonstrate creation, sharing the Game ID, joining, figure/name/feature selection, automatic readiness, narrative-hook selection, scene participation, difficulty, starting the scene, turn order, Draw/Stay, Vengeance, optional Criollo conversion, Scum targeting, acknowledgment, Close Scene, Rewards, and New Scene.

The actual sample scene includes one success and one bust. The final Player image intentionally switches to the successful player to show the earned Reward. The Law of Lead panel is an optional example; the selected conversion was cancelled before ordinary play resumed.

Detailed Dark, Azzardo, healing, excess-Reward selection, and other faction-power sequences are outside this introductory capture set. The guides mention required post-scene choices, but do not pretend to show controls absent from the sample scene.

## Review and regeneration

Review the individual PNGs at their native size; contact sheets are for overview only. The browser default capture viewport was 1280 x 720 pixels. Annotation layouts preserve the original screenshot size and add a title and caption outside the screenshot.

Edit `captures.json`, then run `python3 render_annotations.py` with Pillow and DejaVu Sans installed. This regenerates the PNGs, editable SVGs, per-role step metadata, README sequences, and contact sheets. The original browser screenshots are preserved.

For app integration, use the two `images/` folders and README/step metadata. The originals, editing sources, and review sheets are authoring assets, not required web-app assets.
