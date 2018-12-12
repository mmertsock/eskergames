## Tasks and stuff

### Reading list

- https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Advanced_animations
- https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas
- https://developer.mozilla.org/en-US/docs/Games/Techniques/2D_collision_detection

### Next tasks

- Make a basic framework for terrain movement rules, e.g. can't walk through a wall
- Implement a few pieces of decent looking fully rendered on-screen content
- Start putting together an idea for the story and stuff
- requestAnimationFrame
- Scene refactoring, see #SceneStuff below
- In runLoop delegates, beware of effect of pausing/resuming game of values scaled by time differences.
  e.g. calculating position changes.
  these should be based on the "game clock", not raw Date values.
  So, the Game object should have a "clock" member, it updates normally when the RunLoop is running, but
  skips gaps in time when the runloop pauses.

## General game goals/ideas

- Player character's appearance == equipped items
- SoE style alchemy. Plus maybe multi-player-character tec skills (alchemy-based or not) like from chrono trigger. Area/line/whole-screen/etc. effects for various alchemies
- Crafting/upgrading of weaponry and tools. Skills development more important than straight leveling. I like the food system of BOTW - that could get along nicely with alchemy. The elxir/food dichotomy seems meh in BOTW; elixirs seem unnecessary even. But Alchemy could be done via elixir-type ingredients? e.g. monster parts + minerals
- Limited inventory. Player can set up Safe Houses to rest/heal/store stuff. Maybe Safe Houses are necessary in the wild/overworld because of a dearth of inns or magic-glowing-save-restore-points.
- I also like the more realistic money system in BOTW. Less reliance on money. Barter could be a thing maybe?
- And also the weapon/drop system. e.g. there are lots of everyday weapons that monsters can pick up and drop. Though this probably only works well in a realtime system, not turn based. Could RPGify it by having players develop skill/levels in various weapon classes, that stay with the player rather than the weapon, so the weapon strength is 50% based on the player skill
- Wonder if it could be interesting to have a "rotate" mechanic. Like you can rotate the game map to be able to see around corners and stuff. Could allow cliff climbing that way; auto rotate the map when going around a corner. Some puzzles might rely on rotation to figure out visual clues or riddles

### Plot ideas

- Player-character-switch + time travel: game plot kills the main party. Fade out, fade in 100 years later, and a stranger finds your dropped gear++ and some clue to what was going on. The world has fallen apart++ as a consequence of your party dying. You take control of the stranger, with your old gear, and do a mini quest for a while. Succeeding means something time-wimey happens (maybe the discarded gear includes a time travel device) that means your party never died, and then you go back to playing with your original party (with thear gear restored and stuff), but your party has no knowledge++ of what happened. (++ means things that add drama/impact to the story)
- Time travel, continued: if time travel becomes a thing, maybe don't go all the way with it, where you end up having basically full control over temporal travel. Don't allow using it whenever/wherever you want. Maybe it's a mysterious device or secret cave or something that is unpredictable and dangerous and maybe part of the evil you're trying to defeat (and thus must eventually be destroyed). First couple times time travel happens, maybe make it unclear time travel is what's actually happening. Maybe the post-party-death thing above is actually the big reveal. Maybe the device can only do temporary time travel visits, or projections, like in Days of Future Past: this makes it easy to think the device is initially just showing alternate worlds/dream states/spatial portals/etc. Maybe you think you're looking at some alternate world all this time, until this stranger picks up your device and does a projection and sees your own party dying, just like happened in the game a minute ago, and that's the reveal. And maybe after you finish playing with the stranger, later in the game, you see ghosts or glimpses of the stranger as she continues to project into and affect your present. And maybe earlier in the game too, as foreshadowing: at that point it's really a stranger and a mystery, and it helps solidify the reveal/connection in the post-death scene.

---------------------------------------------------------------------------

## Terrain movement rules

General thoughts on the "general thoughts on the below" below: it's going to be easy to over-think this and hit a slippery slope of "that solution isn't good enough for hypothetical X", which will always be true. So pick a game style and build to that, instead of picking an tech solution and building a game for it. So, what's the game style? 16-bit RPG is about as sophisticated I can implement, and about as sophisticated as I can do art for. What style though? LTTP? JPRG? Evermore? Earthbound? Remember that this is *not* an SNES: computing power, display resolution/fidelity, framerates will come in spades for free. So, could do a take on the SNESRPG that uses layers/transparency, high res stuff, subtler colors, etc., to give it a different look on top of a retro play style. So. Top-down view. Straight x/y axis. Not sure on turn based vs realtime play. If turn-based, can keep the movement mechanics much simpler. Realtime play would require much more response movement and controls or it becomes frustrating. Start with aiming toward the former; battle system decision can come a little later after getting *something* working and having a start on the actual content and story. So for now, just get to the point of a visible player walking around a usable overworld. Let's pick a simple implementation of Option B.

General thoughts on the below: I'm guessing 16-bit RPGs are based on a simple tile-based option A or B. No idea how things work for more advanced games.
Reading up on this, looks like the player character will have a simple "axis aligned bounding box" (i.e. a square always aligned to the main X/Y axis), and that's used for hit tests against similar bounding boxes of obstacles. So a wall or fence may be a series of such hitboxes. Not sure how this explains smooth against-the-wall motion though if it's two boxes sliding against each other.

So, the options below discuss zones or boxes with that affect movement. Are they separate from the SceneItems? Guessing yes. But, the map config yaml might define the movement rules as part of the scene item definitions (e.g. a wall object also generates movement rules for its rect). So when populating a scene, you generate SceneItems and movement zones simultaneously. This allows the movement definitions to follow the visual items theyre based on, reducing duplicate data. Could additionally specify arbitrary movement rules in a separate yaml struct as needed.

Could even have hueristics to auto-generate rules for surrounding areas? e.g. a hut could have a HutSceneItem with width/height of 5 m. It generates a 5x5 rect of No Movement Allowed, a special square punched out at the door location with a GoToMap movement rule, and a series of wall/diagonal rules in a surrounding 1m wide strip. Either the HutSceneItem programatically generates it, or HutSceneItem has a yaml template that sets all this up, e.g.:

    hutTemplate: &HUT_TEMPLATE
      type: HutSceneItem
      size: [5,5] # SceneItems generally allow position+size as alternative to rect, for templating
      children:
      - type: WallHitBox
        rect: [0,1,5,3]
      - type: WallHitBox #okay for walls to overlap
        rect: [1,0,3,5]
      - type: DoorHitBox #overrides walls - that will always be a useful exception
        rect: [2,0,1,1]
      - type: DiagonalWallHitBox
        rect: [0,0,1,1]
        orientation: SW # like a Normal Force or something
      - type: DiagonalWallHitBox
        rect: [0,4,1,1]
        orientation: SE
      # and also NW, NE diagonals

Long diagonal walls in general are going to be a pain to set up. Any way to generate these?
e.g. this could generate a wall of length 4, with all the little squares:

    type: LinearWallSceneItem
    start: [0,3]
    end: [4,7]

Note that hit boxes may need to be dynamic. e.g. a moving obstacle. NPCs and enemies. Walls that appear or disappear based on switches. Doors that are locked and unlocked. Chests.
So, maybe hit boxes should remain as properties of model items. But model items not necessarily == SceneItems. Could have some static standalone SceneItems for scenery that will never change. But anything that can move, is interactive, etc., would need a SceneItem that can dynamically update + a potential hitbox + potential script triggers. So, a model plus a SceneItem is called for here.

Again, the Scene could become a bigger controller type thing that knows about model objects and handles their interactions and movements, and the existing Scene code becomes a ScenePainter with the sole job of tracking and updating rendering state - it is a container that gets populated by the Scene/Map/etc. and only weakly knows the identity of its items.

Option A: define regions where player is allowed to move

Problem here is lots of weird shapes. If you do it via collection of rectangles, you get lots of jaggy edges to get stuck in, and need to be careful with the "seams" between rects.

Maybe could tile the map in terms of movement rules, and use tiling math to determine the relevant rect for movement rules. And for things like diagonal walls, have special movement rules for those zones to deflect the player diagnally. e.g. in LTTP, moving N along a NW-SE diagonal wall pushes the player in a NW direction. Define this by having a series of square tiles along that edge that have a Deflect45 movement rule.

Advanced option A: define where allowed to move, via arbitrary polygon instead of rect collection.

This would allow more advanced layout, and eliminate some of the hacks of Option A. But more complicated to implement. And the math for determining movement legality is more complicated. Especially since trying to do a single big polygon means it's not a convex poly, which makes the math either a lot harder or impossible.

Stopping player at edges, push-player-diagonally-along-edges, etc. would be done via generic collision detection.

Option B: define where player is *not* allowed to move

This might be a little safer and easier to work with than Option A. Safer b/c the safe zone can be a large contiguous region. Could make the rects arbitrary size rather than tiled.

Still need edge logic though. So maybe it's "player can move freely using the normal rules, unless on a rect that prohibits or modifies movement".

Advanced option would be convex polygons instead of rects. Can more easily do convex polygons everywhere, and collections of overlapping ones as needed, because it's defining the No rather than the Yes.

---------------------------------------------------------------------------

## Scene stuff

Should the state of the game not be a currentMap, but a currentScene?
Rename the Scene class to ScenePainter.
Then FiresOfEmbora.Scene = a new model class. Scene has a Map, and also 
directs how the player enters or participates in the scene (if at all). And 
is a container/event-source/trigger for Scripts. And sets the h2 title above 
the gameView. And sets up the ScenePainter - various scene types may have 
different rendering modes?

Particle
is a non-interactive, ephemeral Sprite.
Instantiate it with a predefined, finite queue of motions.
Once it finishes its motions, it goes away.

Scene
Is the model in which things are painted.
It has layers, registers and tracks sprites, etc.
A scene might have an overworld/underworld/village map as a basis.
Or a battle stage. Or a cutscene. In-game menu. etc.
So, basic scene types: WorldScene, BattleScene, CutScene, MenuScene
MenuScene might not be a type of Scene at all. Maybe you actually keep the 
underlying Scene, in a Paused state (entire Game is paused likely), and show an entirely
separate canvas elem on top of the main canvas for the Menus. Or even HTMLCSS instead of canvas?

ctx2D things of note:
- retina drawing: ctx.webkitBackingStorePixelRatio == 1, but window.devicePixelRatio = 2.
  https://www.html5rocks.com/en/tutorials/canvas/hidpi/ implies it should automatically be 2 and 2.
  So did I break that with my canvas sizing stuff? also 
  https://gist.github.com/amadeus/3712795
  used https://stackoverflow.com/a/16429619/795339
- .createPattern would be a great way to fill terrain areas:
  https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Applying_styles_and_colors
  - could group adjacent tiles with identical terrain into blobs on the map. find their outer border and 
    build that as a Path in the painting context, then Fill the path with the pattern.
    - "islands" in the middle would need to be done carefully: either make them proper Holes in the path
      for filling purposes, or repaint the islands on top of the base area
  - might just be easier to manually tile; may want to do that anyway to have some variety in the textures

---------------------------------------------------------------------------

## Game plot scripting

Each script has an id. There's a start script that runs to start the game.
Other scripts are triggered by locations, characters, actions.
Scripts are things like:
- start script: 
  1 all-black cutscene. Show text x. show text y. show text z.
  2 go to map 1, put player at location x. Initialize Scene via fade-from-black
  3 show text a. show text b
  4 set major objective X as active+incomplete
- player encounters a certain character:
  1 do special dialog x*
  2 update minor objective y
  3 add item x to inventory
  4 change terrain on map z
* So, NPCs have Dialogs, which they automatically play when encountered. An NPC can have multiple
dialogs, with predicates for each (e.g. the state of a given game objective). Each Dialog has 
multiple pages or whatever, and any given page can trigger a script. S in the example above,
the special dialog is triggered by a predicate, and various micro-scripts are triggered after 
finishing various pages of Dialog. Or maybe just say that Dialogs themselves are special kinds 
of scripts rather than triggering scripts. Since it would be common to do micro actions within 
dialogs; no need to register a Script for each one of them.

---------------------------------------------------------------------------

## The new Map class

The config data is tiled, but tiles aren't the single language of map data.
- some basic metadata: map name and id. map type (over/underworld, etc.)
- styling info: unit size/tile size, which styling set/icon set/theme/flavor/whatever to use
- a map has a Base Texture, e.g. dirt, rock, sand, ice, water, whatever: a simple 
  solid color or something to fill the gaps or transparencies in data
    - this directly feeds the Scene.canvasFillStyle value
- consider https://github.com/nodeca/js-yaml for the raw data
    - maybe. probably stick with JSON
    - lack of multiline string support in JSON is a big problem though.
    - and then if you start scripting game story and text, multiline/markup support gets more important
- the bulk of the terrain type data is tiled
- other stuff is not necessarily tiled; specific objects set to arbitrary coordinates
- tiles are Centered on a coordinate (e.g. tile at 0,0 with width 20 has bbox -10...10).
- could be useful to be able to express the location of an item in both Game Unit and Tile coordinates 
  (e.g. a chest could be at tile 3,5, or game unit location 75,125).
- what's the Origin for the Map? bottom left? exactly the center? maybe 
  pick an arbitrary location? maybe the defaultPlayerStartLocation is the orgin? (though that
  breaks down when there is zero or multiple or dynamic locations)
  - bottom left probably easiest and most flexible/consistent to program. won't always have as
    much meaning during content creation but whatever. probably best to have the content creation
    data formats/tools not require direct manipulation of coordinate values anyway.
- note the possibility of a "matte painting background" for a Map. think the death mountain/pyramid
  bg scenery in LTTP. (which was parallax too)

A single letter may not be enough to represent all the possible tile decoration types, etc. And even 
if it is, it will get unreadable anyway. So a graphical editor with whatever data format is programmer
friendly may be worth the effort.

When we move to a new map, we create a Scene and a new canvas for it, and then we need to populate the scene.
The Map comes with some static stuff: terrain, structures, etc. But we also need to set up the Player's 
position on the map (and maybe velocity, if you're "walking in" from the edge), and populate with dynamic 
stuff (NPCs, enemies, chests, etc.). Populating the Scene uses a variety of sources: map transition logic
to move a player from one map to another (with variations based on map type), using either edge-connections 
or special portal locations (e.g. doors/stairs); game scripting for specific plot moments; random generation.

possible string representation:
AB AB AB AB  like monitor pixels: this is a 4x2 set of tiles, with four characters per tile.
CD CD CD CD  allows packing up to four pieces of overlapping data into a single grid.
AB AB AB AB
CD CD CD CD

or, ONLY the base terrain is in a grid, and everything else is just a flat list of items
or one grid for base terrain, one grid for terrain decor, etc.
or terrain decor is purely generative, don't hand-draw it.

There are two distinct purposes to Terrain:
1. in the model, to affect movement/behaviors/enemies/etc.
2. in the view, to display the scene
There's not a 1-1 correspondence between these two things. e.g.:
- Multiple subtypes of model, e.g.: Large vs small desert. Decorative vs functional terrains. 
  Terrain that looks like X but behaves more like Y. Interior vs edge terrain areas.
- Various subsets of a given terrain area are rendered differently. e.g. corners and edges get certain
  tiles and sprites vs interior. Then you add decor and stuff.
So, maybe separate the two entirely. There's the map model, and then there's the map decoration.

Instead of tiles, could have arbitrary rectangles for both the model and view:
- one big rectangle for a large area of unbroken terrain
- smaller rectangles (long and narrow, or little squares on corners) for edge displays and edge behaviors
- arbitrary amounts of overlap, e.g. smaller regions within a larger one for decoration and stuff - here's where
  having arbitrary amount of map layers helps. Maybe get rid of the idea of a fixed set of layers and just have
  Z indexes. Possibly have a much smaller set of named layers if you end up having animation concepts 
  like parallax. But yeah.
- A given rectangle can be any abitrary size. You then give it a solid color, a repeating texture, or have it 
  tile randomly from a given icon set, or have it be a generator of random point objects (e.g. trees) with 
  a given size and distribution.

Another map design idea:
Every map is a "matte painting" for the entire surface. A soft look to it. Then add some gentle props 
and animations (moving grass/trees, bugs, atmosphere) on top. So, no tiled stuff.

Maybe have a couple of 
layers to it that move in very slight parallax, like old disney cartoons? I think the parallax 
can be implemented by having a second layer for the "high" stuff, with 1:1 model size correspondence to the
entire map. But, to render you scale the entire thing 5% larger, and then always translate it so that the 
model coordinate centered on the screen == the same coordinate of the base map. (iow, off in the distance, 
the edge of the overlay will be hanging over past the edge of the base map)
This would only be interesting if the entire map is seamless scrolling design instead of like zelda 1.


    // var Map = function(config) {
    //     this.id = config.id;
    //     this.name = config.name;
    //     this.defaultStartLocation = null;

    //     this.tiles = config.data.split("\n").map(function (line, row) {
    //         return line.split("").map(function (dataChar, column) {
    //             var tile = new Tile({
    //                 location: { row: row, column: column },
    //                 terrain: Terrain.fromData(dataChar)
    //             });
    //             if (dataChar == "S") {
    //                 this.defaultStartLocation = tile.location;
    //             }
    //             return tile;
    //         }.bind(this));
    //     }.bind(this));
    // };

    // in game units, not tiles or anything.
    // game unit is roughly 10 cm?
    // Map.prototype.getSizeInfo = function() {
    //     return { width: 900, height: 500, tileWidth: 25 };
    // };

    // Map.prototype.getTile = function(location) {
    //     if (!this.tiles) { return null; }
    //     if (location.row < 0 || location.column < 0 || location.row >= this.tiles.length || location.column >= this.tiles[0].length) {
    //         return null;
    //     }
    //     return this.tiles[location.row][location.column];
    // };

    // Map.prototype.visitTiles = function(visitor) {
    //     for (var rowIndex = 0; rowIndex < this.settings.rows; rowIndex++) {
    //         for (var colIndex = 0; colIndex < this.settings.columns; colIndex++) {
    //             visitor(this.tiles[rowIndex][colIndex]);
    //         }
    //     }
    // };

    /*
    key
    Initial lines:
        map ID
        map Name
    reserved characters:
    # at beginning: entire line is markup
    (colon): inline markup; data is only in line.split(":")[1]
    (space): open ground
    S: start position
    w: water

    */

    // var markedUpData = `
    // firsensa
    // Village of Firsensa
    // #          10        20        30
    // #  012345678901234567890123456789012345
    // #  ------------------------------------
    //  0:wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww
    //  1:wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww
    //  2:wwwwwwwwwwwww       wwwwwwwwwwwwwwww
    //  3:wwwwwwww                wwwwwwwwwwww
    //  4:wwwww                      wwwwwwwww
    //  5:wwww                        wwwwwwww
    //  6:wwwww                      wwwwwwwww
    //  7:wwwwww                   wwwwwwwwwww
    //  8:wwwwwwww               wwwwwwwwwwwww: this can be a comment too
    //  9:wwwwwwwwwwww          wwwwwwwwwwwwww
    // 10:wwwwwwwwwwwwwww       wwwwwwwwwwwwww
    // 11:wwwwwwwwwwwwwwwww      wwwwwwwwwwwww
    // 12:wwwwwwwwwwwwwwww        wwwwwwwwwwww
    // 13:wwwwwwwwwwwwwwwwww     wwwwwwwwwwwww
    // 14:wwwwwwwwwwwwwwww   S  wwwwwwwwwwwwww
    // 15:wwwwwwwwwwww         wwwwwwwwwwwwwww
    // 16:wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww
    // 17:wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww
    // 18:wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww
    // 19:wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww
    // `; // end data

    // Map.configFromText = function(markedUp) {
    //     var lines = markedUp.trim().split("\n");
    //     var id = lines.shift();
    //     var name = lines.shift();
    //     var cleanLines = lines.filter(function (line) {
    //         return !line.startsWith("#")
    //     }).map(function (line) {
    //         return line.indexOf(":") >= 0 ? line.split(":")[1] : line;
    //     });
    //     return {
    //         id: id,
    //         name: name,
    //         data: cleanLines.join("\n")
    //     };
    // };

    // var allMapConfigs = [
    //     Map.configFromText(markedUpData)
    // ];


    // config: {game, moveSpeed}
    // var Player = function(config) {
    //     this.game = config.game;
    //     this.moveSpeed = config.moveSpeed;
    //     this.moveSpeedY = -config.moveSpeed;
    //     this.movement = new Gaming.Movement({ runLoop: mainRunLoop, initialPosition: new Point() });

    //     // Paintable contract
    //     this.renderedSinceLastStop = false;
    // };

    // Paintable contract
    // Player.prototype.isDirty = function() {
    //     return this.movement.isMoving() || !this.renderedSinceLastStop;
    // };
    // Player.prototype.getBoundingBox = function() { 
    //     var pos = this.getPosition();
    //     return new Rect(pos.x - 0.5, pos.y - 0.5, 1, 1);
    // };
    // Player.prototype.render = function(ctx) {
    //     ctx.strokeStyle = "hsl(114, 100%, 46%)";
    //     ctx.rectStroke(this.getBoundingBox());
    //     this.renderedSinceLastStop = true;
    // };
    // end Paintable contract

    // Player.prototype.getPosition = function() {
    //     return this.movement.position;
    // };

    // Player.prototype.move = function(direction) {
    //     this.movement.goToVelocity(
    //         Vector.unitsByDirection[direction].scaled(this.moveSpeed, this.moveSpeedY),
    //         Gaming.Easing.quick());
    // };

    // Player.prototype.stopMoving = function() {
    //     this.movement.goToVelocity(new Vector(), Gaming.Easing.quick());
    // };

    // Player.prototype.moveToPosition = function(newPosition) {
    //     this.movement.setPosition(newPosition);
    // };
