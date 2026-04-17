// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package skills

type SkillMetadata struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type SkillResourceType string

const (
	SkillResourceScript   SkillResourceType = "script"
	SkillResourceTemplate SkillResourceType = "template"
	SkillResourceConfig   SkillResourceType = "config"
	SkillResourceData     SkillResourceType = "data"
	SkillResourceOther    SkillResourceType = "other"
)

type SkillResource struct {
	Name    string            `json:"name"`
	Path    string            `json:"path"`
	Type    SkillResourceType `json:"type"`
	Content string            `json:"content,omitempty"`
	Size    int64             `json:"size"`
}

type Skill struct {
	Metadata     SkillMetadata   `json:"metadata"`
	Content      string          `json:"content"`
	Path         string          `json:"path"`
	Directory    string          `json:"directory"`
	Enabled      bool            `json:"enabled"`
	LastModified int64           `json:"lastModified,omitempty"`
	Resources    []SkillResource `json:"resources,omitempty"`
}

type SkillState struct {
	SkillId  string                 `json:"skillId"`
	Enabled  bool                   `json:"enabled"`
	Config   map[string]interface{} `json:"config,omitempty"`
	LastUsed int64                  `json:"lastUsed,omitempty"`
}

type SkillParseResult struct {
	Success bool   `json:"success"`
	Skill   *Skill `json:"skill,omitempty"`
	Error   string `json:"error,omitempty"`
}

type SkillDirectory struct {
	Path   string `json:"path"`
	Exists bool   `json:"exists"`
}

type SkillValidationResult struct {
	Valid    bool     `json:"valid"`
	Errors   []string `json:"errors"`
	Warnings []string `json:"warnings"`
}

type SkillImportErrorCode string

const (
	SkillImportErrorInvalidZip      SkillImportErrorCode = "INVALID_ZIP"
	SkillImportErrorNoSkillMd       SkillImportErrorCode = "NO_SKILL_MD"
	SkillImportErrorInvalidMetadata SkillImportErrorCode = "INVALID_METADATA"
	SkillImportErrorDirExists       SkillImportErrorCode = "DIR_EXISTS"
	SkillImportErrorExtractFailed   SkillImportErrorCode = "EXTRACT_FAILED"
	SkillImportErrorUnknown         SkillImportErrorCode = "UNKNOWN"
)

type SkillImportResult struct {
	Success   bool                 `json:"success"`
	SkillName string               `json:"skillName,omitempty"`
	Error     string               `json:"error,omitempty"`
	ErrorCode SkillImportErrorCode `json:"errorCode,omitempty"`
}

const SkillFileName = "SKILL.md"
const SkillsDirName = "skills"
const MaxResourceAutoLoadSize = 100 * 1024

var RequiredSkillFields = []string{"name", "description"}

var ResourceTypeMap = map[string]SkillResourceType{
	".sh": SkillResourceScript, ".bash": SkillResourceScript, ".zsh": SkillResourceScript,
	".py": SkillResourceScript, ".js": SkillResourceScript, ".ts": SkillResourceScript,
	".rb": SkillResourceScript, ".pl": SkillResourceScript, ".ps1": SkillResourceScript,
	".bat": SkillResourceScript, ".cmd": SkillResourceScript,
	".tmpl": SkillResourceTemplate, ".tpl": SkillResourceTemplate, ".hbs": SkillResourceTemplate,
	".ejs": SkillResourceTemplate, ".jinja": SkillResourceTemplate, ".jinja2": SkillResourceTemplate,
	".mustache": SkillResourceTemplate,
	".json": SkillResourceConfig, ".yaml": SkillResourceConfig, ".yml": SkillResourceConfig,
	".toml": SkillResourceConfig, ".ini": SkillResourceConfig, ".conf": SkillResourceConfig,
	".env": SkillResourceConfig,
	".csv": SkillResourceData, ".tsv": SkillResourceData, ".xml": SkillResourceData, ".sql": SkillResourceData,
}

var IgnoredResourceFiles = []string{
	SkillFileName, ".DS_Store", "Thumbs.db", ".git", ".gitignore",
	"node_modules", "__pycache__", ".vscode", ".idea",
}

var TextFileExtensions = []string{
	".txt", ".md", ".markdown", ".rst",
	".sh", ".bash", ".zsh", ".py", ".js", ".ts", ".rb", ".pl", ".ps1", ".bat", ".cmd",
	".json", ".yaml", ".yml", ".toml", ".ini", ".conf", ".env",
	".xml", ".html", ".htm", ".css", ".sql",
	".tmpl", ".tpl", ".hbs", ".ejs", ".jinja", ".jinja2", ".mustache",
	".csv", ".tsv",
}
