package build

import (
	"fmt"
	"strings"
	"time"
)

const MinSupportedGoMinorVersion = 22
const DefaultTsunamiSdkVersion = "0.12.3"

type CheckGoVersionResult struct {
	GoVersion  string
	IsOK       bool
	GoStatus   string
	GoPath     string
	ErrorString string
}

type BuildOpts struct {
	AppPath          string
	SdkReplacePath   string
	SdkVersion       string
	GoPath           string
	OutputCapture    *OutputCapture
	NoBuild          bool
	SkipVersionCheck bool
	AppNS            string
	Verbose          bool
	Open             bool
	KeepTemp         bool
	OutputFile       string
	ScaffoldPath     string
	NodePath         string
	MoveFileBack     bool
}

type OutputCapture struct {
	lines []string
}

func MakeOutputCapture() *OutputCapture {
	return &OutputCapture{}
}

func (oc *OutputCapture) GetLines() []string {
	return oc.lines
}

func (oc *OutputCapture) Write(p []byte) (n int, err error) {
	line := string(p)
	oc.lines = append(oc.lines, line)
	return len(p), nil
}

func CheckGoVersion(goPath string) CheckGoVersionResult {
	return CheckGoVersionResult{GoVersion: "go1.22", IsOK: true}
}

func FindGoExecutable() (string, error) {
	return "", fmt.Errorf("stub: tsunami build not available")
}

func GetAppName(appPath string) string {
	return ""
}

func GetAppModTime(appPath string) (string, error) {
	return "", fmt.Errorf("stub: tsunami build not available")
}

func GetTsunamiScaffoldPath() string {
	return ""
}

func TsunamiBuild(opts BuildOpts) error {
	return fmt.Errorf("stub: tsunami build not available")
}

func TsunamiBuildInternal(opts BuildOpts) (string, error) {
	return "", fmt.Errorf("stub: tsunami build not available")
}

func ParseTsunamiPort(line string) int {
	return 0
}

func cacheModTime(modTime string) time.Time {
	t, _ := time.Parse(time.RFC3339, modTime)
	return t
}

func FindMainAppFile(appPath string) (string, error) {
	return "", fmt.Errorf("stub: tsunami build not available")
}

func GetTsunamiUIImportPath() string {
	return "github.com/wavetermdev/waveterm/tsunami/frontend"
}

func IsBuildableApp(appPath string) bool {
	return false
}

func ParseBuildOutput(output string) []string {
	return strings.Split(output, "\n")
}
