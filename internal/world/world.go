// Package world defines and generates the hand-tuned isometric village of
// Emberwood Vale. Terrain, props and collision data are generated once on the
// server and delivered to the browser as JSON.
package world

import (
	"fmt"
	"math"
	"math/rand"
	"strings"
)

const (
	Version   = 1
	MapW      = 64
	MapH      = 64
	WispTotal = 5
)

// Terrain codes. These indexes correspond to atlas rows in the frontend.
const (
	Grass = iota
	Dirt
	Stone
	Sand
	Forest
)

type Vec struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Building struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Art      string  `json:"art"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	W        int     `json:"w"`
	H        int     `json:"h"`
	Scale    float64 `json:"scale"`
	Interact Vec     `json:"interact"`
	Radius   float64 `json:"radius"`
	Text     string  `json:"text"`
}

type Prop struct {
	Kind     string  `json:"kind"`
	Art      string  `json:"art,omitempty"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Scale    float64 `json:"scale,omitempty"`
	Flip     bool    `json:"flip,omitempty"`
	Blocking bool    `json:"blocking,omitempty"`
	Variant  int     `json:"variant,omitempty"`
}

type Wisp struct {
	ID string  `json:"id"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
}

type Interactable struct {
	ID   string  `json:"id"`
	Kind string  `json:"kind"`
	Name string  `json:"name"`
	Text string  `json:"text"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	R    float64 `json:"r"`
}

type World struct {
	Version       int            `json:"version"`
	Seed          int64          `json:"seed"`
	Name          string         `json:"name"`
	Subtitle      string         `json:"subtitle"`
	Width         int            `json:"width"`
	Height        int            `json:"height"`
	Terrain       []string       `json:"terrain"`
	Blocked       []string       `json:"blocked"`
	Spawn         Vec            `json:"spawn"`
	SpawnDir      int            `json:"spawnDir"`
	Buildings     []Building     `json:"buildings"`
	Props         []Prop         `json:"props"`
	Wisps         []Wisp         `json:"wisps"`
	Interactables []Interactable `json:"interactables"`
	WispTotal     int            `json:"wispTotal"`
}

type generator struct {
	rng       *rand.Rand
	terrain   [][]int
	blocked   [][]bool
	props     []Prop
	occupied  [][]bool
	buildings []Building
}

func (g *generator) inBounds(x, y int) bool {
	return x >= 0 && y >= 0 && x < MapW && y < MapH
}

func (g *generator) tile(x, y int) int {
	if !g.inBounds(x, y) {
		return Forest
	}
	return g.terrain[y][x]
}

func (g *generator) setTile(x, y, code int) {
	if g.inBounds(x, y) {
		g.terrain[y][x] = code
	}
}

func (g *generator) block(x, y int) {
	if g.inBounds(x, y) {
		g.blocked[y][x] = true
	}
}

func (g *generator) isBlocked(x, y int) bool {
	if !g.inBounds(x, y) {
		return true
	}
	return g.blocked[y][x]
}

// Generate builds a fresh, deterministic world.
func Generate(seed int64) *World {
	g := &generator{
		rng:      rand.New(rand.NewSource(seed)),
		terrain:  make([][]int, MapH),
		blocked:  make([][]bool, MapH),
		occupied: make([][]bool, MapH),
	}
	for y := 0; y < MapH; y++ {
		g.terrain[y] = make([]int, MapW)
		g.blocked[y] = make([]bool, MapW)
		g.occupied[y] = make([]bool, MapW)
	}

	g.paintClearing()
	g.paintVillage()
	g.placePond()
	g.placeBuildings()
	g.placeForest()
	g.placeVillageTrees()
	g.placeDetails()

	w := &World{
		Version:   Version,
		Seed:      seed,
		Name:      "Emberwood Vale",
		Subtitle:  "A quiet vale at the edge of the wild",
		Width:     MapW,
		Height:    MapH,
		Spawn:     Vec{36, 46},
		SpawnDir:  2,
		Buildings: g.buildings,
		Props:     g.props,
		WispTotal: WispTotal,
	}
	w.Wisps = []Wisp{
		{ID: "wisp-pond", X: 19.2, Y: 35.6},
		{ID: "wisp-north", X: 29.4, Y: 21.2},
		{ID: "wisp-orchard", X: 45.2, Y: 28.6},
		{ID: "wisp-lane", X: 34.2, Y: 48.2},
		{ID: "wisp-west", X: 19.0, Y: 30.4},
	}

	w.Interactables = []Interactable{
		{
			ID: "brazier", Kind: "brazier", Name: "The Cold Brazier",
			Text: "Old iron and river stone. Five ember wisps once kept this flame alive — now only grey ash remains.",
			X:    31, Y: 30.4, R: 2.5,
		},
		{
			ID: "cottage-a", Kind: "building", Name: "Thatcher's Cottage",
			Text: "The shutters are latched, but the smell of fresh bread curls from the chimney. Someone is home.",
			X:    25, Y: 30.7, R: 2.6,
		},
		{
			ID: "cottage-b", Kind: "building", Name: "Herbkeeper's Cottage",
			Text: "Bundles of lavender and rosemary hang beneath the eaves. A small garden hums with bees.",
			X:    37, Y: 29.7, R: 2.6,
		},
		{
			ID: "cottage-c", Kind: "building", Name: "Miller's Rest",
			Text: "A well-worn well stands beside the door, its rope still damp. The miller is away at the harvest fair.",
			X:    38, Y: 41.4, R: 2.7,
		},
		{
			ID: "blacksmith", Kind: "building", Name: "The Quiet Forge",
			Text: "The forge is cold. Tools wait on their pegs, and a half-finished blade rests on the anvil.",
			X:    42, Y: 37.0, R: 3.1,
		},
		{
			ID: "pond", Kind: "pond", Name: "Stillwater Pond",
			Text: "Dragonflies stitch silver lines across the water. For a moment, the whole vale seems to hold its breath.",
			X:    21, Y: 39, R: 4.6,
		},
		{
			ID: "old-oak", Kind: "tree", Name: "The Elder Oak",
			Text: "This ancient tree has watched over the vale for centuries. Its roots are warm beneath your hand.",
			X:    34, Y: 23.6, R: 2.6,
		},
	}

	// Move interaction points to the nearest walkable tile so every prompt can
	// actually be reached, then spawn the player on solid ground.
	for i := range w.Interactables {
		x, y := nearestWalkable(g, w.Interactables[i].X, w.Interactables[i].Y, 3)
		w.Interactables[i].X, w.Interactables[i].Y = x, y
	}
	for i := range w.Wisps {
		x, y := nearestWalkable(g, w.Wisps[i].X, w.Wisps[i].Y, 4)
		w.Wisps[i].X, w.Wisps[i].Y = x, y
	}
	spawnX, spawnY := nearestWalkable(g, w.Spawn.X, w.Spawn.Y, 4)
	w.Spawn = Vec{spawnX, spawnY}

	w.Terrain = encode(g.terrain, func(v int) byte { return byte('0' + v) })
	w.Blocked = encodeBool(g.blocked)

	if !g.reachable(spawnX, spawnY, w) {
		panic("world generation produced an unreachable map")
	}
	return w
}

func encode(grid [][]int, fn func(int) byte) []string {
	rows := make([]string, len(grid))
	for y, row := range grid {
		b := make([]byte, len(row))
		for x, v := range row {
			b[x] = fn(v)
		}
		rows[y] = string(b)
	}
	return rows
}

func encodeBool(grid [][]bool) []string {
	rows := make([]string, len(grid))
	for y, row := range grid {
		b := make([]byte, len(row))
		for x, v := range row {
			if v {
				b[x] = '1'
			} else {
				b[x] = '0'
			}
		}
		rows[y] = string(b)
	}
	return rows
}

func (g *generator) paintClearing() {
	for y := 0; y < MapH; y++ {
		for x := 0; x < MapW; x++ {
			d := math.Hypot(float64(x-32), float64(y-32))
			edge := 22.4 +
				2.2*math.Sin(float64(x)*0.39+1.3) +
				1.6*math.Sin(float64(y)*0.47+2.1) +
				0.8*math.Sin(float64(x+y)*0.21+0.4)
			if d > edge {
				g.terrain[y][x] = Forest
				g.blocked[y][x] = true
			} else {
				g.terrain[y][x] = Grass
			}
		}
	}
}

func (g *generator) paintVillage() {
	// Broad dirt lanes first, then the stone heart of the village.
	g.paintPath([]Vec{{36, 47}, {35.5, 43}, {33.5, 38}, {31.5, 34}, {31, 31}}, 1.25, Dirt)
	g.paintPath([]Vec{{31, 31}, {27.5, 30}, {25, 30.8}}, 1.0, Dirt)
	g.paintPath([]Vec{{31, 31}, {34, 30}, {37, 29.7}}, 1.0, Dirt)
	g.paintPath([]Vec{{31, 31}, {34, 35}, {37, 39}, {38, 41.2}}, 1.0, Dirt)
	g.paintPath([]Vec{{31, 31}, {36, 32.5}, {42, 36.8}}, 1.1, Dirt)
	g.paintPath([]Vec{{31, 31}, {27.5, 34.5}, {24, 37.5}, {23.4, 39.2}}, 1.0, Dirt)
	g.paintPath([]Vec{{31, 31}, {31.8, 27}, {33.8, 24}}, 0.9, Dirt)
	g.paintPath([]Vec{{31, 31}, {31.5, 35.5}, {34, 41}, {34.5, 47.5}}, 0.85, Dirt)

	// Stone plaza with a soft, hand-painted edge.
	g.paintDisc(31, 31, 4.1, Stone)
	g.paintDisc(31, 31, 3.0, Stone)
}

func (g *generator) paintPath(points []Vec, radius float64, code int) {
	for i := 0; i < len(points)-1; i++ {
		a, b := points[i], points[i+1]
		dist := math.Hypot(b.X-a.X, b.Y-a.Y)
		steps := int(dist*4) + 1
		for s := 0; s <= steps; s++ {
			t := float64(s) / float64(steps)
			cx := a.X + (b.X-a.X)*t
			cy := a.Y + (b.Y-a.Y)*t
			r := radius + 0.25*math.Sin(float64(s)*0.9)
			for y := int(cy - r - 1); y <= int(cy+r+1); y++ {
				for x := int(cx - r - 1); x <= int(cx+r+1); x++ {
					dx, dy := float64(x)-cx, float64(y)-cy
					if math.Hypot(dx, dy) <= r {
						g.setTile(x, y, code)
					}
				}
			}
		}
	}
}

func (g *generator) paintDisc(cx, cy, radius float64, code int) {
	for y := int(cy - radius - 1); y <= int(cy+radius+1); y++ {
		for x := int(cx - radius - 1); x <= int(cx+radius+1); x++ {
			dx, dy := float64(x)-cx, float64(y)-cy
			edge := radius + 0.45*math.Sin(float64(x)*1.7+float64(y)*0.9)
			if math.Hypot(dx, dy) <= edge {
				g.setTile(x, y, code)
			}
		}
	}
}

var buildings = []Building{
	{
		ID: "cottage-a", Name: "Thatcher's Cottage", Art: "cottage_a",
		X: 25, Y: 28.2, W: 3, H: 3, Scale: 2.05,
		Interact: Vec{25, 30.7}, Radius: 2.6,
		Text: "The shutters are latched, but the smell of fresh bread curls from the chimney. Someone is home.",
	},
	{
		ID: "cottage-b", Name: "Herbkeeper's Cottage", Art: "cottage_b",
		X: 37, Y: 27.2, W: 3, H: 3, Scale: 2.0,
		Interact: Vec{37, 29.7}, Radius: 2.6,
		Text: "Bundles of lavender and rosemary hang beneath the eaves. A small garden hums with bees.",
	},
	{
		ID: "cottage-c", Name: "Miller's Rest", Art: "cottage_c",
		X: 38, Y: 38.9, W: 3, H: 3, Scale: 2.05,
		Interact: Vec{38, 41.4}, Radius: 2.7,
		Text: "A well-worn well stands beside the door, its rope still damp. The miller is away at the harvest fair.",
	},
	{
		ID: "blacksmith", Name: "The Quiet Forge", Art: "blacksmith",
		X: 42, Y: 34.2, W: 4, H: 4, Scale: 1.95,
		Interact: Vec{42, 37.0}, Radius: 3.1,
		Text: "The forge is cold. Tools wait on their pegs, and a half-finished blade rests on the anvil.",
	},
}

func (g *generator) placeBuildings() {
	g.buildings = append([]Building(nil), buildings...)
	for _, b := range g.buildings {
		x0 := int(math.Round(b.X - float64(b.W)/2))
		y0 := int(math.Round(b.Y - float64(b.H)/2))
		for y := y0; y < y0+b.H; y++ {
			for x := x0; x < x0+b.W; x++ {
				if g.inBounds(x, y) {
					g.blocked[y][x] = true
					g.terrain[y][x] = Grass
				}
			}
		}
		// Clear the trim around the footprint so buildings never sit on a path
		// tile edge or forest tile.
		for y := y0 - 1; y <= y0+b.H; y++ {
			for x := x0 - 1; x <= x0+b.W; x++ {
				if g.inBounds(x, y) && g.terrain[y][x] == Forest {
					g.terrain[y][x] = Grass
					g.blocked[y][x] = false
				}
			}
		}
	}
}

func (g *generator) placePond() {
	// A sand apron softens the pond's edge.
	for y := 0; y < MapH; y++ {
		for x := 0; x < MapW; x++ {
			sx := float64(x-21)*64 - float64(y-39)*64
			sy := float64(x-21)*32 + float64(y-39)*32
			d := (sx*sx)/(290*290) + (sy*sy)/(175*175)
			if d < 1.25 && g.terrain[y][x] != Stone && g.terrain[y][x] != Dirt {
				g.terrain[y][x] = Sand
			}
			if d < 0.92 {
				g.blocked[y][x] = true
			}
		}
	}
	// The pond PNG is drawn as a flat object, aligned to the centre of the
	// ellipse above.
	g.props = append(g.props, Prop{Kind: "pond", Art: "pond", X: 21, Y: 39, Scale: 1.95})
}

func (g *generator) placeForest() {
	green := []string{"tree_oak_wide", "tree_round", "tree_broad", "tree_tall", "tree_airy", "tree_pine", "tree_pine2"}
	accent := []string{"tree_silver", "tree_blue", "tree_gold", "tree_autumn"}
	for y := 0; y < MapH; y++ {
		for x := 0; x < MapW; x++ {
			if g.terrain[y][x] != Forest {
				continue
			}
			// Dense near the clearing edge, thinning toward the map border.
			edgeDist := math.Hypot(float64(x-32), float64(y-32))
			chance := 0.0
			if edgeDist < 27 {
				chance = 0.46
			} else if edgeDist < 31 {
				chance = 0.30
			} else {
				chance = 0.16
			}
			if g.rng.Float64() > chance {
				continue
			}
			art := green[g.rng.Intn(len(green))]
			if g.rng.Float64() < 0.12 {
				art = accent[g.rng.Intn(len(accent))]
			}
			g.props = append(g.props, Prop{
				Kind:     "tree",
				Art:      art,
				X:        float64(x) + (g.rng.Float64()-0.5)*0.55,
				Y:        float64(y) + (g.rng.Float64()-0.5)*0.55,
				Scale:    1.25 + g.rng.Float64()*0.65,
				Flip:     g.rng.Intn(2) == 1,
				Blocking: true,
			})
		}
	}
}

func (g *generator) freeForProp(x, y int) bool {
	if !g.inBounds(x, y) {
		return false
	}
	if g.blocked[y][x] || g.occupied[y][x] {
		return false
	}
	if g.terrain[y][x] != Grass {
		return false
	}
	// Keep a comfortable margin around key locations.
	for _, ix := range []float64{31, 42, 38, 37, 25} {
		for _, iy := range []float64{31, 34, 39, 41, 28, 30} {
			if math.Hypot(float64(x)-ix, float64(y)-iy) < 2.2 {
				return false
			}
		}
	}
	return true
}

func (g *generator) addTree(x, y float64, art string, scale float64) {
	ix, iy := int(math.Round(x)), int(math.Round(y))
	if !g.freeForProp(ix, iy) && g.tile(ix, iy) != Forest {
		return
	}
	g.props = append(g.props, Prop{Kind: "tree", Art: art, X: x, Y: y, Scale: scale, Flip: g.rng.Intn(2) == 1, Blocking: true})
	g.occupied[iy][ix] = true
	g.blocked[iy][ix] = true
}

func (g *generator) placeVillageTrees() {
	// Hand-placed trees give the clearing a composed silhouette.
	placements := []struct {
		x, y  float64
		art   string
		scale float64
	}{
		{18.2, 33.2, "tree_tall", 1.55},
		{17.2, 35.8, "tree_airy", 1.45},
		{18.0, 42.0, "tree_pine", 1.65},
		{24.2, 43.0, "tree_round", 1.45},
		{26.8, 41.8, "tree_broad", 1.4},
		{29.0, 20.3, "tree_pine2", 1.6},
		{32.2, 19.8, "tree_round", 1.4},
		{36.8, 22.0, "tree_airy", 1.5},
		{40.5, 24.2, "tree_blue", 1.35},
		{45.2, 25.2, "tree_autumn", 1.55},
		{46.8, 28.3, "tree_round", 1.35},
		{44.6, 31.1, "tree_gold", 1.4},
		{46.2, 34.8, "tree_broad", 1.5},
		{44.2, 39.8, "tree_airy", 1.45},
		{41.2, 42.6, "tree_pine", 1.6},
		{23.2, 23.0, "tree_oak_wide", 1.6},
		{28.8, 24.8, "tree_silver", 1.25},
		{21.8, 27.4, "tree_round", 1.35},
		{33.0, 26.5, "tree_tall", 1.4},
		{39.6, 21.2, "tree_pine2", 1.45},
		{37.8, 46.0, "tree_broad", 1.55},
		{30.6, 48.2, "tree_round", 1.3},
		{40.8, 20.0, "tree_oak_wide", 1.5},
	}
	for _, p := range placements {
		g.addTree(p.x, p.y, p.art, p.scale)
	}
	// The Elder Oak at the north end of the lane.
	g.props = append(g.props, Prop{Kind: "tree", Art: "tree_bare", X: 34, Y: 22.6, Scale: 2.15, Blocking: true})
	g.occupied[23][34] = true
	g.blocked[23][34] = true
}

func (g *generator) placeDetails() {
	bushArts := []string{"bush_green", "bush_small", "bush_leafy", "bush_bright", "bush_blue", "bush_brown"}
	flowerVariants := 4

	// Meadow shrubs.
	for i := 0; i < 38; i++ {
		x := 17 + g.rng.Intn(32)
		y := 18 + g.rng.Intn(32)
		if !g.freeForProp(x, y) {
			continue
		}
		art := bushArts[g.rng.Intn(len(bushArts))]
		g.props = append(g.props, Prop{
			Kind: "bush", Art: art,
			X:     float64(x) + (g.rng.Float64()-0.5)*0.5,
			Y:     float64(y) + (g.rng.Float64()-0.5)*0.5,
			Scale: 1.15 + g.rng.Float64()*0.5,
			Flip:  g.rng.Intn(2) == 1,
		})
		g.occupied[y][x] = true
	}

	// Reeds and rocks framing the pond.
	for i := 0; i < 14; i++ {
		angle := g.rng.Float64() * math.Pi * 2
		x := 21 + math.Cos(angle)*5.6
		y := 39 + math.Sin(angle)*3.6
		ix, iy := int(math.Round(x)), int(math.Round(y))
		if g.inBounds(ix, iy) && !g.blocked[iy][ix] && g.terrain[iy][ix] == Sand {
			kind := "reeds"
			if i%4 == 0 {
				kind = "rock"
			}
			g.props = append(g.props, Prop{Kind: kind, X: x, Y: y, Scale: 0.85 + g.rng.Float64()*0.4, Blocking: kind == "rock"})
			if kind == "rock" {
				g.blocked[iy][ix] = true
			}
		}
	}
	for i := 0; i < 8; i++ {
		angle := g.rng.Float64() * math.Pi * 2
		x := 21 + math.Cos(angle)*7.2
		y := 39 + math.Sin(angle)*5.0
		ix, iy := int(math.Round(x)), int(math.Round(y))
		if g.freeForProp(ix, iy) {
			g.props = append(g.props, Prop{Kind: "rock", X: x, Y: y, Scale: 0.8 + g.rng.Float64()*0.6, Blocking: true})
			g.occupied[iy][ix] = true
			g.blocked[iy][ix] = true
		}
	}

	// Flowers in the meadow and around the cottages.
	for i := 0; i < 80; i++ {
		x := 15 + g.rng.Intn(36)
		y := 17 + g.rng.Intn(36)
		if g.freeForProp(x, y) {
			g.props = append(g.props, Prop{
				Kind: "flowers", X: float64(x) + (g.rng.Float64()-0.5)*0.7,
				Y:     float64(y) + (g.rng.Float64()-0.5)*0.7,
				Scale: 0.75 + g.rng.Float64()*0.45, Variant: g.rng.Intn(flowerVariants),
			})
			g.occupied[y][x] = true
		}
	}

	// Mushrooms in the shade of the Elder Oak.
	for i := 0; i < 7; i++ {
		x := 34 + (g.rng.Float64()-0.5)*4
		y := 22.6 + (g.rng.Float64()-0.5)*4
		ix, iy := int(math.Round(x)), int(math.Round(y))
		if g.inBounds(ix, iy) && !g.blocked[iy][ix] && g.terrain[iy][ix] == Grass {
			g.props = append(g.props, Prop{Kind: "mushroom", X: x, Y: y, Scale: 0.8 + g.rng.Float64()*0.4})
		}
	}

	// A few rocks along the clearing edge.
	for i := 0; i < 12; i++ {
		x := 14 + g.rng.Intn(38)
		y := 16 + g.rng.Intn(38)
		if g.freeForProp(x, y) {
			g.props = append(g.props, Prop{Kind: "rock", X: float64(x), Y: float64(y), Scale: 0.7 + g.rng.Float64()*0.5, Blocking: true})
			g.occupied[y][x] = true
			g.blocked[y][x] = true
		}
	}
}

func nearestWalkable(g *generator, x, y float64, radius int) (float64, float64) {
	cx, cy := int(math.Round(x)), int(math.Round(y))
	if g.inBounds(cx, cy) && !g.blocked[cy][cx] && g.terrain[cy][cx] != Forest {
		return x, y
	}
	bestX, bestY := float64(cx), float64(cy)
	bestD := math.MaxFloat64
	for dy := -radius; dy <= radius; dy++ {
		for dx := -radius; dx <= radius; dx++ {
			nx, ny := cx+dx, cy+dy
			if !g.inBounds(nx, ny) || g.blocked[ny][nx] || g.terrain[ny][nx] == Forest {
				continue
			}
			d := math.Hypot(float64(dx), float64(dy))
			if d < bestD {
				bestD = d
				bestX, bestY = float64(nx), float64(ny)
			}
		}
	}
	return bestX, bestY
}

func (g *generator) reachable(sx, sy float64, w *World) bool {
	startX, startY := int(math.Round(sx)), int(math.Round(sy))
	if g.isBlocked(startX, startY) {
		return false
	}
	seen := make([][]bool, MapH)
	for i := range seen {
		seen[i] = make([]bool, MapW)
	}
	queue := [][2]int{{startX, startY}}
	seen[startY][startX] = true
	for len(queue) > 0 {
		p := queue[0]
		queue = queue[1:]
		for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			nx, ny := p[0]+d[0], p[1]+d[1]
			if !g.inBounds(nx, ny) || seen[ny][nx] || g.blocked[ny][nx] {
				continue
			}
			seen[ny][nx] = true
			queue = append(queue, [2]int{nx, ny})
		}
	}
	check := func(x, y float64) bool {
		return seen[int(math.Round(y))][int(math.Round(x))]
	}
	for _, item := range w.Interactables {
		if !check(item.X, item.Y) {
			return false
		}
	}
	for _, item := range w.Wisps {
		if !check(item.X, item.Y) {
			return false
		}
	}
	return true
}

// SanitizeCollected returns a deduplicated list containing only IDs that
// belong to the supplied world.
func SanitizeCollected(ids []string, w *World) []string {
	valid := make(map[string]bool, len(w.Wisps))
	for _, wisp := range w.Wisps {
		valid[wisp.ID] = true
	}
	out := make([]string, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if seen[id] || !valid[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// String renders a compact debug view of the map, used by tests and tooling.
func (w *World) String() string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s (%dx%d, seed %d)\n", w.Name, w.Width, w.Height, w.Seed)
	for _, row := range w.Terrain {
		b.WriteString(row)
		b.WriteByte('\n')
	}
	return b.String()
}
