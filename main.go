// Command emberwood serves the Emberwood Vale game world and its static client.
package main

import (
	"context"
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"emberwood/internal/server"
	"emberwood/internal/world"
)

//go:embed all:web
var embeddedWeb embed.FS

func main() {
	addr := flag.String("addr", envOr("ADDR", ":8080"), "HTTP listen address")
	dataDir := flag.String("data", envOr("DATA_DIR", "data"), "directory for save files")
	webDir := flag.String("web", "", "serve web files from disk instead of the embedded copy (development)")
	seed := flag.Int64("seed", 20261124, "world generation seed")
	flag.Parse()

	var webFS http.FileSystem
	if *webDir != "" {
		webFS = http.Dir(*webDir)
		log.Printf("serving client from %s", *webDir)
	} else {
		sub, err := fs.Sub(embeddedWeb, "web")
		if err != nil {
			log.Fatalf("embedded web files: %v", err)
		}
		webFS = http.FS(sub)
	}

	w := world.Generate(*seed)
	saves := server.NewSaveStore(filepath.Join(*dataDir, "saves"))
	srv := server.New(w, saves, webFS)

	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	go func() {
		log.Printf("%s is listening on %s (seed %d)", w.Name, *addr, w.Seed)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Print("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
