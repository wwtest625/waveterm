// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package suggestion

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type commandSuggestionCandidate struct {
	name    string
	path    string
	builtin bool
}

type commandSuggestionMatch struct {
	candidate commandSuggestionCandidate
	score     int
}

var commandSuggestionCache sync.Map

var shellBuiltinCommands = []string{
	"alias",
	"bg",
	"bind",
	"break",
	"builtin",
	"cd",
	"command",
	"continue",
	"declare",
	"dirs",
	"disown",
	"echo",
	"enable",
	"eval",
	"exec",
	"exit",
	"export",
	"fc",
	"fg",
	"getopts",
	"hash",
	"help",
	"history",
	"jobs",
	"kill",
	"let",
	"local",
	"logout",
	"popd",
	"printf",
	"pushd",
	"pwd",
	"read",
	"readarray",
	"return",
	"set",
	"shift",
	"shopt",
	"source",
	"test",
	"times",
	"trap",
	"type",
	"typeset",
	"ulimit",
	"umask",
	"unalias",
	"wait",
}

func fetchCommandSuggestions(_ context.Context, data wshrpc.FetchSuggestionsData) (*wshrpc.FetchSuggestionsResponse, error) {
	query := strings.TrimSpace(data.Query)
	candidates := getCommandSuggestionCandidates(data.CmdEnv)

	var matches []commandSuggestionMatch
	lowerQuery := strings.ToLower(query)

	for _, candidate := range candidates {
		lowerName := strings.ToLower(candidate.name)
		if query != "" && !strings.HasPrefix(lowerName, lowerQuery) {
			continue
		}

		score := 0
		if query == "" {
			if candidate.builtin {
				score += 1000
			}
			score += 500 - len(candidate.name)
		} else {
			score += 1000 - len(candidate.name)
			if lowerName == lowerQuery {
				score += 1000
			}
			if candidate.builtin {
				score += 50
			}
		}

		matches = append(matches, commandSuggestionMatch{
			candidate: candidate,
			score:     score,
		})
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		if matches[i].candidate.builtin != matches[j].candidate.builtin {
			return matches[i].candidate.builtin
		}
		if matches[i].candidate.name != matches[j].candidate.name {
			return matches[i].candidate.name < matches[j].candidate.name
		}
		return matches[i].candidate.path < matches[j].candidate.path
	})

	suggestions := make([]wshrpc.SuggestionType, 0, min(len(matches), MaxSuggestions))
	for _, match := range matches {
		subText := match.candidate.path
		if match.candidate.builtin {
			subText = "shell builtin"
		}
		suggestion := wshrpc.SuggestionType{
			Type:         "command",
			SuggestionId: utilfn.QuickHashString(match.candidate.name + "|" + match.candidate.path + "|" + subText),
			Display:      match.candidate.name,
			SubText:      subText,
			Icon:         "terminal",
			Score:        match.score,
		}
		suggestions = append(suggestions, suggestion)
		if len(suggestions) >= MaxSuggestions {
			break
		}
	}

	return &wshrpc.FetchSuggestionsResponse{
		Suggestions: suggestions,
		ReqNum:      data.ReqNum,
	}, nil
}

func getCommandSuggestionCandidates(cmdEnv map[string]string) []commandSuggestionCandidate {
	pathEnv := getEnvValue(cmdEnv, "PATH")
	pathext := getEnvValue(cmdEnv, "PATHEXT")
	cacheKey := pathEnv + "\x00" + pathext

	if cached, ok := commandSuggestionCache.Load(cacheKey); ok {
		return cached.([]commandSuggestionCandidate)
	}

	candidates := scanCommandCandidates(pathEnv, pathext)
	candidates = mergeBuiltinCommands(candidates)
	commandSuggestionCache.Store(cacheKey, candidates)
	return candidates
}

func getEnvValue(env map[string]string, key string) string {
	if env != nil {
		if value, ok := env[key]; ok {
			return value
		}
	}
	return os.Getenv(key)
}

func mergeBuiltinCommands(candidates []commandSuggestionCandidate) []commandSuggestionCandidate {
	candidateMap := make(map[string]commandSuggestionCandidate, len(candidates)+len(shellBuiltinCommands))
	for _, candidate := range candidates {
		candidateMap[strings.ToLower(candidate.name)] = candidate
	}
	for _, builtin := range shellBuiltinCommands {
		key := strings.ToLower(builtin)
		candidate, ok := candidateMap[key]
		if !ok {
			candidateMap[key] = commandSuggestionCandidate{
				name:    builtin,
				builtin: true,
			}
			continue
		}
		candidate.builtin = true
		candidateMap[key] = candidate
	}

	merged := make([]commandSuggestionCandidate, 0, len(candidateMap))
	for _, candidate := range candidateMap {
		merged = append(merged, candidate)
	}
	return merged
}

func scanCommandCandidates(pathEnv string, pathext string) []commandSuggestionCandidate {
	if strings.TrimSpace(pathEnv) == "" {
		return nil
	}

	pathSep := string(os.PathListSeparator)
	if strings.Contains(pathEnv, ";") {
		pathSep = ";"
	}
	entries := strings.Split(pathEnv, pathSep)
	seen := make(map[string]commandSuggestionCandidate)
	winExtSet := buildWindowsExtSet(pathext)

	for _, rawDir := range entries {
		dir := strings.TrimSpace(rawDir)
		if dir == "" {
			continue
		}
		dirEntries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range dirEntries {
			name := entry.Name()
			candidateName, ok := commandNameFromEntry(entry, name, winExtSet)
			if !ok {
				continue
			}
			key := strings.ToLower(candidateName)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = commandSuggestionCandidate{
				name: candidateName,
				path: filepath.Join(dir, name),
			}
		}
	}

	candidates := make([]commandSuggestionCandidate, 0, len(seen))
	for _, candidate := range seen {
		candidates = append(candidates, candidate)
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].name < candidates[j].name
	})
	return candidates
}

func buildWindowsExtSet(pathext string) map[string]struct{} {
	if strings.TrimSpace(pathext) == "" {
		return nil
	}
	exts := strings.FieldsFunc(pathext, func(r rune) bool { return r == ';' || r == ':' })
	if len(exts) == 0 {
		return nil
	}
	result := make(map[string]struct{}, len(exts))
	for _, ext := range exts {
		ext = strings.TrimSpace(ext)
		if ext == "" {
			continue
		}
		result[strings.ToLower(ext)] = struct{}{}
	}
	return result
}

func commandNameFromEntry(entry fs.DirEntry, name string, winExtSet map[string]struct{}) (string, bool) {
	if entry.IsDir() {
		return "", false
	}

	if winExtSet != nil {
		lowerName := strings.ToLower(name)
		for ext := range winExtSet {
			if strings.HasSuffix(lowerName, ext) {
				baseName := name[:len(name)-len(ext)]
				if baseName == "" {
					return "", false
				}
				return baseName, true
			}
		}
		return "", false
	}

	info, err := entry.Info()
	if err != nil {
		return "", false
	}
	mode := info.Mode()
	if mode.IsDir() {
		return "", false
	}
	if mode&fs.ModeSymlink != 0 || mode.Perm()&0o111 != 0 {
		return name, true
	}
	return "", false
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
