package conncontroller

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestShouldPersistConnWshEnabled(t *testing.T) {
	t.Run("persists successful auto-enable", func(t *testing.T) {
		shouldPersist := shouldPersistConnWshEnabled(false, wconfig.ConnKeywords{}, WshCheckResult{WshEnabled: true})
		if !shouldPersist {
			t.Fatalf("expected successful wsh enablement to be persisted")
		}
	})

	t.Run("does not persist temporary failures", func(t *testing.T) {
		shouldPersist := shouldPersistConnWshEnabled(false, wconfig.ConnKeywords{}, WshCheckResult{WshEnabled: false})
		if shouldPersist {
			t.Fatalf("expected failed wsh enablement to stay in-memory only")
		}
	})

	t.Run("does not overwrite explicit connection config", func(t *testing.T) {
		enabled := false
		shouldPersist := shouldPersistConnWshEnabled(true, wconfig.ConnKeywords{ConnWshEnabled: &enabled}, WshCheckResult{WshEnabled: true})
		if shouldPersist {
			t.Fatalf("expected explicit conn:wshenabled config to win")
		}
	})
}
