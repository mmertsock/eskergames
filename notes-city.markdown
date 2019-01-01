## Next tasks

### Misc

Auto generate help dialog text for keyboard commands.

Game-specific fonts for zones, maps, controls, etc.

New-game dialog.

### JS cleanup

static keyword for static members
set keyword for setters, instead of setX()
var, let, const
convert more types to class instead of function+prototype; use more getters (eg Rect/Point)

### requestAnimationFrame

Run the UI loop either as fast as possible or up to X frames/sec.
Run an iteration of the game engine at the end of a UI loop, whenever X milliseconds have passed since the start of the previous iteration, depending on game speed. 
Perhaps divide the work of a single game engine iteration among several animation frames to avoid the potential lag caused by a doing a full iteration during one frame.

### MapTool incremental development

Done:
- basic class design
- focus rect painting
- palette painting including selected tool
- click the map and plop an R zone onto the map
- update game state when plopping: subtract money, etc.
- click the palette to select a different tool
- implement C-plop, I-plop
- render everything top-down and left-right
- keyboard shortcuts to change tool selection
- Disable the initial debug zones but keep the debug trees
- KVO to update selected tool in the palette
- implement Bulldozer (single clicks)
- center focus rect over mouse for plopPlot
- Plop-tree tool
- Prices
- Feedback text shown after plopping a zone: render at fixed size so it's not tiny when zoomed out

Next:
- conditional logic for tool availability. The MapTool impl class can read/write state into the MapToolSession object; the state data is opaque from the MapToolSession's perspective
  - note basically all of this logic will be duplicated when moving the mouse and when clicking. So when moving the mouse it's like a preview or dry-run of an action. Maybe the City class has a method to Propose an Action, returns an object with cost, allowed, affordable, etc. And then a method to Perform an Action, which creates a new proposal in the identical way then performs it if valid (redo it in case the game state changed; pass the same args to performAction as to proposeAction, and the returned object is basically the same). Note, moving logic out of Tools and into City. So moving the mouse around creates proposal objects and UI is based on that; clicking creates performAction objects which is almost the same from the UI perspective (except it's actually done so add more effects/colors).
  - is-allowed based on budget
  - is-allowed based on plots under the cursor
  - cost calculations
  - caching for performance to reduce the amount of ui run loop calculations would be nice. calculate once per 
    mouse movement at most. but also would need to invalidate when the game state changes if you keep the mouse still
- supplemental hover text next to the focus rect (eg tool glyph + price)
- Allow auto bulldoze of props when building stuff. Alter price based on bulldozing
- helper alt-titles on the palette, eg for keyboard shortcuts
- notAllowed and notAffordable click feedback rendering
- feedback.immediate YAML stuff
- implement Pointer. Panning and zooming map.
- implement Query. First instance of a complex in-game modal dialog. Pause the game run loop and input controllers when modal is visible.
- click-and-drag behavior to preview/commit a larger change (bulldozer, roads)
- only destroy larger plots when clicking the center
- implement Road builder
- modifier keys to push/pop tool sessions (eg switching to Pointer/Query) or changing tool mode (eg showing tile coords with the Pointer/query tool, altering road build pathfinding, etc.)

### Get some actual game logic working to make zones grow

For the zone painter, start with just painting text within the square showing density/value/level of the zones (keep these around as "debug painters" for use in the future, and/or as a query-view like in SNES simcity).

### Zoom, pan, minimap, and canvas resizing

implement these. Refer to the "FlexCanvasGrid and Viewport" heading below.
implement listening for canvas DOM size changes and refresh the FlexCanvasGrid as appropriate.

Arrow keys to move map.
Spacebar to center map on cursor.
Click to center the map when Pointer tool is selected.
Hold a key and click-drag to move the map? At least when the Pointer tool is selected?
Pan the map when holding the cursor near the edge of the map?

### Figure out where to go with graphics before adding more content

Custom drawing scripts vs SVG vs PNG spritesheets?
How to handle different zoom levels, animation frames, and building variants?

### Add more game content and logic

1. Basic zone growth and RCI demand balance.
2. Services buildings and affect on RCI/happiness (eg police)
3. Infrastructure: road, rails, etc.

### Data views and minimaps

Overlays for land value, pollution, crime, etc.
Adding game logic for zones to emit/consume/demand/avoid such environmental data.

### More stuff

Signposts or other ways to label the terrain, infrastructure, buildings.

### Terrain

Create a terrain.html tester/editor page, similar to painter.html, to do all terrain feature development. This could perhaps become the full god-mode terrain editor tool in the end.

### Undo button

This would be cool.
Perhaps what you do is anything done between gameEngine frames goes into a queue or temporary state, and only gets committed fully when the run loop runs a frame?
Or could just use the typical stack-of-functions approach; so plopping an R zone adds an undo function that destroys the R zone and refunds the money. hm since money is involved, and there can be side effects (eg auto-bulldozing terrain), is there really an effective/fair way to do this?

## Further in the future

Max size of individual localStorage values is around 5 MB. So, two options:
- chunk the serialized strings into blocks of size X when writing, and when reading load all chunks, append into a single string, then JSON.parse the large string
- chunk the unserialized data into blocks of cohesive objects, then serialize into strings. This would be the Plots array and maybe some Terrain stuff

- - - - - - - - - - 
# Thoughts #########

## this toolsession thing dosen't make sense

Why should the tool session be stateful and tied to a specific tool?
The pallette always has a single current tool selected (can't ever be no-tool).
And as you move the mouse cursor around, the GameMap itself tracks the 
currently hovered point, and tells the currently active tool to do stuff.

Note we will want some capabilities like holding shift to temporarily switch 
to a "hand" tool to pan the map.

## FlexCanvasGrid and Viewport

FCG has a contentOffset property, in device pixels units. You can setContentOffset 
to shift the map, or setCenter to change the currently visible center point (just 
does a setContentOffset(center.x - width*0.5, center.y - height*0.5)). And etc.
That's all you really need for panning and zooming the map. Can even animate panning 
and zooming by animating the setContentOffset stuff.

Would need to think about this edge padding stuff. Maybe the edge padding is basically 
a modifier for the contentOffset? eg if the edge padding is 2 px, then a contentOffset 
of 0 means the top left tile is inset 2 px; and a contentOffset of 10 means the top left 
tile is inset 12px, etc.

## painting zoomed out stuff in minimaps

Could use filters https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D#filters to smooth out terrain or data-overlay features.
Inspired by the appearance of water/forests in the zoomed out map in SimCity Classic (see screenshot).

## some notes on painting images to canvas

https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D

ctx.lineCap/lineJoin: be sure to set these properly

ctx.createPattern: load an html/svg image element, and use it as a fillStyle. can repeat or not. So, could fill swaths of the terrain using a single repeating createPattern - eg 
paint the entire dirt base layer, then paint chunks of water on top of that.

ctx.drawImage just directly draws an image to canvas at a specified location.
Allows drawing a subrectangle of an image - eg for slicing a spritesheet.

ctx.clip can create clipping masks.

ctx.create/get/putImageData for caching rasterized data.
Could use this to make a cache of certain frequently rendered items?

ctx.add/remove/clearHitRegion to easily determine items the mouse is interacting with.
except Safari doesn't support it.

ctx.filter

## painting game items

eventually should just move to sprite sheets and/or SVG data instead of this paint-script thing.

sprite sheets: one bitmap per zoom level. And a separate bitmap for minimaps where 1 px == 1 tile. Note could still have arbitrary in-between zoom levels: when selecting sprites just round up to the next higher resolution, then use a canvas transform to scale down to the precise size needed.

variants: a given item ID can have any number of variants; variantKey % numVariants determines which sprite-sheet or svg-group to lookup.

Separate spritesheet/svg-group for each item ID + variant? Or big combined files? Or?

maybe instead of (or on top of) a FlexCanvasGrid, have a BitCanvasGrid that is specifically for retro style bitmap gaming. Defines model-pixels-per-device-pixel, pixels-per-tile, etc. Has some paint helper methods that ensure good integer pixel alignment and crisp lines and easy lines/rectangles/dots, etc.


## animating game items

game items can have an "atmospheric animation" that is a simple repeating loop with no real state or meaning; just makes the game look nice (e.g. waving grass, rotating wheels, puffing smoke, blinking lights). animations are one frame per second or something, small number of frames.
use the variantKey to choose which of 60 frames per second to increment the animation frame on - this lets each animated item be a little out of phase, for variety. And don't start them all on frame zero, start on frame N and loop, to further offset them.

## Declarative UI

On startup, parse the HTML. Attach TextLineViews and Bindings to matching HTML elements, etc.

- - - - - -
# Resources

http://bucephalus.org/text/CanvasHandbook/CanvasHandbook.html

https://developer.mozilla.org/en-US/docs/Games/Anatomy
