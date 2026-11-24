package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"emberwood/internal/world"
)

func testServer(t *testing.T) (*Server, *world.World) {
	t.Helper()
	w := world.Generate(20261124)
	web := fstest.MapFS{
		"index.html":   {Data: []byte("<!doctype html><title>Emberwood</title>")},
		"js/game.js":   {Data: []byte("export const ok = true;")},
		"assets/a.png": {Data: []byte("\x89PNG\r\n\x1a\n")},
	}
	return New(w, NewSaveStore(t.TempDir()), http.FS(web)), w
}

func TestWorldAndHealth(t *testing.T) {
	s, w := testServer(t)
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()

	res, err := http.Get(ts.URL + "/api/world")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("world status = %d", res.StatusCode)
	}
	var got world.World
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Width != w.Width || len(got.Terrain) != w.Height {
		t.Fatalf("world payload mismatch: %dx%d", got.Width, len(got.Terrain))
	}

	res, err = http.Get(ts.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var health map[string]any
	_ = json.NewDecoder(res.Body).Decode(&health)
	if health["ok"] != true {
		t.Fatalf("health response: %+v", health)
	}
}

func TestSaveCycle(t *testing.T) {
	s, w := testServer(t)
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()

	profile := "player_12345"
	wisp := w.Wisps[0].ID
	payload := map[string]any{
		"profile": profile, "x": w.Spawn.X, "y": w.Spawn.Y, "dir": 2,
		"collected": []string{wisp, "not-a-wisp"}, "beaconLit": false, "playTime": 12.5,
	}
	body, _ := json.Marshal(payload)
	res, err := http.Post(ts.URL+"/api/save", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("save status = %d", res.StatusCode)
	}

	res, err = http.Get(ts.URL + "/api/save?profile=" + profile)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var loaded struct{ Save *Save }
	if err := json.NewDecoder(res.Body).Decode(&loaded); err != nil {
		t.Fatal(err)
	}
	if loaded.Save == nil {
		t.Fatal("expected save")
	}
	if len(loaded.Save.Collected) != 1 || loaded.Save.Collected[0] != wisp {
		t.Fatalf("unexpected collected: %v", loaded.Save.Collected)
	}
	if loaded.Save.PlayTime != 12.5 {
		t.Fatalf("playtime = %f", loaded.Save.PlayTime)
	}

	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/save?profile="+profile, nil)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("reset status = %d", res.StatusCode)
	}
	res, err = http.Get(ts.URL + "/api/save?profile=" + profile)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var empty struct{ Save *Save }
	_ = json.NewDecoder(res.Body).Decode(&empty)
	if empty.Save != nil {
		t.Fatal("save should be deleted")
	}
}

func TestSaveValidation(t *testing.T) {
	s, w := testServer(t)
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()

	// Bad coordinates.
	payload := map[string]any{"profile": "player_12345", "x": -10, "y": 1, "dir": 0}
	body, _ := json.Marshal(payload)
	res, _ := http.Post(ts.URL+"/api/save", "application/json", bytes.NewReader(body))
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad position status = %d", res.StatusCode)
	}

	// Invalid profile.
	payload = map[string]any{"profile": "x", "x": w.Spawn.X, "y": w.Spawn.Y}
	body, _ = json.Marshal(payload)
	res, _ = http.Post(ts.URL+"/api/save", "application/json", bytes.NewReader(body))
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad profile status = %d", res.StatusCode)
	}

	// Beacon cannot be lit before all wisps are collected.
	payload = map[string]any{"profile": "player_12346", "x": w.Spawn.X, "y": w.Spawn.Y, "beaconLit": true}
	body, _ = json.Marshal(payload)
	res, _ = http.Post(ts.URL+"/api/save", "application/json", bytes.NewReader(body))
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("save status = %d", res.StatusCode)
	}
	res, _ = http.Get(ts.URL + "/api/save?profile=player_12346")
	defer res.Body.Close()
	var loaded struct{ Save *Save }
	_ = json.NewDecoder(res.Body).Decode(&loaded)
	if loaded.Save != nil && loaded.Save.BeaconLit {
		t.Fatal("beacon should not be lit with zero wisps")
	}
}

func TestStaticAndGzip(t *testing.T) {
	s, _ := testServer(t)
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("index status = %d", res.StatusCode)
	}
	if res.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("expected gzip response, got %q", res.Header.Get("Content-Encoding"))
	}
	b, _ := io.ReadAll(res.Body)
	if !strings.Contains(string(b), "Emberwood") {
		t.Fatalf("unexpected index body: %q", b)
	}
	if res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("security headers missing")
	}
}
