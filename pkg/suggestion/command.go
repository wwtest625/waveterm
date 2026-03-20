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
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
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

var dockerCommandSuggestions = []string{
	"attach",
	"build",
	"buildx",
	"commit",
	"compose",
	"config",
	"container",
	"context",
	"cp",
	"create",
	"diff",
	"events",
	"exec",
	"export",
	"history",
	"image",
	"images",
	"inspect",
	"kill",
	"load",
	"login",
	"logout",
	"logs",
	"pause",
	"port",
	"ps",
	"pull",
	"push",
	"rename",
	"restart",
	"rm",
	"rmi",
	"run",
	"save",
	"search",
	"start",
	"stats",
	"stop",
	"system",
	"tag",
	"top",
	"unpause",
	"update",
	"version",
	"volume",
}

var nerdctlCommandSuggestions = []string{
	"build",
	"commit",
	"compose",
	"container",
	"cp",
	"create",
	"exec",
	"image",
	"images",
	"info",
	"inspect",
	"kill",
	"load",
	"login",
	"logout",
	"logs",
	"namespace",
	"pause",
	"port",
	"ps",
	"pull",
	"push",
	"restart",
	"rm",
	"rmi",
	"run",
	"save",
	"start",
	"stats",
	"stop",
	"tag",
	"top",
	"unpause",
	"version",
	"volume",
}

var dockerContainerArgCommands = map[string]struct{}{
	"attach":  {},
	"exec":    {},
	"inspect": {},
	"kill":    {},
	"logs":    {},
	"pause":   {},
	"port":    {},
	"restart": {},
	"rm":      {},
	"start":   {},
	"stats":   {},
	"stop":    {},
	"top":     {},
	"unpause": {},
	"wait":    {},
}

var dockerImageArgCommands = map[string]struct{}{
	"commit": {},
	"load":   {},
	"pull":   {},
	"push":   {},
	"run":    {},
	"save":   {},
	"tag":    {},
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

func fetchDockerCommandSuggestions(query string, reqNum int) (*wshrpc.FetchSuggestionsResponse, error) {
	return buildStaticCommandSuggestions("docker-command", query, dockerCommandSuggestions, "terminal", reqNum), nil
}

func fetchNerdctlCommandSuggestions(query string, reqNum int) (*wshrpc.FetchSuggestionsResponse, error) {
	return buildStaticCommandSuggestions("nerdctl-command", query, nerdctlCommandSuggestions, "terminal", reqNum), nil
}

func fetchDockerContainerSuggestions(ctx context.Context, data wshrpc.FetchSuggestionsData) (*wshrpc.FetchSuggestionsResponse, error) {
	query := strings.TrimSpace(data.Query)
	rpcCtx := getSuggestionRpcContext(ctx)
	if rpcCtx == nil {
		return &wshrpc.FetchSuggestionsResponse{ReqNum: data.ReqNum}, nil
	}

	result, err := wshclient.DockerListContainersCommand(
		wshclient.GetBareRpcClient(),
		wshrpc.DockerListContainersRequest{
			Connection: rpcCtx.Conn,
			All:        true,
		},
		&wshrpc.RpcOpts{Route: maybeConnectionRoute(rpcCtx.Conn)},
	)
	if err != nil || result.Error != nil {
		return &wshrpc.FetchSuggestionsResponse{ReqNum: data.ReqNum}, nil
	}

	type scoredContainer struct {
		container wshrpc.DockerContainerSummary
		score     int
	}

	var matches []scoredContainer
	lowerQuery := strings.ToLower(query)
	for _, container := range result.Containers {
		name := strings.TrimSpace(container.Name)
		if name == "" {
			name = strings.TrimSpace(container.Id)
		}
		if name == "" {
			continue
		}
		candidate := strings.ToLower(name)
		if query != "" && !strings.HasPrefix(candidate, lowerQuery) && !strings.HasPrefix(strings.ToLower(container.Id), lowerQuery) {
			continue
		}
		score := 1000 - len(name)
		if query != "" && strings.EqualFold(name, query) {
			score += 1000
		}
		matches = append(matches, scoredContainer{container: container, score: score})
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		if matches[i].container.Name != matches[j].container.Name {
			return matches[i].container.Name < matches[j].container.Name
		}
		return matches[i].container.Id < matches[j].container.Id
	})

	suggestions := make([]wshrpc.SuggestionType, 0, min(len(matches), MaxSuggestions))
	for _, match := range matches {
		name := strings.TrimSpace(match.container.Name)
		if name == "" {
			name = strings.TrimSpace(match.container.Id)
		}
		if name == "" {
			continue
		}
		subText := strings.TrimSpace(match.container.Image)
		if match.container.StatusText != "" {
			if subText != "" {
				subText = subText + " · " + strings.TrimSpace(match.container.StatusText)
			} else {
				subText = strings.TrimSpace(match.container.StatusText)
			}
		}
		suggestions = append(suggestions, wshrpc.SuggestionType{
			Type:         "docker-container",
			SuggestionId: utilfn.QuickHashString(name + "|" + match.container.Id),
			Display:      name,
			SubText:      subText,
			Icon:         "cube",
			Score:        match.score,
		})
		if len(suggestions) >= MaxSuggestions {
			break
		}
	}

	return &wshrpc.FetchSuggestionsResponse{
		Suggestions: suggestions,
		ReqNum:      data.ReqNum,
	}, nil
}

func fetchDockerImageSuggestions(ctx context.Context, data wshrpc.FetchSuggestionsData) (*wshrpc.FetchSuggestionsResponse, error) {
	query := strings.TrimSpace(data.Query)
	rpcCtx := getSuggestionRpcContext(ctx)
	if rpcCtx == nil {
		return &wshrpc.FetchSuggestionsResponse{ReqNum: data.ReqNum}, nil
	}

	result, err := wshclient.DockerListImagesCommand(
		wshclient.GetBareRpcClient(),
		wshrpc.DockerListImagesRequest{
			Connection: rpcCtx.Conn,
		},
		&wshrpc.RpcOpts{Route: maybeConnectionRoute(rpcCtx.Conn)},
	)
	if err != nil || result.Error != nil {
		return &wshrpc.FetchSuggestionsResponse{ReqNum: data.ReqNum}, nil
	}

	type scoredImage struct {
		image wshrpc.DockerImageSummary
		score int
	}

	var matches []scoredImage
	lowerQuery := strings.ToLower(query)
	for _, image := range result.Images {
		repoTag := formatDockerImageRef(image.Repository, image.Tag)
		if repoTag == "" {
			continue
		}
		candidate := strings.ToLower(repoTag)
		if query != "" && !strings.HasPrefix(candidate, lowerQuery) && !strings.HasPrefix(strings.ToLower(image.Repository), lowerQuery) {
			continue
		}
		score := 1000 - len(repoTag)
		if query != "" && strings.EqualFold(repoTag, query) {
			score += 1000
		}
		matches = append(matches, scoredImage{image: image, score: score})
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		if matches[i].image.Repository != matches[j].image.Repository {
			return matches[i].image.Repository < matches[j].image.Repository
		}
		return matches[i].image.Tag < matches[j].image.Tag
	})

	suggestions := make([]wshrpc.SuggestionType, 0, min(len(matches), MaxSuggestions))
	for _, match := range matches {
		repoTag := formatDockerImageRef(match.image.Repository, match.image.Tag)
		if repoTag == "" {
			continue
		}
		subText := strings.TrimSpace(match.image.SizeText)
		if match.image.InUse {
			if subText != "" {
				subText += " · in use"
			} else {
				subText = "in use"
			}
		}
		suggestions = append(suggestions, wshrpc.SuggestionType{
			Type:         "docker-image",
			SuggestionId: utilfn.QuickHashString(repoTag + "|" + match.image.Id),
			Display:      repoTag,
			SubText:      subText,
			Icon:         "image",
			Score:        match.score,
		})
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

func buildStaticCommandSuggestions(suggestionType string, query string, commands []string, icon string, reqNum int) *wshrpc.FetchSuggestionsResponse {
	var matches []commandSuggestionMatch
	lowerQuery := strings.ToLower(strings.TrimSpace(query))
	for _, command := range commands {
		lowerCommand := strings.ToLower(command)
		if lowerQuery != "" && !strings.HasPrefix(lowerCommand, lowerQuery) {
			continue
		}
		score := 1000 - len(command)
		if lowerQuery != "" && lowerCommand == lowerQuery {
			score += 1000
		}
		matches = append(matches, commandSuggestionMatch{
			candidate: commandSuggestionCandidate{name: command},
			score:     score,
		})
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		return matches[i].candidate.name < matches[j].candidate.name
	})

	suggestions := make([]wshrpc.SuggestionType, 0, min(len(matches), MaxSuggestions))
	for _, match := range matches {
		suggestions = append(suggestions, wshrpc.SuggestionType{
			Type:         suggestionType,
			SuggestionId: utilfn.QuickHashString(suggestionType + "|" + match.candidate.name),
			Display:      match.candidate.name,
			Icon:         icon,
			Score:        match.score,
		})
		if len(suggestions) >= MaxSuggestions {
			break
		}
	}

	return &wshrpc.FetchSuggestionsResponse{Suggestions: suggestions, ReqNum: reqNum}
}

func getSuggestionRpcContext(ctx context.Context) *wshrpc.RpcContext {
	rpcHandler := wshutil.GetRpcResponseHandlerFromContext(ctx)
	if rpcHandler == nil {
		return nil
	}
	rpcCtx := rpcHandler.GetRpcContext()
	return &rpcCtx
}

func maybeConnectionRoute(conn string) string {
	if strings.TrimSpace(conn) == "" {
		return ""
	}
	return wshutil.MakeConnectionRouteId(conn)
}

func formatDockerImageRef(repository string, tag string) string {
	repository = strings.TrimSpace(repository)
	tag = strings.TrimSpace(tag)
	if repository == "" {
		return ""
	}
	if tag == "" || tag == "<none>" {
		return repository
	}
	return repository + ":" + tag
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
