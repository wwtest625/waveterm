// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fileutil

import (
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func FixPath(path string) (string, error) {
	origPath := path
	var err error
	if strings.HasPrefix(path, "~") {
		path = filepath.Join(wavebase.GetHomeDir(), path[1:])
	} else if !filepath.IsAbs(path) {
		path, err = filepath.Abs(path)
		if err != nil {
			return "", err
		}
	}
	if strings.HasSuffix(origPath, "/") && !strings.HasSuffix(path, "/") {
		path += "/"
	}
	return path, nil
}

const (
	winFlagSoftlink = uint32(0x8000) // FILE_ATTRIBUTE_REPARSE_POINT
	winFlagJunction = uint32(0x80)   // FILE_ATTRIBUTE_JUNCTION
)

func WinSymlinkDir(path string, bits os.FileMode) bool {
	// Windows compatibility layer doesn't expose symlink target type through fileInfo
	// so we need to check file attributes and extension patterns
	isFileSymlink := func(filepath string) bool {
		if len(filepath) == 0 {
			return false
		}
		return strings.LastIndex(filepath, ".") > strings.LastIndex(filepath, "/")
	}

	flags := uint32(bits >> 12)

	if flags == winFlagSoftlink {
		return !isFileSymlink(path)
	} else if flags == winFlagJunction {
		return true
	} else {
		return false
	}
}

// on error just returns ""
// does not return "application/octet-stream" as this is considered a detection failure
// can pass an existing fileInfo to avoid re-statting the file
// falls back to text/plain for 0 byte files
func DetectMimeType(path string, fileInfo fs.FileInfo, extended bool) string {
	if fileInfo == nil {
		statRtn, err := os.Stat(path)
		if err != nil {
			return ""
		}
		fileInfo = statRtn
	}

	if fileInfo.IsDir() || WinSymlinkDir(path, fileInfo.Mode()) {
		return "directory"
	}
	if fileInfo.Mode()&os.ModeNamedPipe == os.ModeNamedPipe {
		return "pipe"
	}
	charDevice := os.ModeDevice | os.ModeCharDevice
	if fileInfo.Mode()&charDevice == charDevice {
		return "character-special"
	}
	if fileInfo.Mode()&os.ModeDevice == os.ModeDevice {
		return "block-special"
	}
	ext := strings.ToLower(filepath.Ext(path))
	if mimeType, ok := StaticMimeTypeMap[ext]; ok {
		return mimeType
	}
	if mimeType := mime.TypeByExtension(ext); mimeType != "" {
		return mimeType
	}
	if fileInfo.Size() == 0 {
		return "text/plain"
	}
	if !extended {
		return ""
	}
	fd, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer fd.Close()
	buf := make([]byte, 512)
	// ignore the error (EOF / UnexpectedEOF is fine, just process how much we got back)
	n, _ := io.ReadAtLeast(fd, buf, 512)
	if n == 0 {
		return ""
	}
	buf = buf[:n]
	rtn := http.DetectContentType(buf)
	if rtn == "application/octet-stream" {
		return ""
	}
	return rtn
}

func DetectMimeTypeWithDirEnt(path string, dirEnt fs.DirEntry) string {
	if dirEnt != nil {
		if dirEnt.IsDir() {
			return "directory"
		}
		mode := dirEnt.Type()
		if mode&os.ModeNamedPipe == os.ModeNamedPipe {
			return "pipe"
		}
		charDevice := os.ModeDevice | os.ModeCharDevice
		if mode&charDevice == charDevice {
			return "character-special"
		}
		if mode&os.ModeDevice == os.ModeDevice {
			return "block-special"
		}
	}
	ext := strings.ToLower(filepath.Ext(path))
	if mimeType, ok := StaticMimeTypeMap[ext]; ok {
		return mimeType
	}
	return ""
}

func AtomicWriteFile(fileName string, data []byte, perm os.FileMode) error {
	tmpFileName := fileName + TempFileSuffix
	if err := os.WriteFile(tmpFileName, data, perm); err != nil {
		if removeErr := os.Remove(tmpFileName); removeErr != nil && !os.IsNotExist(removeErr) {
			return fmt.Errorf("failed to write temp file %q: %w (also failed to remove temp file: %v)", tmpFileName, err, removeErr)
		}
		return err
	}
	if err := os.Rename(tmpFileName, fileName); err != nil {
		if removeErr := os.Remove(tmpFileName); removeErr != nil && !os.IsNotExist(removeErr) {
			return fmt.Errorf("failed to rename temp file %q to %q: %w (also failed to remove temp file: %v)", tmpFileName, fileName, err, removeErr)
		}
		return err
	}
	return nil
}

var (
	systemBinDirs = []string{
		"/bin/",
		"/usr/bin/",
		"/usr/local/bin/",
		"/opt/bin/",
		"/sbin/",
		"/usr/sbin/",
	}
	suspiciousPattern = regexp.MustCompile(`[:;#!&$\t%="|>{}]`)
	flagPattern       = regexp.MustCompile(` --?[a-zA-Z0-9]`)
)

// IsInitScriptPath tries to determine if the input string is a path to a script
// rather than an inline script content.
func IsInitScriptPath(input string) bool {
	if len(input) == 0 || strings.Contains(input, "\n") {
		return false
	}

	if suspiciousPattern.MatchString(input) {
		return false
	}

	if flagPattern.MatchString(input) {
		return false
	}

	// Check for home directory path
	if strings.HasPrefix(input, "~/") {
		return true
	}

	// Path must be absolute (if not home directory)
	if !filepath.IsAbs(input) {
		return false
	}

	// Check if path starts with system binary directories
	normalizedPath := filepath.ToSlash(input)
	for _, binDir := range systemBinDirs {
		if strings.HasPrefix(normalizedPath, binDir) {
			return false
		}
	}

	return true
}

const (
	TempFileSuffix  = ".tmp"
	MaxEditFileSize = 5 * 1024 * 1024 // 5MB
)

type EditSpec struct {
	OldStr string `json:"old_str"`
	NewStr string `json:"new_str"`
	Desc   string `json:"desc,omitempty"`
}

type EditResult struct {
	Applied bool   `json:"applied"`
	Desc    string `json:"desc"`
	Error   string `json:"error,omitempty"`
}

func normalizeLineEndingsToLF(input string) string {
	normalized := strings.ReplaceAll(input, "\r\n", "\n")
	return strings.ReplaceAll(normalized, "\r", "\n")
}

func convertLineEndingsToStyle(input string, lineEnding string) string {
	normalized := normalizeLineEndingsToLF(input)
	if lineEnding == "\r\n" {
		return strings.ReplaceAll(normalized, "\n", "\r\n")
	}
	return normalized
}

func lineEndingCandidates(content []byte) []string {
	candidates := make([]string, 0, 2)
	if bytes.Contains(content, []byte("\r\n")) {
		candidates = append(candidates, "\r\n")
	}
	if bytes.Contains(content, []byte("\n")) {
		candidates = append(candidates, "\n")
	}
	return candidates
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	lines := strings.Split(s, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func findMinIndent(lines []string) int {
	minIndent := -1
	for _, line := range lines {
		trimmed := strings.TrimLeft(line, " \t")
		if trimmed == "" {
			continue
		}
		indent := len(line) - len(trimmed)
		if minIndent == -1 || indent < minIndent {
			minIndent = indent
		}
	}
	if minIndent < 0 {
		return 0
	}
	return minIndent
}

func stripIndent(lines []string, n int) []string {
	if n <= 0 {
		return lines
	}
	result := make([]string, len(lines))
	for i, line := range lines {
		trimmed := strings.TrimLeft(line, " \t")
		if trimmed == "" {
			result[i] = line
			continue
		}
		leadingLen := len(line) - len(trimmed)
		if leadingLen >= n {
			result[i] = line[n:]
		} else {
			result[i] = trimmed
		}
	}
	return result
}

func leadingWS(s string) string {
	return s[:len(s)-len(strings.TrimLeft(s, " \t"))]
}

func tryWhitespaceMatch(wholeLines, partLines []string) (string, bool) {
	if len(wholeLines) != len(partLines) {
		return "", false
	}
	for i := range wholeLines {
		if strings.TrimSpace(wholeLines[i]) != strings.TrimSpace(partLines[i]) {
			return "", false
		}
	}
	indentSet := make(map[string]bool)
	for i := range wholeLines {
		if strings.TrimSpace(wholeLines[i]) == "" {
			continue
		}
		wWS := leadingWS(wholeLines[i])
		pWS := leadingWS(partLines[i])
		if len(wWS) < len(pWS) {
			return "", false
		}
		extra := wWS[:len(wWS)-len(pWS)]
		indentSet[extra] = true
	}
	if len(indentSet) != 1 {
		return "", false
	}
	for indent := range indentSet {
		return indent, true
	}
	return "", false
}

func whitespaceTolerantReplace(content []byte, edit EditSpec) ([]byte, bool) {
	contentStr := normalizeLineEndingsToLF(string(content))
	oldStr := normalizeLineEndingsToLF(edit.OldStr)
	newStr := normalizeLineEndingsToLF(edit.NewStr)
	contentLines := splitLines(contentStr)
	oldLines := splitLines(oldStr)
	newLines := splitLines(newStr)
	minIndent := findMinIndent(append(append([]string{}, oldLines...), newLines...))
	strippedOldLines := stripIndent(oldLines, minIndent)
	strippedNewLines := stripIndent(newLines, minIndent)
	numOldLines := len(strippedOldLines)
	if numOldLines == 0 || numOldLines > len(contentLines) {
		return nil, false
	}
	matchCount := 0
	var matchIndex int
	var matchExtraIndent string
	for i := 0; i <= len(contentLines)-numOldLines; i++ {
		extraIndent, ok := tryWhitespaceMatch(contentLines[i:i+numOldLines], strippedOldLines)
		if ok {
			matchCount++
			if matchCount == 1 {
				matchIndex = i
				matchExtraIndent = extraIndent
			}
			if matchCount > 1 {
				return nil, false
			}
		}
	}
	if matchCount == 0 {
		return nil, false
	}
	adjustedNewLines := make([]string, len(strippedNewLines))
	for j, line := range strippedNewLines {
		if strings.TrimSpace(line) == "" {
			adjustedNewLines[j] = line
		} else {
			adjustedNewLines[j] = matchExtraIndent + line
		}
	}
	newContentLines := make([]string, 0, len(contentLines)-numOldLines+len(adjustedNewLines))
	newContentLines = append(newContentLines, contentLines[:matchIndex]...)
	newContentLines = append(newContentLines, adjustedNewLines...)
	newContentLines = append(newContentLines, contentLines[matchIndex+numOldLines:]...)
	result := strings.Join(newContentLines, "\n")
	if bytes.Contains(content, []byte("\r\n")) {
		result = strings.ReplaceAll(result, "\n", "\r\n")
	}
	if len(content) > 0 && content[len(content)-1] == '\n' {
		result += "\n"
	}
	return []byte(result), true
}

func findSimilarLines(oldStr string, content []byte, maxLines int) string {
	contentStr := normalizeLineEndingsToLF(string(content))
	contentLines := splitLines(contentStr)
	oldStrNormalized := normalizeLineEndingsToLF(oldStr)
	oldLines := splitLines(oldStrNormalized)
	var targetLine string
	for _, line := range oldLines {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			targetLine = trimmed
			break
		}
	}
	if targetLine == "" {
		return ""
	}
	for i, line := range contentLines {
		if strings.Contains(strings.TrimSpace(line), targetLine) {
			start := i - 1
			if start < 0 {
				start = 0
			}
			end := i + 2
			if end > len(contentLines) {
				end = len(contentLines)
			}
			if end-start > maxLines {
				end = start + maxLines
			}
			var buf strings.Builder
			for j := start; j < end; j++ {
				fmt.Fprintf(&buf, "%d: %s\n", j+1, contentLines[j])
			}
			return buf.String()
		}
	}
	return ""
}

func computeLineScore(windowLines, oldLines []string) float64 {
	if len(windowLines) != len(oldLines) {
		return 0
	}
	totalScore := 0.0
	scoredLines := 0
	for i := range windowLines {
		wTrimmed := strings.TrimSpace(windowLines[i])
		oTrimmed := strings.TrimSpace(oldLines[i])
		if wTrimmed == oTrimmed {
			totalScore += 1.0
			scoredLines++
		} else if wTrimmed == "" || oTrimmed == "" {
			continue
		} else {
			maxLen := len(wTrimmed)
			if len(oTrimmed) > maxLen {
				maxLen = len(oTrimmed)
			}
			if maxLen == 0 {
				continue
			}
			lcsLen := longestCommonSubsequenceLen(wTrimmed, oTrimmed)
			lineScore := float64(lcsLen) / float64(maxLen)
			if lineScore < 0.7 {
				return 0
			}
			totalScore += lineScore
			scoredLines++
		}
	}
	if scoredLines == 0 {
		return 0
	}
	return totalScore / float64(scoredLines)
}

func longestCommonSubsequenceLen(a, b string) int {
	m, n := len(a), len(b)
	if m == 0 || n == 0 {
		return 0
	}
	prev := make([]int, n+1)
	curr := make([]int, n+1)
	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if a[i-1] == b[j-1] {
				curr[j] = prev[j-1] + 1
			} else {
				if prev[j] > curr[j-1] {
					curr[j] = prev[j]
				} else {
					curr[j] = curr[j-1]
				}
			}
		}
		prev, curr = curr, prev
		for k := range curr {
			curr[k] = 0
		}
	}
	return prev[n]
}

func adjustNewStrIndent(newLines, oldLines, fileWindowLines []string) []string {
	if len(oldLines) != len(fileWindowLines) {
		return newLines
	}
	minOld := findMinIndent(oldLines)
	minFile := findMinIndent(fileWindowLines)
	offset := minFile - minOld
	if offset == 0 {
		return newLines
	}
	fileUsesTabs := false
	for _, line := range fileWindowLines {
		if strings.HasPrefix(line, "\t") {
			fileUsesTabs = true
			break
		}
	}
	adjusted := make([]string, len(newLines))
	for i, line := range newLines {
		if strings.TrimSpace(line) == "" {
			adjusted[i] = line
			continue
		}
		lineWS := leadingWS(line)
		newLen := len(lineWS) + offset
		if newLen < 0 {
			newLen = 0
		}
		if newLen <= len(lineWS) {
			adjusted[i] = lineWS[:newLen] + strings.TrimLeft(line, " \t")
		} else {
			padChar := " "
			if fileUsesTabs {
				padChar = "\t"
			}
			adjusted[i] = strings.Repeat(padChar, newLen-len(lineWS)) + line
		}
	}
	return adjusted
}

func fuzzyMatchReplace(content []byte, edit EditSpec, threshold float64) ([]byte, bool) {
	contentStr := normalizeLineEndingsToLF(string(content))
	oldStr := normalizeLineEndingsToLF(edit.OldStr)
	newStr := normalizeLineEndingsToLF(edit.NewStr)
	contentLines := splitLines(contentStr)
	oldLines := splitLines(oldStr)
	newLines := splitLines(newStr)
	numOldLines := len(oldLines)
	if numOldLines == 0 || numOldLines > len(contentLines) {
		return nil, false
	}
	const maxLinesForFuzzy = 5000
	if len(contentLines) > maxLinesForFuzzy {
		return nil, false
	}
	var bestScore float64
	bestIndex := -1
	for i := 0; i <= len(contentLines)-numOldLines; i++ {
		score := computeLineScore(contentLines[i:i+numOldLines], oldLines)
		if score > bestScore {
			bestScore = score
			bestIndex = i
		}
	}
	if bestScore < threshold || bestIndex < 0 {
		return nil, false
	}
	for i := 0; i <= len(contentLines)-numOldLines; i++ {
		if i == bestIndex {
			continue
		}
		score := computeLineScore(contentLines[i:i+numOldLines], oldLines)
		if score >= bestScore*0.95 && score >= threshold {
			return nil, false
		}
	}
	adjustedNewLines := adjustNewStrIndent(newLines, oldLines, contentLines[bestIndex:bestIndex+numOldLines])
	newContentLines := make([]string, 0, len(contentLines)-numOldLines+len(adjustedNewLines))
	newContentLines = append(newContentLines, contentLines[:bestIndex]...)
	newContentLines = append(newContentLines, adjustedNewLines...)
	newContentLines = append(newContentLines, contentLines[bestIndex+numOldLines:]...)
	result := strings.Join(newContentLines, "\n")
	if bytes.Contains(content, []byte("\r\n")) {
		result = strings.ReplaceAll(result, "\n", "\r\n")
	}
	if len(content) > 0 && content[len(content)-1] == '\n' {
		result += "\n"
	}
	return []byte(result), true
}

var ellipsisRe = regexp.MustCompile(`^\s*\.\.\.\s*$`)

func splitByEllipsis(lines []string) [][]string {
	segments := make([][]string, 0, 2)
	prev := 0
	for i, line := range lines {
		if ellipsisRe.MatchString(line) {
			segments = append(segments, lines[prev:i])
			prev = i + 1
		}
	}
	segments = append(segments, lines[prev:])
	return segments
}

func linesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

type segmentMatch struct {
	startLine int
	endLine   int
	newLines  []string
}

func tryEllipsisReplace(content []byte, edit EditSpec) ([]byte, bool) {
	oldStr := normalizeLineEndingsToLF(edit.OldStr)
	newStr := normalizeLineEndingsToLF(edit.NewStr)
	oldLines := splitLines(oldStr)
	newLines := splitLines(newStr)
	hasEllipsis := false
	for _, line := range oldLines {
		if ellipsisRe.MatchString(line) {
			hasEllipsis = true
			break
		}
	}
	if !hasEllipsis {
		return nil, false
	}
	oldSegments := splitByEllipsis(oldLines)
	newSegments := splitByEllipsis(newLines)
	if len(oldSegments) != len(newSegments) {
		return nil, false
	}
	contentStr := normalizeLineEndingsToLF(string(content))
	contentLines := splitLines(contentStr)
	currentPos := 0
	var replacements []segmentMatch
	for segIdx := 0; segIdx < len(oldSegments); segIdx++ {
		oldSeg := oldSegments[segIdx]
		newSeg := newSegments[segIdx]
		if len(oldSeg) == 0 && len(newSeg) == 0 {
			continue
		}
		if len(oldSeg) == 0 {
			replacements = append(replacements, segmentMatch{
				startLine: currentPos,
				endLine:   currentPos,
				newLines:  newSeg,
			})
			continue
		}
		found := false
		for i := currentPos; i <= len(contentLines)-len(oldSeg); i++ {
			if linesEqual(contentLines[i:i+len(oldSeg)], oldSeg) {
				if !linesEqual(oldSeg, newSeg) {
					replacements = append(replacements, segmentMatch{
						startLine: i,
						endLine:   i + len(oldSeg),
						newLines:  newSeg,
					})
				}
				currentPos = i + len(oldSeg)
				found = true
				break
			}
		}
		if !found {
			return nil, false
		}
	}
	if len(replacements) == 0 {
		return nil, false
	}
	result := make([]string, len(contentLines))
	copy(result, contentLines)
	for i := len(replacements) - 1; i >= 0; i-- {
		r := replacements[i]
		newResult := make([]string, 0, len(result)-(r.endLine-r.startLine)+len(r.newLines))
		newResult = append(newResult, result[:r.startLine]...)
		newResult = append(newResult, r.newLines...)
		newResult = append(newResult, result[r.endLine:]...)
		result = newResult
	}
	resultStr := strings.Join(result, "\n")
	if bytes.Contains(content, []byte("\r\n")) {
		resultStr = strings.ReplaceAll(resultStr, "\n", "\r\n")
	}
	if len(content) > 0 && content[len(content)-1] == '\n' {
		resultStr += "\n"
	}
	return []byte(resultStr), true
}

// applyEdit applies a single edit to the content and returns the modified content and result.
func applyEdit(content []byte, edit EditSpec, index int) ([]byte, EditResult) {
	result := EditResult{
		Desc: edit.Desc,
	}
	if result.Desc == "" {
		result.Desc = fmt.Sprintf("Edit %d", index+1)
	}

	if edit.OldStr == "" {
		result.Applied = false
		result.Error = "old_str cannot be empty"
		return content, result
	}

	oldBytes := []byte(edit.OldStr)
	count := bytes.Count(content, oldBytes)
	if count == 0 {
		for _, lineEnding := range lineEndingCandidates(content) {
			convertedOldStr := convertLineEndingsToStyle(edit.OldStr, lineEnding)
			if convertedOldStr == edit.OldStr {
				continue
			}

			convertedOldBytes := []byte(convertedOldStr)
			convertedCount := bytes.Count(content, convertedOldBytes)
			if convertedCount == 0 {
				continue
			}
			if convertedCount > 1 {
				result.Applied = false
				result.Error = fmt.Sprintf("old_str appears %d times after normalizing line endings, must appear exactly once", convertedCount)
				return content, result
			}

			convertedNewStr := convertLineEndingsToStyle(edit.NewStr, lineEnding)
			modifiedContent := bytes.Replace(content, convertedOldBytes, []byte(convertedNewStr), 1)
			result.Applied = true
			return modifiedContent, result
		}

		modified, ok := tryEllipsisReplace(content, edit)
		if ok {
			result.Applied = true
			return modified, result
		}

		modified, ok = whitespaceTolerantReplace(content, edit)
		if ok {
			result.Applied = true
			return modified, result
		}

		modified, ok = fuzzyMatchReplace(content, edit, 0.8)
		if ok {
			result.Applied = true
			return modified, result
		}

		result.Applied = false
		errMsg := "old_str not found in file"
		if hint := findSimilarLines(edit.OldStr, content, 3); hint != "" {
			errMsg += fmt.Sprintf("\nDid you mean to match these lines?\n%s", hint)
		}
		result.Error = errMsg
		return content, result
	}
	if count > 1 {
		result.Applied = false
		result.Error = fmt.Sprintf("old_str appears %d times, must appear exactly once", count)
		return content, result
	}

	modifiedContent := bytes.Replace(content, oldBytes, []byte(edit.NewStr), 1)
	result.Applied = true
	return modifiedContent, result
}

// ApplyEdits applies a series of edits to the given content and returns the modified content.
// This is atomic - all edits succeed or all fail.
func ApplyEdits(originalContent []byte, edits []EditSpec) ([]byte, error) {
	modifiedContents := originalContent

	for i, edit := range edits {
		var result EditResult
		modifiedContents, result = applyEdit(modifiedContents, edit, i)
		if !result.Applied {
			return nil, fmt.Errorf("edit %d (%s): %s", i, result.Desc, result.Error)
		}
	}

	return modifiedContents, nil
}

// ApplyEditsPartial applies edits incrementally, continuing until the first failure.
// Returns the modified content (potentially partially applied) and results for each edit.
func ApplyEditsPartial(originalContent []byte, edits []EditSpec) ([]byte, []EditResult) {
	modifiedContents := originalContent
	results := make([]EditResult, len(edits))
	failed := false

	for i, edit := range edits {
		if failed {
			results[i].Desc = edit.Desc
			if results[i].Desc == "" {
				results[i].Desc = fmt.Sprintf("Edit %d", i+1)
			}
			results[i].Applied = false
			results[i].Error = "previous edit failed"
			continue
		}

		modifiedContents, results[i] = applyEdit(modifiedContents, edit, i)
		if !results[i].Applied {
			failed = true
			if i > 0 {
				prevApplied := 0
				for j := 0; j < i; j++ {
					if results[j].Applied {
						prevApplied++
					}
				}
				if prevApplied > 0 {
					results[i].Error += fmt.Sprintf("\nNote: %d previous edit(s) were applied to this file before this edit. The content may have changed. Consider re-reading the file to get the latest content before retrying.", prevApplied)
				}
			}
		}
	}

	return modifiedContents, results
}

func ReplaceInFile(filePath string, edits []EditSpec) error {
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return fmt.Errorf("failed to stat file: %w", err)
	}

	if !fileInfo.Mode().IsRegular() {
		return fmt.Errorf("not a regular file: %s", filePath)
	}

	if fileInfo.Size() > MaxEditFileSize {
		return fmt.Errorf("file too large for editing: %d bytes (max: %d)", fileInfo.Size(), MaxEditFileSize)
	}

	contents, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	modifiedContents, err := ApplyEdits(contents, edits)
	if err != nil {
		return err
	}

	if err := os.WriteFile(filePath, modifiedContents, fileInfo.Mode()); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

// ReplaceInFilePartial applies edits incrementally up to the first failure.
// Returns the results for each edit and writes the partially modified content.
func ReplaceInFilePartial(filePath string, edits []EditSpec) ([]EditResult, error) {
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	if !fileInfo.Mode().IsRegular() {
		return nil, fmt.Errorf("not a regular file: %s", filePath)
	}

	if fileInfo.Size() > MaxEditFileSize {
		return nil, fmt.Errorf("file too large for editing: %d bytes (max: %d)", fileInfo.Size(), MaxEditFileSize)
	}

	contents, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	modifiedContents, results := ApplyEditsPartial(contents, edits)

	if err := os.WriteFile(filePath, modifiedContents, fileInfo.Mode()); err != nil {
		return nil, fmt.Errorf("failed to write file: %w", err)
	}

	return results, nil
}
