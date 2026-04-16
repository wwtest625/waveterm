# AI Skills 模块实现方案（对齐 Chaterm Skills 架构）

> **Goal:** 在 waveterm 设置系统中新增 Skills 模块，让 AI 模型能够通过 `waveai_use_skill` 工具调用预定义的技能指令集，扩展 AI 助手的专业能力。完整对齐 Chaterm 的 Skills 架构。

> **Reference:** Chaterm-main (`C:\Users\sys49169\Downloads\Github\Chaterm-main`)

**Architecture:** 以"SKILL.md 文件定义 + SkillsManager 加载/解析/管理 + 系统提示注入 + 工具调用激活 + 前端设置面板"五层架构实现 Skills 系统。后端从多个目录加载 SKILL.md 文件，解析 YAML frontmatter 元数据，管理启用/禁用状态，将已启用技能注入系统提示；模型通过 `waveai_use_skill` 工具按需激活技能获取完整指令；前端在设置面板中提供可视化的技能管理界面。

**Tech Stack:** Go（aiusechat/wconfig/wstore）、React + Jotai（waveconfig/aipanel）、JSON 配置、Vitest、Go test

---

## 与 Chaterm Skills 架构对齐总览

| 能力 | Chaterm 实现 | waveterm 现状 | 本方案目标 |
|------|-------------|--------------|-----------|
| 技能文件格式 | `SKILL.md`（YAML frontmatter + Markdown body） | 无 | 新增 `SKILL.md` 文件格式支持 |
| 技能元数据 | `SkillMetadata`（name, description） | 无 | 新增 `SkillMetadata` Go 结构体 |
| 技能资源文件 | `SkillResource`（script/template/config/data/other） | 无 | 新增 `SkillResource` Go 结构体，支持目录内资源文件扫描 |
| 技能管理器 | `SkillsManager`（加载/解析/状态/文件监听/ZIP导入） | 无 | 新增 Go 版 `SkillsManager` |
| 技能状态持久化 | SQLite `skills_state` 表 | 无 | 新增 JSON 文件持久化（对齐 waveterm 配置体系） |
| 系统提示注入 | `buildSkillsPrompt()` → "AVAILABLE SKILLS" 段落 | 无 | 新增 `buildSkillsPrompt()` Go 实现 |
| 技能激活工具 | `use_skill` 工具（XML 格式参数） | 无 | 新增 `waveai_use_skill` 工具（JSON Schema 参数） |
| 技能创建工具 | `summarize_to_skill` 工具 | 无 | 新增 `waveai_create_skill` 工具 |
| 前端设置面板 | `skills.vue`（列表/开关/创建/编辑/删除/导入） | 无 | 新增 React 版 Skills 设置面板 |
| 技能目录 | builtin + user + marketplace 三个目录 | 无 | 新增 builtin + user 两个目录 |
| 文件监听 | chokidar 监听 SKILL.md 变更自动重载 | 无 | 新增 fsnotify 监听自动重载 |
| ZIP 导入 | `adm-zip` 解压导入技能包 | 无 | 新增 Go 版 ZIP 导入 |
| 技能 Chip 激活 | 前端 Chip 选择技能 → 注入对话 | 无 | 新增前端技能 Chip 选择器 |

---

## 文件结构与职责

### 后端核心

- `pkg/aiusechat/skills/types.go`
  - **新增** `SkillMetadata` 结构体（name, description）
  - **新增** `SkillResource` 结构体（name, path, type, content, size）
  - **新增** `Skill` 结构体（metadata, content, path, directory, enabled, lastModified, resources）
  - **新增** `SkillState` 结构体（skillId, enabled, lastUsed）
  - **新增** `SkillParseResult` 结构体（success, skill, error）
  - **新增** `SkillDirectory` 结构体（path, exists）
  - **新增** `SkillValidationResult` 结构体（valid, errors, warnings）
  - **新增** `SkillImportResult` 结构体（success, skillName, error, errorCode）
  - **新增** 常量：`SkillFileName = "SKILL.md"`, `SkillsDirName = "skills"`
  - **新增** `ResourceTypeMap` 扩展名到资源类型的映射
  - **新增** `IgnoredResourceFiles` 忽略文件列表
  - **新增** `MaxResourceAutoLoadSize = 100KB`

- `pkg/aiusechat/skills/manager.go`
  - **新增** `SkillsManager` 结构体
  - **新增** `Initialize()` 方法：加载技能状态 → 加载所有技能 → 设置文件监听
  - **新增** `GetSkillDirectories()` 方法：返回 builtin + user 技能目录
  - **新增** `LoadAllSkills()` 方法：从所有目录加载技能
  - **新增** `LoadSkillsFromDirectory()` 方法：从指定目录加载技能
  - **新增** `ParseSkillFile()` 方法：解析 SKILL.md 文件（frontmatter + body）
  - **新增** `ParseFrontmatter()` 方法：解析 YAML frontmatter
  - **新增** `ParseYAML()` 方法：简易 YAML 解析器
  - **新增** `ValidateMetadata()` 方法：校验技能元数据
  - **新增** `ScanSkillResources()` 方法：递归扫描技能目录资源文件
  - **新增** `GetSkillResourceContent()` 方法：按需加载资源文件内容
  - **新增** `GetAllSkills()` / `GetEnabledSkills()` / `GetSkill()` 方法
  - **新增** `SetSkillEnabled()` 方法：启用/禁用技能
  - **新增** `BuildSkillsPrompt()` 方法：构建系统提示中的技能列表
  - **新增** `CreateUserSkill()` 方法：创建用户技能
  - **新增** `DeleteUserSkill()` 方法：删除用户技能
  - **新增** `UpdateUserSkill()` 方法：更新用户技能
  - **新增** `ImportSkillZip()` 方法：从 ZIP 导入技能
  - **新增** `SetupFileWatchers()` 方法：fsnotify 文件监听
  - **新增** `HandleSkillFileChange()` 方法：文件变更处理
  - **新增** `NotifySkillsUpdate()` 方法：通知前端技能更新

- `pkg/aiusechat/skills/state.go`
  - **新增** 技能状态持久化（JSON 文件，对齐 waveterm 配置体系）
  - **新增** `LoadSkillStates()` 方法：从 `skills_state.json` 加载状态
  - **新增** `SaveSkillStates()` 方法：保存状态到 `skills_state.json`
  - **新增** `GetSkillState()` / `SetSkillState()` / `DeleteSkillState()` 方法

- `pkg/aiusechat/tools_skills.go`
  - **新增** `GetUseSkillToolDefinition()` 函数：定义 `waveai_use_skill` 工具
  - **新增** `HandleUseSkillToolCall()` 函数：处理技能激活工具调用
  - **新增** `GetCreateSkillToolDefinition()` 函数：定义 `waveai_create_skill` 工具
  - **新增** `HandleCreateSkillToolCall()` 函数：处理技能创建工具调用

- `pkg/aiusechat/usechat.go`
  - **修改** `processAllToolCalls`：添加 `waveai_use_skill` / `waveai_create_skill` 工具分发
  - **修改** 系统提示构建：注入 `BuildSkillsPrompt()` 输出

- `pkg/aiusechat/usechat-prompts.go`
  - **新增** 技能相关提示词：技能使用指导、技能创建指导

- `pkg/aiusechat/tools.go`
  - **修改** 工具注册：注册 `waveai_use_skill` / `waveai_create_skill`

- `pkg/wconfig/settingsconfig.go`
  - **新增** `SkillsSettingsType` 结构体（skills:enabled, skills:dir 等）
  - **修改** `SettingsType`：添加 Skills 相关设置字段

- `pkg/wconfig/defaultconfig/settings.json`
  - **新增** 默认 Skills 设置值

- `schema/settings.json`
  - **新增** Skills 相关 JSON Schema 定义

- `pkg/wshrpc/wshrpc.go`
  - **新增** Skills 相关 RPC 命令类型定义

- `pkg/wshutil/wshrouter_controlimpl.go`
  - **新增** Skills RPC 命令处理

### 前端核心

- `frontend/app/view/waveconfig/skillsvisualcontent.tsx`
  - **新增** Skills 可视化设置面板组件
  - 技能列表展示（名称、描述、启用/禁用开关）
  - 创建技能弹窗（名称、描述、内容）
  - 编辑技能弹窗（描述、内容）
  - 删除技能确认
  - 打开技能文件夹
  - 刷新技能列表
  - ZIP 导入技能
  - 空状态提示

- `frontend/app/view/waveconfig/waveconfig-model.ts`
  - **修改** `configFiles` 数组：添加 Skills 配置文件条目

- `frontend/app/aipanel/aipanel.tsx`
  - **新增** 技能 Chip 选择器（在输入框上方）
  - **修改** 消息处理：识别 `skill_activated` 事件

- `frontend/app/aipanel/waveai-model.tsx`
  - **新增** `skillsAtom`：技能列表状态
  - **新增** 技能相关 action

### 技能文件

- `pkg/wconfig/defaultconfig/skills/`
  - **新增** 内置技能目录
  - **新增** 示例内置技能（如 `deploy-docker/SKILL.md`、`setup-nginx/SKILL.md`）

### 测试

- `pkg/aiusechat/skills/types_test.go`
- `pkg/aiusechat/skills/manager_test.go`
- `pkg/aiusechat/skills/state_test.go`
- `pkg/aiusechat/tools_skills_test.go`
- `frontend/app/view/waveconfig/tests/skillsvisualcontent.test.ts`

---

## Phase 1: 定义 Skills 数据模型（对齐 Chaterm SkillMetadata/Skill/SkillResource）

**目标：** 定义完整的 Skills 类型系统，对齐 Chaterm 的 `SkillMetadata`、`Skill`、`SkillResource`、`SkillState` 等核心类型。

### Task 1: 创建 Skills 类型定义

**Files:**
- Create: `pkg/aiusechat/skills/types.go`
- Test: `pkg/aiusechat/skills/types_test.go`

- [ ] **Step 1: 定义 SkillMetadata 结构体（对齐 Chaterm SkillMetadata）**

```go
package skills

type SkillMetadata struct {
    Name        string `json:"name"`
    Description string `json:"description"`
}
```

- [ ] **Step 2: 定义 SkillResource 结构体（对齐 Chaterm SkillResource）**

```go
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
```

- [ ] **Step 3: 定义 Skill 结构体（对齐 Chaterm Skill）**

```go
type Skill struct {
    Metadata     SkillMetadata   `json:"metadata"`
    Content      string          `json:"content"`
    Path         string          `json:"path"`
    Directory    string          `json:"directory"`
    Enabled      bool            `json:"enabled"`
    LastModified int64           `json:"lastModified,omitempty"`
    Resources    []SkillResource `json:"resources,omitempty"`
}
```

- [ ] **Step 4: 定义 SkillState 结构体（对齐 Chaterm SkillState）**

```go
type SkillState struct {
    SkillId  string                 `json:"skillId"`
    Enabled  bool                   `json:"enabled"`
    Config   map[string]interface{} `json:"config,omitempty"`
    LastUsed int64                  `json:"lastUsed,omitempty"`
}
```

- [ ] **Step 5: 定义辅助类型和常量**

```go
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
```

- [ ] **Step 6: 写测试验证类型序列化/反序列化**

```go
func TestSkillMetadata_Serialize(t *testing.T) {
    meta := skills.SkillMetadata{
        Name:        "deploy-docker",
        Description: "Deploy a Docker container with best practices",
    }
    data, err := json.Marshal(meta)
    if err != nil {
        t.Fatalf("marshal failed: %v", err)
    }
    var decoded skills.SkillMetadata
    if err := json.Unmarshal(data, &decoded); err != nil {
        t.Fatalf("unmarshal failed: %v", err)
    }
    if decoded.Name != "deploy-docker" {
        t.Fatalf("name mismatch: got %s", decoded.Name)
    }
    if decoded.Description != "Deploy a Docker container with best practices" {
        t.Fatalf("description mismatch: got %s", decoded.Description)
    }
}

func TestSkillResource_Serialize(t *testing.T) {
    res := skills.SkillResource{
        Name:    "scripts/setup.sh",
        Path:    "/path/to/skills/deploy-docker/scripts/setup.sh",
        Type:    skills.SkillResourceScript,
        Content: "#!/bin/bash\necho hello",
        Size:    24,
    }
    data, err := json.Marshal(res)
    if err != nil {
        t.Fatalf("marshal failed: %v", err)
    }
    var decoded skills.SkillResource
    if err := json.Unmarshal(data, &decoded); err != nil {
        t.Fatalf("unmarshal failed: %v", err)
    }
    if decoded.Type != skills.SkillResourceScript {
        t.Fatalf("type mismatch: got %s", decoded.Type)
    }
}

func TestSkill_FullSerialize(t *testing.T) {
    skill := skills.Skill{
        Metadata: skills.SkillMetadata{
            Name:        "deploy-docker",
            Description: "Deploy a Docker container",
        },
        Content:   "## Steps\n1. Pull image\n2. Run container",
        Path:      "/path/to/skills/deploy-docker/SKILL.md",
        Directory: "/path/to/skills/deploy-docker",
        Enabled:   true,
        Resources: []skills.SkillResource{
            {Name: "docker-compose.yml", Type: skills.SkillResourceConfig, Size: 512},
        },
    }
    data, err := json.Marshal(skill)
    if err != nil {
        t.Fatalf("marshal failed: %v", err)
    }
    var decoded skills.Skill
    if err := json.Unmarshal(data, &decoded); err != nil {
        t.Fatalf("unmarshal failed: %v", err)
    }
    if !decoded.Enabled {
        t.Fatalf("enabled should be true")
    }
    if len(decoded.Resources) != 1 {
        t.Fatalf("resources count mismatch: got %d", len(decoded.Resources))
    }
}
```

- [ ] **Step 7: 跑测试确认通过**

```bash
go test ./pkg/aiusechat/skills/... -run TestSkill
```

---

## Phase 2: 实现 SkillsManager 核心逻辑（对齐 Chaterm SkillsManager）

**目标：** 实现完整的技能管理器，支持从多个目录加载 SKILL.md 文件、解析 YAML frontmatter、管理启用/禁用状态、文件监听自动重载。

### Task 2: 实现 SkillsManager

**Files:**
- Create: `pkg/aiusechat/skills/manager.go`
- Test: `pkg/aiusechat/skills/manager_test.go`

- [ ] **Step 1: 定义 SkillsManager 结构体**

```go
type SkillsManager struct {
    mu              sync.RWMutex
    skills          map[string]*Skill
    skillStates     map[string]*SkillState
    watcher         *fsnotify.Watcher
    initialized     bool
    configDir       string
    builtinSkillsDir string
    onSkillsUpdate  func()
}

func NewSkillsManager(configDir string, builtinSkillsDir string) *SkillsManager {
    return &SkillsManager{
        skills:           make(map[string]*Skill),
        skillStates:      make(map[string]*SkillState),
        configDir:        configDir,
        builtinSkillsDir: builtinSkillsDir,
    }
}
```

- [ ] **Step 2: 实现 Initialize 方法（对齐 Chaterm SkillsManager.initialize）**

```go
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
```

- [ ] **Step 3: 实现 GetSkillDirectories 方法（对齐 Chaterm getSkillDirectories）**

```go
func (m *SkillsManager) GetSkillDirectories() []SkillDirectory {
    var dirs []SkillDirectory

    dirs = append(dirs, SkillDirectory{
        Path:   m.builtinSkillsDir,
        Exists: dirExists(m.builtinSkillsDir),
    })

    userPath := filepath.Join(m.configDir, SkillsDirName)
    dirs = append(dirs, SkillDirectory{
        Path:   userPath,
        Exists: dirExists(userPath),
    })

    return dirs
}
```

- [ ] **Step 4: 实现 LoadAllSkills / LoadSkillsFromDirectory 方法**

```go
func (m *SkillsManager) loadAllSkills() error {
    m.mu.Lock()
    defer m.mu.Unlock()

    m.skills = make(map[string]*Skill)
    dirs := m.GetSkillDirectories()

    for _, dir := range dirs {
        if dir.Exists {
            if err := m.loadSkillsFromDirectory(dir.Path); err != nil {
                log.Printf("[SkillsManager] Failed to load skills from %s: %v", dir.Path, err)
            }
        }
    }

    if m.onSkillsUpdate != nil {
        m.onSkillsUpdate()
    }
    return nil
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
```

- [ ] **Step 5: 实现 ParseSkillFile / ParseFrontmatter / ParseYAML 方法（对齐 Chaterm parseSkillFile/parseFrontmatter/parseYaml）**

```go
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

func (m *SkillsManager) parseYAML(yaml string) SkillMetadata {
    var metadata SkillMetadata
    lines := strings.Split(yaml, "\n")

    for _, line := range lines {
        colonIndex := strings.Index(line, ":")
        if colonIndex == -1 {
            continue
        }
        key := strings.TrimSpace(line[:colonIndex])
        value := strings.TrimSpace(line[colonIndex+1:])

        if (strings.HasPrefix(value, `"`) && strings.HasSuffix(value, `"`)) ||
            (strings.HasPrefix(value, `'`) && strings.HasSuffix(value, `'`)) {
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

    headingRe := regexp.MustCompile(`^#\s+(.+)$`)
    if match := headingRe.FindStringSubmatch(content); match != nil {
        metadata.Name = strings.TrimSpace(match[1])
    }

    paraRe := regexp.MustCompile(`(?m)^#.+\n+([^#\n][^\n]+)`)
    if match := paraRe.FindStringSubmatch(content); match != nil {
        metadata.Description = strings.TrimSpace(match[1])
    }

    return metadata, content
}
```

- [ ] **Step 6: 实现 ValidateMetadata 方法**

```go
func (m *SkillsManager) validateMetadata(metadata SkillMetadata) SkillValidationResult {
    var errors []string
    var warnings []string

    for _, field := range RequiredSkillFields {
        v := reflect.ValueOf(metadata)
        f := v.FieldByName(field)
        if !f.IsValid() || f.String() == "" {
            errors = append(errors, fmt.Sprintf("Missing required field: %s", field))
        }
    }

    return SkillValidationResult{
        Valid:    len(errors) == 0,
        Errors:   errors,
        Warnings: warnings,
    }
}
```

- [ ] **Step 7: 实现 ScanSkillResources 方法（对齐 Chaterm scanSkillResources/scanSkillResourcesRecursive）**

```go
func (m *SkillsManager) scanSkillResources(directory string) ([]SkillResource, error) {
    var resources []SkillResource
    m.scanSkillResourcesRecursive(directory, directory, &resources)
    return resources, nil
}

func (m *SkillsManager) scanSkillResourcesRecursive(rootDir string, currentDir string, resources *[]SkillResource) error {
    entries, err := os.ReadDir(currentDir)
    if err != nil {
        return err
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
    return nil
}
```

- [ ] **Step 8: 实现 Get/Enable/Disable 方法**

```go
func (m *SkillsManager) GetAllSkills() []*Skill {
    m.mu.RLock()
    defer m.mu.RUnlock()
    result := make([]*Skill, 0, len(m.skills))
    for _, skill := range m.skills {
        result = append(result, skill)
    }
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
```

- [ ] **Step 9: 实现 BuildSkillsPrompt 方法（对齐 Chaterm buildSkillsPrompt）**

```go
func (m *SkillsManager) BuildSkillsPrompt() string {
    m.mu.RLock()
    defer m.mu.RUnlock()

    enabledSkills := m.GetEnabledSkills()
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
```

- [ ] **Step 10: 实现 CreateUserSkill / DeleteUserSkill / UpdateUserSkill 方法**

```go
func (m *SkillsManager) CreateUserSkill(metadata SkillMetadata, content string) (*Skill, error) {
    userSkillsPath := filepath.Join(m.configDir, SkillsDirName)
    os.MkdirAll(userSkillsPath, 0755)

    dirName := strings.ToLower(metadata.Name)
    dirName = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(dirName, "-")
    dirName = strings.Trim(dirName, "-")

    skillDir := filepath.Join(userSkillsPath, dirName)
    os.MkdirAll(skillDir, 0755)

    skillContent := m.buildSkillFile(metadata, content)
    skillPath := filepath.Join(skillDir, SkillFileName)
    if err := os.WriteFile(skillPath, []byte(skillContent), 0644); err != nil {
        return nil, fmt.Errorf("failed to write skill file: %w", err)
    }

    m.loadAllSkills()

    skill := m.GetSkill(metadata.Name)
    if skill == nil {
        return nil, fmt.Errorf("failed to create skill")
    }
    return skill, nil
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

func (m *SkillsManager) buildSkillFile(metadata SkillMetadata, content string) string {
    var sb strings.Builder
    sb.WriteString("---\n")
    sb.WriteString(fmt.Sprintf("name: %s\n", metadata.Name))
    sb.WriteString(fmt.Sprintf("description: %s\n", metadata.Description))
    sb.WriteString("---\n\n")
    sb.WriteString(content)
    return sb.String()
}
```

- [ ] **Step 11: 实现 ImportSkillZip 方法**

```go
func (m *SkillsManager) ImportSkillZip(zipPath string, overwrite bool) SkillImportResult {
    r, err := zip.OpenReader(zipPath)
    if err != nil {
        return SkillImportResult{Success: false, Error: "Invalid ZIP file", ErrorCode: SkillImportErrorInvalidZip}
    }
    defer r.Close()

    var skillMdFile *zip.File
    var rootDir string

    for _, f := range r.File {
        base := filepath.Base(f.Name)
        if base == SkillFileName {
            skillMdFile = f
            rootDir = filepath.Dir(f.Name)
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
    defer rc.Close()

    content, err := io.ReadAll(rc)
    if err != nil {
        return SkillImportResult{Success: false, Error: "Failed to read SKILL.md content", ErrorCode: SkillImportErrorExtractFailed}
    }

    metadata, _ := m.parseFrontmatter(string(content))
    validation := m.validateMetadata(metadata)
    if !validation.Valid {
        return SkillImportResult{Success: false, Error: fmt.Sprintf("Invalid metadata: %s", strings.Join(validation.Errors, ", ")), ErrorCode: SkillImportErrorInvalidMetadata}
    }

    userSkillsPath := filepath.Join(m.configDir, SkillsDirName)
    dirName := strings.ToLower(metadata.Name)
    dirName = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(dirName, "-")
    dirName = strings.Trim(dirName, "-")
    targetDir := filepath.Join(userSkillsPath, dirName)

    if dirExists(targetDir) && !overwrite {
        return SkillImportResult{Success: false, Error: "Skill directory already exists", ErrorCode: SkillImportErrorDirExists}
    }

    os.MkdirAll(targetDir, 0755)

    for _, f := range r.File {
        if f.FileInfo().IsDir() {
            continue
        }

        relPath := strings.TrimPrefix(f.Name, rootDir+"/")
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
```

- [ ] **Step 12: 实现 SetupFileWatchers 方法（使用 fsnotify 替代 Chaterm 的 chokidar）**

```go
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

func (m *SkillsManager) Close() {
    if m.watcher != nil {
        m.watcher.Close()
    }
}
```

- [ ] **Step 13: 写测试**

```go
func TestSkillsManager_ParseSkillFile(t *testing.T) {
    tmpDir := t.TempDir()
    skillDir := filepath.Join(tmpDir, "test-skill")
    os.MkdirAll(skillDir, 0755)

    skillContent := "---\nname: test-skill\ndescription: A test skill\n---\n\n## Steps\n1. Do something\n2. Do another thing\n"
    os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(skillContent), 0644)

    mgr := skills.NewSkillsManager(tmpDir, tmpDir)
    result := mgr.ParseSkillFile(filepath.Join(skillDir, "SKILL.md"))

    if !result.Success {
        t.Fatalf("expected success, got error: %s", result.Error)
    }
    if result.Skill.Metadata.Name != "test-skill" {
        t.Fatalf("name mismatch: got %s", result.Skill.Metadata.Name)
    }
    if result.Skill.Metadata.Description != "A test skill" {
        t.Fatalf("description mismatch: got %s", result.Skill.Metadata.Description)
    }
}

func TestSkillsManager_CreateAndDeleteSkill(t *testing.T) {
    tmpDir := t.TempDir()
    mgr := skills.NewSkillsManager(tmpDir, tmpDir)

    metadata := skills.SkillMetadata{
        Name:        "my-skill",
        Description: "My custom skill",
    }
    content := "## Instructions\nDo the thing."

    skill, err := mgr.CreateUserSkill(metadata, content)
    if err != nil {
        t.Fatalf("create failed: %v", err)
    }
    if skill.Metadata.Name != "my-skill" {
        t.Fatalf("name mismatch: got %s", skill.Metadata.Name)
    }

    err = mgr.DeleteUserSkill("my-skill")
    if err != nil {
        t.Fatalf("delete failed: %v", err)
    }
    if mgr.GetSkill("my-skill") != nil {
        t.Fatalf("skill should be deleted")
    }
}

func TestSkillsManager_BuildSkillsPrompt(t *testing.T) {
    tmpDir := t.TempDir()
    mgr := skills.NewSkillsManager(tmpDir, tmpDir)

    metadata := skills.SkillMetadata{Name: "deploy-docker", Description: "Deploy Docker containers"}
    mgr.CreateUserSkill(metadata, "## Steps\n1. Pull image")

    prompt := mgr.BuildSkillsPrompt()
    if !strings.Contains(prompt, "AVAILABLE SKILLS") {
        t.Fatalf("prompt should contain AVAILABLE SKILLS")
    }
    if !strings.Contains(prompt, "deploy-docker") {
        t.Fatalf("prompt should contain skill name")
    }
}
```

- [ ] **Step 14: 跑测试确认通过**

```bash
go test ./pkg/aiusechat/skills/... -v
```

---

## Phase 3: 实现技能状态持久化（对齐 Chaterm skills_state，适配 waveterm 配置体系）

**目标：** 使用 JSON 文件持久化技能启用/禁用状态，对齐 waveterm 现有的配置文件体系（而非 Chaterm 的 SQLite 方案）。

### Task 3: 实现技能状态管理

**Files:**
- Create: `pkg/aiusechat/skills/state.go`
- Test: `pkg/aiusechat/skills/state_test.go`

- [ ] **Step 1: 实现状态文件读写**

```go
const SkillStatesFile = "skills_state.json"

func (m *SkillsManager) loadSkillStates() error {
    statePath := filepath.Join(m.configDir, SkillStatesFile)
    if !fileExists(statePath) {
        return nil
    }

    data, err := os.ReadFile(statePath)
    if err != nil {
        return fmt.Errorf("failed to read skill states: %w", err)
    }

    var states map[string]*SkillState
    if err := json.Unmarshal(data, &states); err != nil {
        return fmt.Errorf("failed to parse skill states: %w", err)
    }

    m.skillStates = states
    return nil
}

func (m *SkillsManager) saveSkillStates() error {
    statePath := filepath.Join(m.configDir, SkillStatesFile)
    data, err := json.MarshalIndent(m.skillStates, "", "  ")
    if err != nil {
        return fmt.Errorf("failed to marshal skill states: %w", err)
    }

    return os.WriteFile(statePath, data, 0644)
}

func (m *SkillsManager) saveSkillState(skillId string, state *SkillState) {
    m.skillStates[skillId] = state
    if err := m.saveSkillStates(); err != nil {
        log.Printf("[SkillsManager] Warning: failed to save skill state: %v", err)
    }
}

func (m *SkillsManager) deleteSkillState(skillId string) {
    delete(m.skillStates, skillId)
    if err := m.saveSkillStates(); err != nil {
        log.Printf("[SkillsManager] Warning: failed to save skill states: %v", err)
    }
}
```

- [ ] **Step 2: 写测试**

```go
func TestSkillsManager_StatePersistence(t *testing.T) {
    tmpDir := t.TempDir()
    mgr := skills.NewSkillsManager(tmpDir, tmpDir)

    metadata := skills.SkillMetadata{Name: "test-skill", Description: "Test"}
    mgr.CreateUserSkill(metadata, "content")

    mgr.SetSkillEnabled("test-skill", false)

    mgr2 := skills.NewSkillsManager(tmpDir, tmpDir)
    mgr2.Initialize()

    skill := mgr2.GetSkill("test-skill")
    if skill == nil {
        t.Fatalf("skill should exist after reload")
    }
    if skill.Enabled {
        t.Fatalf("skill should be disabled after state reload")
    }
}
```

- [ ] **Step 3: 跑测试确认通过**

```bash
go test ./pkg/aiusechat/skills/... -run TestSkillsManager_StatePersistence
```

---

## Phase 4: 实现技能工具（对齐 Chaterm use_skill / summarize_to_skill）

**目标：** 实现 `waveai_use_skill` 和 `waveai_create_skill` 两个 AI 工具，让模型能够按需激活技能和从对话创建技能。

### Task 4: 实现 waveai_use_skill 工具

**Files:**
- Create: `pkg/aiusechat/tools_skills.go`
- Test: `pkg/aiusechat/tools_skills_test.go`

- [ ] **Step 1: 定义 UseSkillInput schema（对齐 Chaterm use_skill 参数）**

```go
type useSkillInput struct {
    Name string `json:"name"`
}
```

- [ ] **Step 2: 实现 GetUseSkillToolDefinition**

```go
func GetUseSkillToolDefinition(chatId string, aiOpts *uctypes.AIOptsType, skillsMgr *skills.SkillsManager) uctypes.ToolDefinition {
    enabledSkills := skillsMgr.GetEnabledSkills()
    var skillDescs []string
    for _, s := range enabledSkills {
        skillDescs = append(skillDescs, fmt.Sprintf("- %s: %s", s.Metadata.Name, s.Metadata.Description))
    }

    description := "Activate a skill by name. Skills are reusable instruction sets that provide specialized knowledge and workflows. When you call this tool, you will receive the skill's full instructions and any associated resource files. Follow these instructions to complete the task."
    if len(skillDescs) > 0 {
        description += "\n\nAvailable skills:\n" + strings.Join(skillDescs, "\n")
    }

    return uctypes.ToolDefinition{
        Name:        "waveai_use_skill",
        DisplayName: "Use Skill",
        Description: description,
        ToolLogName: "wave:useskill",
        Strict:      true,
        InputSchema: map[string]any{
            "type": "object",
            "properties": map[string]any{
                "name": map[string]any{
                    "type":        "string",
                    "description": "The name of the skill to activate, exactly as shown in the available skills list.",
                },
            },
            "required": []string{"name"},
        },
    }
}
```

- [ ] **Step 3: 实现 HandleUseSkillToolCall（对齐 Chaterm handleUseSkillToolUse）**

```go
func HandleUseSkillToolCall(chatId string, input useSkillInput, skillsMgr *skills.SkillsManager) (string, error) {
    if input.Name == "" {
        return "", fmt.Errorf("missing required parameter: name")
    }

    if skillsMgr == nil {
        return "", fmt.Errorf("skills manager is not available")
    }

    skill := skillsMgr.GetSkill(input.Name)
    if skill == nil {
        return "", fmt.Errorf("skill %q not found. Please check the available skills list.", input.Name)
    }

    if !skill.Enabled {
        return "", fmt.Errorf("skill %q is disabled. Please enable it in settings first.", input.Name)
    }

    var sb strings.Builder
    sb.WriteString(fmt.Sprintf("# Skill Activated: %s\n\n", skill.Metadata.Name))
    sb.WriteString(fmt.Sprintf("**Description:** %s\n\n", skill.Metadata.Description))
    sb.WriteString("## Instructions\n\n")
    sb.WriteString(skill.Content)
    sb.WriteString("\n\n")

    if len(skill.Resources) > 0 {
        resourcesWithContent := make([]*SkillResource, 0)
        for i := range skill.Resources {
            if skill.Resources[i].Content != "" {
                resourcesWithContent = append(resourcesWithContent, &skill.Resources[i])
            }
        }
        if len(resourcesWithContent) > 0 {
            sb.WriteString("## Available Resources\n\n")
            sb.WriteString("The following resource files are available for this skill:\n\n")
            for _, res := range resourcesWithContent {
                sb.WriteString(fmt.Sprintf("### %s (%s)\n\n", res.Name, res.Type))
                sb.WriteString("```\n" + res.Content + "\n```\n\n")
            }
        }
    }

    return sb.String(), nil
}
```

### Task 5: 实现 waveai_create_skill 工具

**Files:**
- Modify: `pkg/aiusechat/tools_skills.go`
- Test: `pkg/aiusechat/tools_skills_test.go`

- [ ] **Step 4: 定义 CreateSkillInput schema（对齐 Chaterm summarize_to_skill 参数）**

```go
type createSkillInput struct {
    SkillName   string `json:"skill_name"`
    Description string `json:"description"`
    Content     string `json:"content"`
}
```

- [ ] **Step 5: 实现 GetCreateSkillToolDefinition**

```go
func GetCreateSkillToolDefinition(chatId string, aiOpts *uctypes.AIOptsType, skillsMgr *skills.SkillsManager) uctypes.ToolDefinition {
    return uctypes.ToolDefinition{
        Name:        "waveai_create_skill",
        DisplayName: "Create Skill",
        Description: "Convert the current conversation into a reusable skill. Use this tool when the user explicitly requests to create a skill from the conversation. The skill should capture reusable workflows, instructions, or procedures that can be applied to similar tasks in the future.",
        ToolLogName: "wave:createskill",
        Strict:      true,
        InputSchema: map[string]any{
            "type": "object",
            "properties": map[string]any{
                "skill_name": map[string]any{
                    "type":        "string",
                    "description": "A lowercase-with-hyphens identifier for the skill (e.g., 'deploy-docker-app', 'setup-nginx-ssl'). Should be concise and descriptive.",
                },
                "description": map[string]any{
                    "type":        "string",
                    "description": "A one-line description of what the skill does and when to use it.",
                },
                "content": map[string]any{
                    "type":        "string",
                    "description": "The skill instructions in Markdown format. Should be well-structured with clear steps and include any relevant commands, configurations, or code patterns.",
                },
            },
            "required": []string{"skill_name", "description", "content"},
        },
    }
}
```

- [ ] **Step 6: 实现 HandleCreateSkillToolCall**

```go
func HandleCreateSkillToolCall(chatId string, input createSkillInput, skillsMgr *skills.SkillsManager) (string, error) {
    if input.SkillName == "" {
        return "", fmt.Errorf("missing required parameter: skill_name")
    }
    if input.Description == "" {
        return "", fmt.Errorf("missing required parameter: description")
    }
    if input.Content == "" {
        return "", fmt.Errorf("missing required parameter: content")
    }

    if skillsMgr == nil {
        return "", fmt.Errorf("skills manager is not available")
    }

    metadata := skills.SkillMetadata{
        Name:        input.SkillName,
        Description: input.Description,
    }

    skill, err := skillsMgr.CreateUserSkill(metadata, input.Content)
    if err != nil {
        return "", fmt.Errorf("failed to create skill: %w", err)
    }

    return fmt.Sprintf("Skill %q created successfully at %s. It is now available in the skills list and can be activated using the waveai_use_skill tool.", skill.Metadata.Name, skill.Path), nil
}
```

- [ ] **Step 7: 注册工具到 usechat.go**

在 `pkg/aiusechat/tools.go` 的工具注册函数中添加：

```go
if skillsMgr != nil && len(skillsMgr.GetEnabledSkills()) > 0 {
    toolDefs = append(toolDefs, GetUseSkillToolDefinition(chatId, aiOpts, skillsMgr))
    toolDefs = append(toolDefs, GetCreateSkillToolDefinition(chatId, aiOpts, skillsMgr))
}
```

在 `pkg/aiusechat/usechat.go` 的 `processAllToolCalls` 中添加分发：

```go
case "waveai_use_skill":
    var input useSkillInput
    json.Unmarshal(toolCall.Input, &input)
    result, err := HandleUseSkillToolCall(chatId, input, c.SkillsMgr)
    // handle result...

case "waveai_create_skill":
    var input createSkillInput
    json.Unmarshal(toolCall.Input, &input)
    result, err := HandleCreateSkillToolCall(chatId, input, c.SkillsMgr)
    // handle result...
```

- [ ] **Step 8: 注入系统提示**

在 `pkg/aiusechat/usechat-prompts.go` 的系统提示构建中添加：

```go
if skillsMgr != nil {
    skillsPrompt := skillsMgr.BuildSkillsPrompt()
    if skillsPrompt != "" {
        systemPrompt += skillsPrompt
    }
}
```

- [ ] **Step 9: 写测试**

```go
func TestHandleUseSkillToolCall(t *testing.T) {
    tmpDir := t.TempDir()
    mgr := skills.NewSkillsManager(tmpDir, tmpDir)
    mgr.CreateUserSkill(skills.SkillMetadata{
        Name:        "deploy-docker",
        Description: "Deploy Docker containers",
    }, "## Steps\n1. Pull image\n2. Run container")

    result, err := HandleUseSkillToolCall("chat-1", useSkillInput{Name: "deploy-docker"}, mgr)
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if !strings.Contains(result, "Skill Activated: deploy-docker") {
        t.Fatalf("result should contain skill activation header")
    }
    if !strings.Contains(result, "Pull image") {
        t.Fatalf("result should contain skill content")
    }
}

func TestHandleUseSkillToolCall_Disabled(t *testing.T) {
    tmpDir := t.TempDir()
    mgr := skills.NewSkillsManager(tmpDir, tmpDir)
    mgr.CreateUserSkill(skills.SkillMetadata{
        Name:        "deploy-docker",
        Description: "Deploy Docker containers",
    }, "content")

    mgr.SetSkillEnabled("deploy-docker", false)

    _, err := HandleUseSkillToolCall("chat-1", useSkillInput{Name: "deploy-docker"}, mgr)
    if err == nil {
        t.Fatalf("expected error for disabled skill")
    }
}

func TestHandleCreateSkillToolCall(t *testing.T) {
    tmpDir := t.TempDir()
    mgr := skills.NewSkillsManager(tmpDir, tmpDir)

    result, err := HandleCreateSkillToolCall("chat-1", createSkillInput{
        SkillName:   "setup-nginx",
        Description: "Setup Nginx with SSL",
        Content:     "## Steps\n1. Install nginx\n2. Configure SSL",
    }, mgr)
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if !strings.Contains(result, "setup-nginx") {
        t.Fatalf("result should contain skill name")
    }

    skill := mgr.GetSkill("setup-nginx")
    if skill == nil {
        t.Fatalf("skill should exist after creation")
    }
}
```

- [ ] **Step 10: 跑测试确认通过**

```bash
go test ./pkg/aiusechat/... -run TestHandleUseSkill -v
go test ./pkg/aiusechat/... -run TestHandleCreateSkill -v
```

---

## Phase 5: 集成到 waveterm 设置系统

**目标：** 将 Skills 模块集成到 waveterm 的配置系统中，添加设置字段、JSON Schema、默认配置。

### Task 6: 扩展设置配置

**Files:**
- Modify: `pkg/wconfig/settingsconfig.go`
- Modify: `pkg/wconfig/defaultconfig/settings.json`
- Modify: `schema/settings.json`

- [ ] **Step 1: 在 SettingsType 中添加 Skills 设置字段**

```go
type SettingsType struct {
    // ... existing fields ...

    SkillsEnabled bool   `json:"skills:enabled,omitempty"`
    SkillsDir     string `json:"skills:dir,omitempty"`
}
```

- [ ] **Step 2: 在默认配置中添加 Skills 设置**

`pkg/wconfig/defaultconfig/settings.json` 新增：

```json
{
    "skills:enabled": true
}
```

- [ ] **Step 3: 在 JSON Schema 中添加 Skills 字段**

`schema/settings.json` 新增：

```json
{
    "skills:enabled": {
        "type": "boolean",
        "description": "Enable or disable the AI skills system"
    },
    "skills:dir": {
        "type": "string",
        "description": "Custom directory for user skills (default: ~/.config/waveterm/skills)"
    }
}
```

- [ ] **Step 4: 在 FullConfigType 中添加 Skills 配置**

```go
type FullConfigType struct {
    // ... existing fields ...
    Skills map[string]SkillConfigType `json:"skills,omitempty"`
}

type SkillConfigType struct {
    Enabled  bool   `json:"enabled,omitempty"`
    Name     string `json:"name,omitempty"`
    FilePath string `json:"filepath,omitempty"`
}
```

---

## Phase 6: 实现前端 Skills 设置面板（对齐 Chaterm skills.vue）

**目标：** 在 waveterm 设置面板中添加 Skills 可视化管理界面，对齐 Chaterm 的 `skills.vue` 功能。

### Task 7: 实现 SkillsVisualContent 组件

**Files:**
- Create: `frontend/app/view/waveconfig/skillsvisualcontent.tsx`
- Modify: `frontend/app/view/waveconfig/waveconfig-model.ts`

- [ ] **Step 1: 在 waveconfig-model.ts 中添加 Skills 配置条目**

```typescript
const configFiles: ConfigFile[] = [
    // ... existing entries ...
    {
        name: "AI Skills",
        path: "skills_state.json",
        language: "json",
        description: "Manage AI skill modules",
        docsUrl: "https://docs.waveterm.dev/skills",
        hasJsonView: true,
        visualComponent: SkillsVisualContent,
    },
]
```

- [ ] **Step 2: 实现 SkillsVisualContent 组件（对齐 Chaterm skills.vue）**

核心功能：
1. **技能列表**：展示所有已加载技能（名称、描述、启用/禁用开关）
2. **创建技能弹窗**：名称、描述、内容输入
3. **编辑技能弹窗**：描述、内容编辑（仅用户技能可编辑）
4. **删除技能**：确认弹窗（仅用户技能可删除）
5. **打开技能文件夹**：调用系统文件管理器
6. **刷新技能列表**：重新加载
7. **ZIP 导入技能**：文件选择 → 解压导入
8. **空状态提示**：无技能时显示引导

UI 布局（对齐 Chaterm skills.vue）：
- 顶部：标题 + 操作按钮（打开文件夹、刷新、导入、创建）
- 主体：技能卡片列表，每个卡片包含图标、名称、描述、开关、编辑/删除按钮
- 禁用技能半透明显示
- 内置技能不可删除/编辑

- [ ] **Step 3: 实现 RPC 通信**

新增 RPC 命令：
- `GetSkills` → 获取所有技能列表
- `SetSkillEnabled` → 启用/禁用技能
- `CreateSkill` → 创建用户技能
- `DeleteSkill` → 删除用户技能
- `UpdateSkill` → 更新用户技能
- `ImportSkillZip` → ZIP 导入技能
- `OpenSkillsFolder` → 打开技能文件夹
- `ReloadSkills` → 重新加载技能
- `GetSkillsUserPath` → 获取用户技能目录路径
- `ReadSkillContent` → 读取技能完整内容

---

## Phase 7: 创建内置示例技能

**目标：** 提供开箱即用的内置技能，展示 Skills 系统的能力。

### Task 8: 创建内置技能文件

**Files:**
- Create: `pkg/wconfig/defaultconfig/skills/deploy-docker/SKILL.md`
- Create: `pkg/wconfig/defaultconfig/skills/setup-nginx/SKILL.md`
- Create: `pkg/wconfig/defaultconfig/skills/troubleshoot-network/SKILL.md`

- [ ] **Step 1: 创建 deploy-docker 技能**

```markdown
---
name: deploy-docker
description: Deploy Docker containers with best practices, including image management, networking, and volume configuration
---

## Overview

This skill guides you through deploying Docker containers with production-ready configurations.

## Steps

1. **Pull the Docker image**
   ```bash
   docker pull <image-name>:<tag>
   ```

2. **Create a Docker network** (if needed)
   ```bash
   docker network create <network-name>
   ```

3. **Run the container**
   ```bash
   docker run -d \
     --name <container-name> \
     --network <network-name> \
     -p <host-port>:<container-port> \
     -v <host-path>:<container-path> \
     --restart unless-stopped \
     <image-name>:<tag>
   ```

4. **Verify the deployment**
   ```bash
   docker ps
   docker logs <container-name>
   ```

## Best Practices

- Always use specific tags instead of `latest`
- Set `--restart unless-stopped` for production
- Use named volumes for persistent data
- Limit container resources with `--memory` and `--cpus`
```

- [ ] **Step 2: 创建 setup-nginx 技能**

```markdown
---
name: setup-nginx
description: Setup and configure Nginx as a reverse proxy or web server with SSL support
---

## Overview

This skill helps you set up Nginx with common configurations including reverse proxy, SSL, and load balancing.

## Steps

1. **Install Nginx**
   ```bash
   sudo apt update && sudo apt install nginx
   ```

2. **Create a server block configuration**
   ```nginx
   server {
       listen 80;
       server_name example.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

3. **Enable the site**
   ```bash
   sudo ln -s /etc/nginx/sites-available/example.com /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

4. **Setup SSL with Let's Encrypt** (optional)
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d example.com
   ```
```

- [ ] **Step 3: 创建 troubleshoot-network 技能**

```markdown
---
name: troubleshoot-network
description: Diagnose and troubleshoot network connectivity issues using common Linux networking tools
---

## Overview

This skill provides a systematic approach to diagnosing network issues.

## Diagnostic Steps

1. **Check interface status**
   ```bash
   ip addr show
   ip link show
   ```

2. **Test local connectivity**
   ```bash
   ping -c 4 127.0.0.1
   ping -c 4 <gateway-ip>
   ```

3. **Test DNS resolution**
   ```bash
   nslookup example.com
   dig example.com
   ```

4. **Trace route**
   ```bash
   traceroute example.com
   ```

5. **Check listening ports**
   ```bash
   ss -tlnp
   netstat -tlnp
   ```

6. **Check firewall rules**
   ```bash
   sudo iptables -L -n
   sudo ufw status
   ```

7. **Check routing table**
   ```bash
   ip route show
   ```
```

---

## Phase 8: 实现 RPC 命令和前后端通信

**目标：** 实现前后端通信层，让前端设置面板能够调用后端 SkillsManager 的方法。

### Task 9: 添加 Skills RPC 命令

**Files:**
- Modify: `pkg/wshrpc/wshrpc.go`
- Modify: `pkg/wshutil/wshrouter_controlimpl.go`

- [ ] **Step 1: 定义 RPC 命令类型**

```go
const Command_GetSkills = "getSkills"
const Command_SetSkillEnabled = "setSkillEnabled"
const Command_CreateSkill = "createSkill"
const Command_DeleteSkill = "deleteSkill"
const Command_UpdateSkill = "updateSkill"
const Command_ImportSkillZip = "importSkillZip"
const Command_OpenSkillsFolder = "openSkillsFolder"
const Command_ReloadSkills = "reloadSkills"
const Command_GetSkillsUserPath = "getSkillsUserPath"
const Command_ReadSkillContent = "readSkillContent"

type GetSkillsCommandType struct {
    // no params
}

type SetSkillEnabledCommandType struct {
    Name    string `json:"name"`
    Enabled bool   `json:"enabled"`
}

type CreateSkillCommandType struct {
    Name        string `json:"name"`
    Description string `json:"description"`
    Content     string `json:"content"`
}

type DeleteSkillCommandType struct {
    Name string `json:"name"`
}

type UpdateSkillCommandType struct {
    Name        string `json:"name"`
    Description string `json:"description"`
    Content     string `json:"content"`
}

type ImportSkillZipCommandType struct {
    ZipPath   string `json:"zipPath"`
    Overwrite bool   `json:"overwrite,omitempty"`
}

type ReadSkillContentCommandType struct {
    Name string `json:"name"`
}
```

- [ ] **Step 2: 实现 RPC 命令处理**

在 `wshrouter_controlimpl.go` 中添加命令处理函数，调用 `SkillsManager` 的对应方法。

- [ ] **Step 3: 前端添加 RPC 调用**

在 `frontend/app/store/wshclientapi.ts` 中添加对应的 RPC API 调用方法。

---

## 实施优先级和依赖关系

```
Phase 1 (数据模型) ─── 无依赖，可立即开始
    │
    ├── Phase 2 (SkillsManager) ─── 依赖 Phase 1
    │       │
    │       ├── Phase 3 (状态持久化) ─── 依赖 Phase 2
    │       │
    │       └── Phase 4 (技能工具) ─── 依赖 Phase 2 + Phase 3
    │               │
    │               └── Phase 5 (设置集成) ─── 依赖 Phase 4
    │                       │
    │                       └── Phase 6 (前端面板) ─── 依赖 Phase 5 + Phase 8
    │
    ├── Phase 7 (内置技能) ─── 依赖 Phase 2
    │
    └── Phase 8 (RPC 通信) ─── 依赖 Phase 2 + Phase 5
```

**推荐实施顺序：**
1. Phase 1 → Phase 2 → Phase 3（后端核心，可独立测试）
2. Phase 4（AI 工具，让模型能用技能）
3. Phase 7（内置技能，提供开箱即用体验）
4. Phase 5 + Phase 8（设置集成 + RPC 通信）
5. Phase 6（前端面板，最后实现）

---

## 与 Chaterm 的关键差异说明

| 方面 | Chaterm | waveterm | 原因 |
|------|---------|----------|------|
| 状态持久化 | SQLite `skills_state` 表 | JSON 文件 `skills_state.json` | waveterm 使用 JSON 配置体系，不使用 SQLite |
| 文件监听 | chokidar (Node.js) | fsnotify (Go) | 语言差异 |
| ZIP 导入 | adm-zip (Node.js) | archive/zip (Go 标准库) | 语言差异 |
| 前端框架 | Vue + Ant Design Vue | React + Jotai + 自定义组件 | waveterm 使用 React 技术栈 |
| 工具参数格式 | XML 格式 (`<use_skill><name>...</name></use_skill>`) | JSON Schema 格式 (`{"name": "..."}`) | waveterm 使用 OpenAI 兼容的工具调用格式 |
| 工具命名 | `use_skill` / `summarize_to_skill` | `waveai_use_skill` / `waveai_create_skill` | 遵循 waveterm 工具命名规范 (`waveai_` 前缀) |
| 技能目录 | builtin + user + marketplace | builtin + user | 初期不实现 marketplace |
| 数据库迁移 | `add-skills-support.ts` 迁移脚本 | 无需迁移 | JSON 文件方案无需数据库迁移 |
| 技能 Chip 激活 | 前端 Chip 选择器 | Phase 6 后续实现 | 初期先通过工具调用激活 |
