## Geometry reference

* Origin: 0,0 is in the visual top left of both the game world model and the canvas/device screen. Positive Y, and `Gaming.directions.N`, point down on the screen from the user's perspective: "South is up"
* World/Planet: the coordinate system of a game map. 1 unit == 1 square/tile width
* Square: a physical space in a Planet containing objects, located at a Tile
* Tile: describes coordinate/location of a Square on a Planet. Immutable
  * A tile's `coord` is the integer coordinate of the Tile's origin/top-left corner. The Tile's unique identifier
* Point vs coord terminology, in general:
  * Points are discrete units of pixels. Assume integers
  * Coords are continuous decimal values in an abstract world
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

Example:

```
0,0-----EH1-----1,0-----EH2--
 | C1            | C2
 |               |
EV1     T1      EV2     T2
 |               |
 |               |
0,1-----EH3-----1,1------
```

All coordinates are in World units.
T1 = Tile(0, 0)
T1.coord == (0, 0)
T1.centerCoord == (0.5, 0.5)
T1 renders as a rect (0, 0, 1, 1)
C1 == corner of T1, at (0, 0)
T1.edges == [EH1, EV1]

EH1 = TileEdge(T1, TileEdge.H)
EH1 renders as a line from (0,0) to (1,0)
EH1's adjacent tiles are [T1, Tile(0, -1)]
EV1 = TileEdge(T1, TileEdge.V)
EV1 renders as a line from (0,0) to (0,1)
EV1's adjacent tiles are [T1, Tile(-1, 0)]
T2's edges are [EH2, EV2] and its corner is C2
EV2's adjacent tiles are [T2, T1]
