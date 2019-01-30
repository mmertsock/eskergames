## Next tasks

### First bits of game logic

Initial zone growth and RCI:
- Change density/level of zones
- Calculate population based on zone status
- Update RCI meter

### Misc

Auto generate help dialog text for keyboard commands.
Game-specific fonts for zones, maps, controls, etc.
JS: modules/import

## Viewports, tile planes, and canvas grids

i guess the canvas grid owns the TilePlane and Viewport.
because the offset, flipping, etc., is an artifact of that specific physical representation of the view.
the model should remain as pure as possible.

clicking to center the map: it just moves the offset by `(event.clientY - 0.5*canvas.clientHeight)`, etc.

Viewport's offset is defined in device pixels, not model tiles, to make arbitrary smooth panning easy.
Viewport owns the zoom scale also.


painting:
instead of GameMap.visitEachPlot, it's FlexCanvasGrid.visitEachVisibleTile
It goes top left to bottom right of the screen, which means minX/maxY to maxY/minY model coords.
The callback gives you a model tile coordinate
For each tile coordinate, you look at that Tile in the GameMap and see what Map Objects are present at that tile.
A 3x3 zone will be present on 9 Tiles.
But only the bottom right Tile is the Paint Origin for that tile.
So the Tile's list of map objects has a flag for whether it's the Paint Origin.
So look at the Tile on the map and fetch all object for a given layer with the Paint Origin flag.
And you paint them.

But objects more than 1x1 tiles will not be painted if their Paint Origins are off screen (e.g. bottom and right edges of the screen).
The visitEachVisibleTile has padding of N-1 tiles in each direction beyond the actual visible rect, where N is the largest paintable map object size (e.g. 6 for airport).
So when you look up objects to paint for a tile, you check the Paint Origin flag, and you also check whether that object's full tile rect is actually visible within the viewport (because most of the ones in the padding area will not be visible, e.g. a 1x1 object that's 3 tiles into the padding). Thus only a small fraction of the objects in the padding area are actually painted, maintaining performance.

The first row of tiles outside the map bounds can be painted like a picture frame. Detect which these are via TilePlane.isBorderTile (and TilePlane.isEdgeTile would be the tiles just inside the bounds).
Then beyond that is just black.
Or maybe make it look like the whole city is a miniature model sitting on a drafting table. So outside the map bounds draw an extra large lifelike table thing with some random pens/pencils/paper/coffee/tape/etc.

Animation
Each painter has two properties: frame interval, and frame count.
Frame interval is # of milliseconds each frame lasts. Frame count is number of frames in the entire loop.
At the start of each animation frame, take the timestamp and integer-divide by frame interval to determine the time counter specific to that animation. And then mod the time counter by the frame count to determine which specific animation frame to render.

### requestAnimationFrame

Perhaps divide the work of a single game engine iteration among several animation frames to avoid the potential lag caused by a doing a full iteration during one frame.

web workers + requestAnimationFrame: would be a good time to eliminate direct coupling between renderers/views and the Game object hierarchy. introduce view models with simple, clean, flat KVO structure. the game worker sends updates the view models which trigger KVO notifications in the window context (KVO observations can't travel between worker and window anyway unless i implement remote-kvo), and the UI listens to the view model KVO.

https://www.destroyallsoftware.com/talks/boundaries
GUI app starting around 21 minutes. reminds me of the design ideas i have for using web workers.

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

### Add more game content and logic

1. Basic zone growth and RCI demand balance.
2. Services buildings and affect on RCI/happiness (eg police)
3. Infrastructure: road, rails, etc.

### Data views and minimaps

Overlays for land value, pollution, crime, etc.
Adding game logic for zones to emit/consume/demand/avoid such environmental data.

### More stuff

Signposts or other ways to label the terrain, infrastructure, buildings.

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

## animating game items

animation and smoothing out render performance

a sort of double-buffer approach.

each paintable object registers itself in a collection of items with the same animation speed/frame count
maintain an array of offscreen-prerendered rects for each item
each run loop frame, render to screen using that array of prerendered rects

to populate that prerendered array:
each time that collection of items needs to increment an animation frame, make a queue of all the items in that collection, and initialize a new empty prerendered array
each run loop frame, pre-render a portion of the queued items offscreen into the new prerender array. number of items prerendered depends on queue size and how much time is available. then at the end of that animation frame interval, swap the old and new prerender arrays

also note that we could identify items in the collection that have identical painters and modelMetadata: these can be prerendered once and then painted in multiple places onscreen

- - - - - -
# Resources

https://github.com/graememcc/micropolisJS

http://bucephalus.org/text/CanvasHandbook/CanvasHandbook.html

https://developer.mozilla.org/en-US/docs/Games/Anatomy

https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers

https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas

https://developer.mozilla.org/en-US/docs/Games/Techniques/Tilemaps
