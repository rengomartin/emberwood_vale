package world

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func TestGenerateIsDeterministic(t *testing.T) {
	a := Generate(42)
	b := Generate(42)
	aj, _ := json.Marshal(a)
	bj, _ := json.Marshal(b)
	if string(aj) != string(bj) {
		t.Fatal("same seed produced different worlds")
	}
	c := Generate(43)
	cj, _ := json.Marshal(c)
	if string(aj) == string(cj) {
		t.Fatal("different seeds produced identical worlds")
	}
}

func TestWorldShapeAndSpawn(t *testing.T) {
	w := Generate(20261124)
	if w.Width != MapW || w.Height != MapH {
		t.Fatalf("unexpected size %dx%d", w.Width, w.Height)
	}
	if len(w.Terrain) != MapH || len(w.Blocked) != MapH {
		t.Fatalf("terrain rows = %d, blocked rows = %d", len(w.Terrain), len(w.Blocked))
	}
	for y := range w.Terrain {
		if len(w.Terrain[y]) != MapW || len(w.Blocked[y]) != MapW {
			t.Fatalf("row %d has wrong width", y)
		}
		for x, c := range w.Terrain[y] {
			if c < '0' || c > '4' {
				t.Fatalf("unexpected terrain code %q at %d,%d", c, x, y)
			}
		}
	}
	if blocked(w, w.Spawn.X, w.Spawn.Y) {
		t.Fatal("spawn is blocked")
	}
	if len(w.Wisps) != WispTotal {
		t.Fatalf("got %d wisps, want %d", len(w.Wisps), WispTotal)
	}
}

func TestAllObjectivesReachable(t *testing.T) {
	w := Generate(20261124)
	seen := BFS(w, int(math.Round(w.Spawn.X)), int(math.Round(w.Spawn.Y)))
	for _, wisp := range w.Wisps {
		x, y := int(math.Round(wisp.X)), int(math.Round(wisp.Y))
		if blocked(w, wisp.X, wisp.Y) {
			t.Errorf("wisp %s is blocked at %d,%d", wisp.ID, x, y)
		}
		if !seen[y][x] {
			t.Errorf("wisp %s is unreachable at %d,%d", wisp.ID, x, y)
		}
	}
	for _, item := range w.Interactables {
		x, y := int(math.Round(item.X)), int(math.Round(item.Y))
		if blocked(w, item.X, item.Y) {
			t.Errorf("interactable %s is blocked", item.ID)
		}
		if !seen[y][x] {
			t.Errorf("interactable %s is unreachable", item.ID)
		}
	}
}

func TestBuildingFootprintsSolid(t *testing.T) {
	w := Generate(20261124)
	for _, b := range w.Buildings {
		x0 := int(math.Round(b.X - float64(b.W)/2))
		y0 := int(math.Round(b.Y - float64(b.H)/2))
		for y := y0 + 1; y < y0+b.H-1; y++ {
			for x := x0 + 1; x < x0+b.W-1; x++ {
				if !blocked(w, float64(x), float64(y)) {
					t.Errorf("building %s has walkable interior at %d,%d", b.ID, x, y)
				}
			}
		}
	}
}

func TestSanitizeCollected(t *testing.T) {
	w := Generate(1)
	got := SanitizeCollected([]string{"wisp-pond", "bogus", "wisp-pond", "wisp-lane"}, w)
	if strings.Join(got, ",") != "wisp-pond,wisp-lane" {
		t.Fatalf("unexpected sanitized list: %v", got)
	}
}

func blocked(w *World, fx, fy float64) bool {
	x, y := int(math.Round(fx)), int(math.Round(fy))
	if x < 0 || y < 0 || x >= w.Width || y >= w.Height {
		return true
	}
	return w.Blocked[y][x] == '1'
}

// BFS returns the set of walkable tiles reachable from a starting tile.
func BFS(w *World, sx, sy int) [][]bool {
	seen := make([][]bool, w.Height)
	for i := range seen {
		seen[i] = make([]bool, w.Width)
	}
	if w.Blocked[sy][sx] == '1' {
		return seen
	}
	seen[sy][sx] = true
	queue := [][2]int{{sx, sy}}
	for len(queue) > 0 {
		p := queue[0]
		queue = queue[1:]
		for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			nx, ny := p[0]+d[0], p[1]+d[1]
			if nx < 0 || ny < 0 || nx >= w.Width || ny >= w.Height || seen[ny][nx] || w.Blocked[ny][nx] == '1' {
				continue
			}
			seen[ny][nx] = true
			queue = append(queue, [2]int{nx, ny})
		}
	}
	return seen
}
