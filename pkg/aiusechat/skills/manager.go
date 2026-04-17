// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package skills

import (
	"archive/zip"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"
)

type SkillsManager struct {
	mu               sync.RWMutex
	skills           map[string]*Skill
	skillStates      map[string]*SkillState
	watcher          *fsnotify.Watcher
	initialized      bool
	configDir        string
	builtinSkillsDir string
	builtinFS        fs.FS
	builtinFSPrefix  string
	onSkillsUpdate   func()
}

func NewSkillsManager(configDir string, builtinSkillsDir string) *SkillsManager {
	return &SkillsManager{
		skills:           make(map[string]*Skill),
		skillStates:      make(map[string]*SkillState),
		configDir:        configDir,
		builtinSkillsDir: builtinSkillsDir,
	}
}

func (m *SkillsManager) SetOnSkillsUpdate(fn func()) {
	m.onSkillsUpdate = fn
}

func (m *SkillsManager) SetBuiltinFS(fsys fs.FS, prefix string) {
	m.builtinFS = fsys
	m.builtinFSPrefix = prefix
}

func (m *SkillsManager) Initialize() error {
	if m.initialized {
		return nil
	}

	if err := m.loadSkillStates(); err != nil {
		log.Printf("[SkillsManager] Warning: failed to load skill states: %v", err)
	}

	if err := m.loadAllSkills(); err != nil {
		return fmt.Errorf("failed to load skills: %w", err)
	}

	if err := m.setupFileWatchers(); err != nil {
		log.Printf("[SkillsManager] Warning: failed to setup file watchers: %v", err)
	}

	m.initialized = true
	log.Printf("[SkillsManager] Initialized with %d skills", len(m.skills))
	return nil
}

func (m *SkillsManager) Close() {
	if m.watcher != nil {
		m.watcher.Close()
	}
}

func (m *SkillsManager) GetSkillDirectories() []SkillDirectory {
	var dirs []SkillDirectory

	if m.builtinFS != nil {
		dirs = append(dirs, SkillDirectory{
			Path:   "builtin:skills",
			Exists: true,
		})
	} else {
		dirs = append(dirs, SkillDirectory{
			Path:   m.builtinSkillsDir,
			Exists: dirExists(m.builtinSkillsDir),
		})
	}

	userPath := filepath.Join(m.configDir, SkillsDirName)
	dirs = append(dirs, SkillDirectory{
		Path:   userPath,
		Exists: dirExists(userPath),
	})

	return dirs
}

func (m *SkillsManager) GetUserSkillsPath() string {
	return filepath.Join(m.configDir, SkillsDirName)
}

func (m *SkillsManager) loadAllSkills() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.skills = make(map[string]*Skill)

	if m.builtinFS != nil {
		if err := m.loadSkillsFromBuiltinFS(); err != nil {
			log.Printf("[SkillsManager] Failed to load builtin skills from FS: %v", err)
		}
	} else if m.builtinSkillsDir != "" && dirExists(m.builtinSkillsDir) {
		if err := m.loadSkillsFromDirectory(m.builtinSkillsDir); err != nil {
			log.Printf("[SkillsManager] Failed to load skills from %s: %v", m.builtinSkillsDir, err)
		}
	}

	userPath := filepath.Join(m.configDir, SkillsDirName)
	if dirExists(userPath) {
		if err := m.loadSkillsFromDirectory(userPath); err != nil {
			log.Printf("[SkillsManager] Failed to load skills from %s: %v", userPath, err)
		}
	}

	if m.onSkillsUpdate != nil {
		m.onSkillsUpdate()
	}
	return nil
}

func (m *SkillsManager) LoadAllSkills() error {
	return m.loadAllSkills()
}

func (m *SkillsManager) loadSkillsFromDirectory(dirPath string) error {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return fmt.Errorf("failed to read directory %s: %w", dirPath, err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			skillPath := filepath.Join(dirPath, entry.Name(), SkillFileName)
			result := m.parseSkillFile(skillPath)
			if result.Success && result.Skill != nil {
				state := m.skillStates[result.Skill.Metadata.Name]
				if state != nil {
					result.Skill.Enabled = state.Enabled
				}
				m.skills[result.Skill.Metadata.Name] = result.Skill
			}
		} else if entry.Name() == SkillFileName {
			skillPath := filepath.Join(dirPath, entry.Name())
			result := m.parseSkillFile(skillPath)
			if result.Success && result.Skill != nil {
				state := m.skillStates[result.Skill.Metadata.Name]
				if state != nil {
					result.Skill.Enabled = state.Enabled
				}
				m.skills[result.Skill.Metadata.Name] = result.Skill
			}
		}
	}
	return nil
}

func (m *SkillsManager) loadSkillsFromBuiltinFS() error {
	if m.builtinFS == nil {
		return nil
	}

	skillsDir := m.builtinFSPrefix
	if skillsDir == "" {
		skillsDir = "skills"
	}

	entries, err := fs.ReadDir(m.builtinFS, skillsDir)
	if err != nil {
		return fmt.Errorf("failed to read builtin skills directory: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		skillMdPath := skillsDir + "/" + entry.Name() + "/" + SkillFileName
		content, err := fs.ReadFile(m.builtinFS, skillMdPath)
		if err != nil {
			log.Printf("[SkillsManager] Warning: failed to read builtin skill %s: %v", skillMdPath, err)
			continue
		}

		metadata, body := m.parseFrontmatter(string(content))
		validation := m.validateMetadata(metadata)
		if !validation.Valid {
			log.Printf("[SkillsManager] Warning: invalid builtin skill metadata %s: %s", skillMdPath, strings.Join(validation.Errors, ", "))
			continue
		}

		skill := &Skill{
			Metadata:  metadata,
			Content:   body,
			Path:      "builtin:" + skillMdPath,
			Directory: "builtin:" + skillsDir + "/" + entry.Name(),
			Enabled:   true,
		}

		state := m.skillStates[skill.Metadata.Name]
		if state != nil {
			skill.Enabled = state.Enabled
		}
		m.skills[skill.Metadata.Name] = skill
	}
	return nil
}

func (m *SkillsManager) ParseSkillFile(filePath string) SkillParseResult {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.parseSkillFile(filePath)
}

func (m *SkillsManager) parseSkillFile(filePath string) SkillParseResult {
	if !fileExists(filePath) {
		return SkillParseResult{Success: false, Error: fmt.Sprintf("File not found: %s", filePath)}
	}

	content, err := os.ReadFile(filePath)
	if err != nil {
		return SkillParseResult{Success: false, Error: fmt.Sprintf("Failed to read file: %v", err)}
	}

	stat, err := os.Stat(filePath)
	if err != nil {
		return SkillParseResult{Success: false, Error: fmt.Sprintf("Failed to stat file: %v", err)}
	}

	directory := filepath.Dir(filePath)
	metadata, body := m.parseFrontmatter(string(content))

	validation := m.validateMetadata(metadata)
	if !validation.Valid {
		return SkillParseResult{Success: false, Error: fmt.Sprintf("Invalid skill metadata: %s", strings.Join(validation.Errors, ", "))}
	}

	resources, err := m.scanSkillResources(directory)
	if err != nil {
		log.Printf("[SkillsManager] Warning: failed to scan resources in %s: %v", directory, err)
	}

	skill := &Skill{
		Metadata:     metadata,
		Content:      body,
		Path:         filePath,
		Directory:    directory,
		Enabled:      true,
		LastModified: stat.ModTime().UnixMilli(),
		Resources:    resources,
	}

	return SkillParseResult{Success: true, Skill: skill}
}

func (m *SkillsManager) parseFrontmatter(content string) (SkillMetadata, string) {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")

	re := regexp.MustCompile(`^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n([\s\S]*)$`)
	matches := re.FindStringSubmatch(normalized)

	if matches == nil {
		return m.parseMetadataFromContent(normalized)
	}

	metadata := m.parseYAML(matches[1])
	body := strings.TrimSpace(matches[2])
	return metadata, body
}

func (m *SkillsManager) parseYAML(yamlStr string) SkillMetadata {
	var metadata SkillMetadata
	lines := strings.Split(yamlStr, "\n")

	for _, line := range lines {
		colonIndex := strings.Index(line, ":")
		if colonIndex == -1 {
			continue
		}
		key := strings.TrimSpace(line[:colonIndex])
		value := strings.TrimSpace(line[colonIndex+1:])

		if (strings.HasPrefix(value, `"`) && strings.HasSuffix(value, `"`)) ||
			(strings.HasPrefix(value, "'") && strings.HasSuffix(value, "'")) {
			value = value[1 : len(value)-1]
		}

		switch key {
		case "name":
			metadata.Name = value
		case "description":
			metadata.Description = value
		}
	}

	return metadata
}

func (m *SkillsManager) parseMetadataFromContent(content string) (SkillMetadata, string) {
	var metadata SkillMetadata

	headingRe := regexp.MustCompile(`(?m)^#\s+(.+)$`)
	if match := headingRe.FindStringSubmatch(content); match != nil {
		metadata.Name = strings.TrimSpace(match[1])
	}

	paraRe := regexp.MustCompile(`(?m)^#.+\n+([^#\n][^\n]+)`)
	if match := paraRe.FindStringSubmatch(content); match != nil {
		metadata.Description = strings.TrimSpace(match[1])
	}

	return metadata, content
}

func (m *SkillsManager) ValidateMetadata(metadata SkillMetadata) SkillValidationResult {
	return m.validateMetadata(metadata)
}

func (m *SkillsManager) validateMetadata(metadata SkillMetadata) SkillValidationResult {
	var errors []string
	var warnings []string

	if metadata.Name == "" {
		errors = append(errors, "Missing required field: name")
	}
	if metadata.Description == "" {
		errors = append(errors, "Missing required field: description")
	}

	return SkillValidationResult{
		Valid:    len(errors) == 0,
		Errors:   errors,
		Warnings: warnings,
	}
}

func (m *SkillsManager) scanSkillResources(directory string) ([]SkillResource, error) {
	var resources []SkillResource
	m.scanSkillResourcesRecursive(directory, directory, &resources)
	return resources, nil
}

func (m *SkillsManager) ScanSkillResources(directory string) ([]SkillResource, error) {
	return m.scanSkillResources(directory)
}

func (m *SkillsManager) scanSkillResourcesRecursive(rootDir string, currentDir string, resources *[]SkillResource) {
	entries, err := os.ReadDir(currentDir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if containsString(IgnoredResourceFiles, entry.Name()) {
			continue
		}

		filePath := filepath.Join(currentDir, entry.Name())

		if entry.IsDir() {
			m.scanSkillResourcesRecursive(rootDir, filePath, resources)
			continue
		}

		stat, err := os.Stat(filePath)
		if err != nil {
			continue
		}

		ext := strings.ToLower(filepath.Ext(entry.Name()))
		resType, ok := ResourceTypeMap[ext]
		if !ok {
			resType = SkillResourceOther
		}

		relName, _ := filepath.Rel(rootDir, filePath)
		relName = filepath.ToSlash(relName)

		resource := SkillResource{
			Name: relName,
			Path: filePath,
			Type: resType,
			Size: stat.Size(),
		}

		if stat.Size() <= MaxResourceAutoLoadSize && isTextFile(ext) {
			content, err := os.ReadFile(filePath)
			if err == nil {
				resource.Content = string(content)
			}
		}

		*resources = append(*resources, resource)
	}
}

func (m *SkillsManager) GetSkillResourceContent(skillName string, resourceName string) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	skill, ok := m.skills[skillName]
	if !ok || skill.Resources == nil {
		return "", fmt.Errorf("skill %q or resource %q not found", skillName, resourceName)
	}

	for i := range skill.Resources {
		if skill.Resources[i].Name == resourceName {
			if skill.Resources[i].Content != "" {
				return skill.Resources[i].Content, nil
			}
			content, err := os.ReadFile(skill.Resources[i].Path)
			if err != nil {
				return "", fmt.Errorf("failed to read resource %q: %w", resourceName, err)
			}
			skill.Resources[i].Content = string(content)
			return skill.Resources[i].Content, nil
		}
	}

	return "", fmt.Errorf("resource %q not found in skill %q", resourceName, skillName)
}

func (m *SkillsManager) GetAllSkills() []*Skill {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]*Skill, 0, len(m.skills))
	for _, skill := range m.skills {
		result = append(result, skill)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Metadata.Name < result[j].Metadata.Name
	})
	return result
}

func (m *SkillsManager) GetEnabledSkills() []*Skill {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*Skill
	for _, skill := range m.skills {
		if skill.Enabled {
			result = append(result, skill)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Metadata.Name < result[j].Metadata.Name
	})
	return result
}

func (m *SkillsManager) GetSkill(name string) *Skill {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.skills[name]
}

func (m *SkillsManager) SetSkillEnabled(name string, enabled bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	skill, ok := m.skills[name]
	if !ok {
		return fmt.Errorf("skill not found: %s", name)
	}

	skill.Enabled = enabled
	m.saveSkillState(name, &SkillState{SkillId: name, Enabled: enabled})

	if m.onSkillsUpdate != nil {
		m.onSkillsUpdate()
	}
	return nil
}

func (m *SkillsManager) BuildSkillsPrompt() string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	enabledSkills := m.getEnabledSkillsLocked()
	if len(enabledSkills) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("\n====\n\n")
	sb.WriteString("AVAILABLE SKILLS\n\n")
	sb.WriteString("The following skills are available. Use the waveai_use_skill tool to invoke a skill when needed:\n\n")

	for _, skill := range enabledSkills {
		sb.WriteString(fmt.Sprintf("- **%s**: %s\n", skill.Metadata.Name, skill.Metadata.Description))
	}
	sb.WriteString("\n")

	return sb.String()
}

func (m *SkillsManager) getEnabledSkillsLocked() []*Skill {
	var result []*Skill
	for _, skill := range m.skills {
		if skill.Enabled {
			result = append(result, skill)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Metadata.Name < result[j].Metadata.Name
	})
	return result
}

func (m *SkillsManager) CreateUserSkill(metadata SkillMetadata, content string) (*Skill, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	userSkillsPath := filepath.Join(m.configDir, SkillsDirName)
	os.MkdirAll(userSkillsPath, 0755)

	dirName := strings.ToLower(metadata.Name)
	dirName = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(dirName, "-")
	dirName = strings.Trim(dirName, "-")

	if dirName == "" {
		dirName = fmt.Sprintf("skill-%d", len(m.skills)+1)
	}

	skillDir := filepath.Join(userSkillsPath, dirName)
	os.MkdirAll(skillDir, 0755)

	skillContent := m.buildSkillFile(metadata, content)
	skillPath := filepath.Join(skillDir, SkillFileName)
	if err := os.WriteFile(skillPath, []byte(skillContent), 0644); err != nil {
		return nil, fmt.Errorf("failed to write skill file: %w", err)
	}

	result := m.parseSkillFile(skillPath)
	if !result.Success || result.Skill == nil {
		return nil, fmt.Errorf("failed to parse created skill: %s", result.Error)
	}

	state := m.skillStates[result.Skill.Metadata.Name]
	if state != nil {
		result.Skill.Enabled = state.Enabled
	}
	m.skills[result.Skill.Metadata.Name] = result.Skill

	if m.onSkillsUpdate != nil {
		m.onSkillsUpdate()
	}
	return result.Skill, nil
}

func (m *SkillsManager) DeleteUserSkill(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	skill, ok := m.skills[name]
	if !ok {
		return fmt.Errorf("skill not found: %s", name)
	}

	userSkillsPath := filepath.Join(m.configDir, SkillsDirName)
	if !strings.HasPrefix(skill.Path, userSkillsPath) {
		return fmt.Errorf("cannot delete built-in skill: %s", name)
	}

	if err := os.RemoveAll(skill.Directory); err != nil {
		return fmt.Errorf("failed to delete skill directory: %w", err)
	}

	delete(m.skills, name)
	m.deleteSkillState(name)

	if m.onSkillsUpdate != nil {
		m.onSkillsUpdate()
	}
	return nil
}

func (m *SkillsManager) UpdateUserSkill(name string, metadata SkillMetadata, content string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	skill, ok := m.skills[name]
	if !ok {
		return fmt.Errorf("skill not found: %s", name)
	}

	userSkillsPath := filepath.Join(m.configDir, SkillsDirName)
	if !strings.HasPrefix(skill.Path, userSkillsPath) {
		return fmt.Errorf("cannot edit built-in skill: %s", name)
	}

	skillContent := m.buildSkillFile(metadata, content)
	if err := os.WriteFile(skill.Path, []byte(skillContent), 0644); err != nil {
		return fmt.Errorf("failed to write skill file: %w", err)
	}

	skill.Metadata = metadata
	skill.Content = content

	if m.onSkillsUpdate != nil {
		m.onSkillsUpdate()
	}
	return nil
}

func (m *SkillsManager) ImportSkillZip(zipPath string, overwrite bool) SkillImportResult {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return SkillImportResult{Success: false, Error: "Invalid ZIP file", ErrorCode: SkillImportErrorInvalidZip}
	}
	defer r.Close()

	var skillMdFile *zip.File
	var rootDir string

	for _, f := range r.File {
		name := filepath.ToSlash(f.Name)
		base := filepath.Base(name)
		if base == SkillFileName {
			skillMdFile = f
			rootDir = filepath.Dir(name)
			if rootDir == "." {
				rootDir = ""
			}
			break
		}
	}

	if skillMdFile == nil {
		return SkillImportResult{Success: false, Error: "No SKILL.md found in ZIP", ErrorCode: SkillImportErrorNoSkillMd}
	}

	rc, err := skillMdFile.Open()
	if err != nil {
		return SkillImportResult{Success: false, Error: "Failed to read SKILL.md", ErrorCode: SkillImportErrorExtractFailed}
	}

	content, err := io.ReadAll(rc)
	rc.Close()
	if err != nil {
		return SkillImportResult{Success: false, Error: "Failed to read SKILL.md content", ErrorCode: SkillImportErrorExtractFailed}
	}

	metadata, _ := m.parseFrontmatter(string(content))
	validation := m.validateMetadata(metadata)
	if !validation.Valid {
		return SkillImportResult{
			Success:   false,
			Error:     fmt.Sprintf("Invalid metadata: %s", strings.Join(validation.Errors, ", ")),
			ErrorCode: SkillImportErrorInvalidMetadata,
		}
	}

	userSkillsPath := filepath.Join(m.configDir, SkillsDirName)
	dirName := strings.ToLower(metadata.Name)
	dirName = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(dirName, "-")
	dirName = strings.Trim(dirName, "-")
	targetDir := filepath.Join(userSkillsPath, dirName)

	if dirExists(targetDir) && !overwrite {
		return SkillImportResult{Success: false, Error: "Skill directory already exists", ErrorCode: SkillImportErrorDirExists, SkillName: metadata.Name}
	}

	os.MkdirAll(targetDir, 0755)

	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}

		name := filepath.ToSlash(f.Name)
		relPath := name
		if rootDir != "" {
			prefix := rootDir + "/"
			if strings.HasPrefix(name, prefix) {
				relPath = strings.TrimPrefix(name, prefix)
			} else {
				continue
			}
		}
		if relPath == "" {
			continue
		}

		targetPath := filepath.Join(targetDir, relPath)
		os.MkdirAll(filepath.Dir(targetPath), 0755)

		rc, err := f.Open()
		if err != nil {
			continue
		}

		fileContent, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}

		os.WriteFile(targetPath, fileContent, 0644)
	}

	m.loadAllSkills()

	return SkillImportResult{Success: true, SkillName: metadata.Name}
}

func (m *SkillsManager) buildSkillFile(metadata SkillMetadata, content string) string {
	var sb strings.Builder
	sb.WriteString("---\n")
	sb.WriteString(fmt.Sprintf("name: %s\n", metadata.Name))
	sb.WriteString(fmt.Sprintf("description: %s\n", metadata.Description))
	sb.WriteString("---\n\n")
	sb.WriteString(content)
	return sb.String()
}

func (m *SkillsManager) setupFileWatchers() error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("failed to create watcher: %w", err)
	}
	m.watcher = watcher

	dirs := m.GetSkillDirectories()
	for _, dir := range dirs {
		if dir.Exists && strings.HasPrefix(dir.Path, m.configDir) {
			if err := watcher.Add(dir.Path); err != nil {
				log.Printf("[SkillsManager] Warning: failed to watch %s: %v", dir.Path, err)
			}
			subEntries, err := os.ReadDir(dir.Path)
			if err == nil {
				for _, entry := range subEntries {
					if entry.IsDir() {
						subDir := filepath.Join(dir.Path, entry.Name())
						if err := watcher.Add(subDir); err != nil {
							log.Printf("[SkillsManager] Warning: failed to watch %s: %v", subDir, err)
						}
					}
				}
			}
		}
	}

	go func() {
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if event.Has(fsnotify.Create) || event.Has(fsnotify.Write) || event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename) {
					if strings.HasSuffix(event.Name, SkillFileName) {
						log.Printf("[SkillsManager] Skill file changed: %s, reloading...", event.Name)
						m.loadAllSkills()
					} else if event.Has(fsnotify.Create) {
						info, err := os.Stat(event.Name)
						if err == nil && info.IsDir() {
							watcher.Add(event.Name)
						}
					}
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Printf("[SkillsManager] Watcher error: %v", err)
			}
		}
	}()

	return nil
}

func (m *SkillsManager) IsUserSkill(name string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	skill, ok := m.skills[name]
	if !ok {
		return false
	}
	userSkillsPath := filepath.Join(m.configDir, SkillsDirName)
	return strings.HasPrefix(skill.Path, userSkillsPath)
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.IsDir()
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

func containsString(slice []string, s string) bool {
	for _, item := range slice {
		if item == s {
			return true
		}
	}
	return false
}

func isTextFile(ext string) bool {
	return containsString(TextFileExtensions, ext)
}
