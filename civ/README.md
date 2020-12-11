## Geometry reference

* Origin: 0,0 is in the visual top left of both the game world model and the canvas/device screen. Positive Y, and `Gaming.directions.N`, point down on the screen from the user's perspective: "South is up"
* World: the coordinate system of a game map. 1 unit == 1 tile width
* Tile: a Tile object in a world. Immutable
* Point vs coord terminology, in general:
  * Points are discrete units of pixels or tiles. Assume integers
  * Coords are continuous decimal values in an abstract world
* gridPoint: integer coordinates for a tile. Specifically, the coord of the tile's origin (top-left corner). Primary identity for a Tile object, or positions an object generically within a tile with no further precision
* Coord: A precise location in the world coordinate system.
  * 0,0 origin is the top left corner of tile 0,0
  * 1,1 is the top left of tile 1,1, and adjacent to the bottom right of tile 0,0
  * (1.5, 2.5) is the precise center of tile (1, 2).
  * Tile at position N has points in the range [N,N+1)
* screenPoint: A precise location in device pixel coordinates
  * 1 screen point = 1 device pixel
  * Always rounded to an integer unless otherwise specified
  * Origin is equal to the world origin
* canvasPoint: A device pixel with origin at the top-left of a canvas element
  * The canvasPoint's origin may be offset from the world's origin
  * canvasPoints always have the same scale as screenPoints
* DOMPoint: A device pixel independent coordinate (the `px` unit in CSS/DOM)
  * 1 DOMPoint may equal multiple screenPoints/canvasPoints on high-DPI screens
  * The size of an HTML canvas in screenPoints may be a multiple of its DOM size
  * Use for DOM positioning outside of a canvas context, tracking coordinates of user input DOM events, etc.
