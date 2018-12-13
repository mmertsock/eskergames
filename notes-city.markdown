## Next tasks

### Map tool refactoring

PaletteRenderer has a SelectableList for the current MapTool?
hm is it really a SelectableList?
eh there are multiple types of modalities here.
eg hold shift and drag to temporarily switch to the pan/click tool.
Esc key to revert to the pan/click tool.
tools that may not appear in the current palette.
Might be better to use the general scripting engine. esp since there will likely be multiple objects that are interested in the selected tool and selection changes; and also since the paletterenderer should not be strongly coupled to the maprenderer. so eg trigger a global event when the selected tool changes, and the paletterenderer can listen for that.

Are there interactions with the map canvas *other* than tools?

figure out the difference between:
- the core definition/scripting of individual tools
  - this is a model class that exists for the life of the game and can be used in various ways
  - try to make these stateless
  - independent of the palette (eg tools may not exist on the palette; palette may change, etc.)
  - all the cost and validity calculations, and executing clicks/drags/hovers
- palette selection/rendering
- the usage of a specific tool in a given time period as the mouse moves around
    - responding to dragging and clicking
    - rendering status bar, hover overlays, etc.
    - shifting between tools with key commands
    - eg holding shift to pan - should it pause or cancel the existing command (e.g. start dragging a road, then shift to pan, then continue dragging some more to make a longer road)
    - also a hotkey to shift to the query tool temporarily
    - eg pressing escape to cancel a tool drag (but keep the tool selection). escape when not dragging switches to the pan tool
    - some tools are single-use, eg plopping a gift. revert to the pan tool after usage.

### PointInputController

uses:
- selecting tools from the palette
- clicking on minimaps
- clicking on the main map
- game control panel

each MapTool adds/removes themselves as delegates as they are selected/unselected.
There's always a single active maptool so that should work well.
let the PointInput delegates handle the offset calculations, etc.
Looking up the tile in a canvasgrid: simplest is just having the delegate check controller.canvasGrid.tileAtCSSPoint right? No need for a wrapper in PointInputController?

### Get some basic inputs working

1. click the map and plop an R zone
2. move the hover rect around as you move the mouse
3. actually update the game state when plopping: subtract money, etc.
4. finish the R-plopper tool: canPerformAction, highlightRectForTile, hoverText, etc. idea is to go deep with one tool to make sure the overall architecture is sound before spending lots of time on other tools
5. click the palette and change tools. Maybe use canvas's native hit region concept for this? That could make it pretty generic: tie a hit region to an ID, use the ID to look up a game script to run
6. implement more tools

### Get some actual game logic working to make zones grow

For the zone painter, start with just painting text within the square showing density/value/level of the zones (keep these around as "debug painters" for use in the future, and/or as a query-view like in SNES simcity).

### Query tool popup dialog

First instance of a complex in-game modal dialog.
Pause the run loops and input controllers when modal is visible.

### Save and restore game data, start new city

implement it.
Also implement modal dialog for starting a new city so you can start over.

### Zoom, pan, minimap, and canvas resizing

implement these. Refer to the "FlexCanvasGrid and Viewport" heading below.
implement listening for canvas DOM size changes and refresh the FlexCanvasGrid as appropriate.

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

### Terrain

yeah

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

probably should use requestAnimationFrame instead of setTimeout in the RunLoops?

make sure the run loops autopause when the page is in background

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

- - - - - -
# Resources

http://bucephalus.org/text/CanvasHandbook/CanvasHandbook.html

