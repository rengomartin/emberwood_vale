package server

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"emberwood/internal/world"
)

const maxSaveBytes = 64 << 10

var profileRE = regexp.MustCompile(`^[a-zA-Z0-9_-]{8,64}$`)

type Save struct {
	Profile   string    `json:"profile"`
	X         float64   `json:"x"`
	Y         float64   `json:"y"`
	Dir       int       `json:"dir"`
	Collected []string  `json:"collected"`
	BeaconLit bool      `json:"beaconLit"`
	PlayTime  float64   `json:"playTime"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type SaveStore struct {
	dir string
	mu  sync.Mutex
}

func NewSaveStore(dir string) *SaveStore {
	return &SaveStore{dir: dir}
}

func (s *SaveStore) path(profile string) string {
	return filepath.Join(s.dir, profile+".json")
}

func (s *SaveStore) Load(profile string) (*Save, error) {
	if !profileRE.MatchString(profile) {
		return nil, errors.New("invalid profile")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.Open(s.path(profile))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var save Save
	if err := json.NewDecoder(io.LimitReader(f, maxSaveBytes)).Decode(&save); err != nil {
		return nil, err
	}
	save.Profile = profile
	return &save, nil
}

func (s *SaveStore) Save(save *Save) error {
	if !profileRE.MatchString(save.Profile) {
		return errors.New("invalid profile")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	save.UpdatedAt = time.Now().UTC()
	data, err := json.MarshalIndent(save, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.dir, ".save-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, s.path(save.Profile))
}

func (s *SaveStore) Delete(profile string) error {
	if !profileRE.MatchString(profile) {
		return errors.New("invalid profile")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	err := os.Remove(s.path(profile))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

type Server struct {
	world *world.World
	saves *SaveStore
	web   http.Handler
}

func New(w *world.World, saves *SaveStore, webFS http.FileSystem) *Server {
	if saves == nil {
		saves = NewSaveStore("data/saves")
	}
	return &Server{
		world: w,
		saves: saves,
		web:   http.FileServer(webFS),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/world", s.handleWorld)
	mux.HandleFunc("GET /api/save", s.handleLoad)
	mux.HandleFunc("POST /api/save", s.handleSave)
	mux.HandleFunc("DELETE /api/save", s.handleReset)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	})
	mux.Handle("/", s.staticHandler())

	return s.headers(s.logging(gzipMiddleware(mux)))
}

func (s *Server) staticHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		s.web.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"name":   s.world.Name,
		"width":  s.world.Width,
		"height": s.world.Height,
		"wisps":  len(s.world.Wisps),
		"server": "emberwood-go",
	})
}

func (s *Server) handleWorld(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, s.world)
}

func (s *Server) handleLoad(w http.ResponseWriter, r *http.Request) {
	profile := r.URL.Query().Get("profile")
	if !profileRE.MatchString(profile) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid profile"})
		return
	}
	save, err := s.saves.Load(profile)
	if err != nil {
		log.Printf("load save: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not read save"})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"save": save})
}

type saveRequest struct {
	Profile   string   `json:"profile"`
	X         float64  `json:"x"`
	Y         float64  `json:"y"`
	Dir       int      `json:"dir"`
	Collected []string `json:"collected"`
	BeaconLit bool     `json:"beaconLit"`
	PlayTime  float64  `json:"playTime"`
}

func (s *Server) handleSave(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	body := http.MaxBytesReader(w, r.Body, maxSaveBytes)
	var req saveRequest
	dec := json.NewDecoder(body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid save payload"})
		return
	}
	if !profileRE.MatchString(req.Profile) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid profile"})
		return
	}
	// Basic sanity: never trust the client with arbitrary world coordinates.
	if !validNumber(req.X) || !validNumber(req.Y) || req.X < 0 || req.Y < 0 ||
		req.X > float64(s.world.Width-1) || req.Y > float64(s.world.Height-1) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid position"})
		return
	}
	if req.Dir < 0 || req.Dir > 7 {
		req.Dir = 0
	}
	if req.PlayTime < 0 {
		req.PlayTime = 0
	}
	collected := world.SanitizeCollected(req.Collected, s.world)
	beaconLit := req.BeaconLit && len(collected) == len(s.world.Wisps)
	save := &Save{
		Profile:   req.Profile,
		X:         req.X,
		Y:         req.Y,
		Dir:       req.Dir,
		Collected: collected,
		BeaconLit: beaconLit,
		PlayTime:  req.PlayTime,
	}
	if err := s.saves.Save(save); err != nil {
		log.Printf("write save: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not write save"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "save": save})
}

func (s *Server) handleReset(w http.ResponseWriter, r *http.Request) {
	profile := r.URL.Query().Get("profile")
	if !profileRE.MatchString(profile) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid profile"})
		return
	}
	if err := s.saves.Delete(profile); err != nil {
		log.Printf("delete save: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not reset save"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func validNumber(v float64) bool {
	return v == v && v > -1e9 && v < 1e9
}

func (s *Server) headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'")
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			h.Set("Cache-Control", "public, max-age=3600")
		} else if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		} else {
			h.Set("Cache-Control", "no-cache")
		}
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (s *Server) logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(sw, r)
		if !strings.HasPrefix(r.URL.Path, "/assets/") {
			log.Printf("%s %s %d %s", r.Method, r.URL.Path, sw.status, time.Since(start).Round(time.Millisecond))
		}
	})
}

type gzipWriter struct {
	http.ResponseWriter
	gz          *gzip.Writer
	wroteHeader bool
}

func (w *gzipWriter) WriteHeader(code int) {
	if w.wroteHeader {
		return
	}
	h := w.Header()
	if h.Get("Content-Encoding") == "" && shouldGzip(h.Get("Content-Type")) {
		h.Del("Content-Length")
		h.Set("Content-Encoding", "gzip")
		h.Add("Vary", "Accept-Encoding")
		w.gz = gzip.NewWriter(w.ResponseWriter)
	}
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(code)
}

func (w *gzipWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if w.gz != nil {
		return w.gz.Write(b)
	}
	return w.ResponseWriter.Write(b)
}

func (w *gzipWriter) close() error {
	if w.gz != nil {
		return w.gz.Close()
	}
	return nil
}

func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		gw := &gzipWriter{ResponseWriter: w}
		defer gw.close()
		next.ServeHTTP(gw, r)
	})
}

func shouldGzip(contentType string) bool {
	contentType = strings.ToLower(contentType)
	for _, prefix := range []string{"text/", "application/javascript", "application/json", "image/svg+xml"} {
		if strings.HasPrefix(contentType, prefix) {
			return true
		}
	}
	return false
}

func init() {
	_ = mime.AddExtensionType(".woff2", "font/woff2")
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}
