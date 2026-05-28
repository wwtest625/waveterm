package main

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
)

func main() {
	fmt.Println("=== Test: MakeCompatHTTPTransport with system proxy detection ===")

	transport := aiutil.MakeCompatHTTPTransport("")
	client := &http.Client{
		Timeout:   15 * time.Second,
		Transport: transport,
	}

	resp, err := client.Get("https://anyrouter.top/v1/models")
	if err != nil {
		fmt.Printf("  Failed: %v\n", err)
	} else {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		limit := len(body)
		if limit > 300 {
			limit = 300
		}
		fmt.Printf("  OK! Status: %d, Body: %s\n", resp.StatusCode, string(body[:limit]))
	}

	fmt.Println("\n=== Test: Standard Go HTTP (no proxy) ===")
	client2 := &http.Client{
		Timeout: 15 * time.Second,
	}
	resp, err = client2.Get("https://api.openai.com/v1/models")
	if err != nil {
		fmt.Printf("  Failed: %v\n", err)
	} else {
		resp.Body.Close()
		fmt.Printf("  OK! Status: %d\n", resp.StatusCode)
	}
}
