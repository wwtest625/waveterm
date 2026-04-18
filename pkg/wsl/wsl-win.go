//go:build windows

package wsl

import (
	"context"
	"fmt"
	"io"
	"os"
	"sync"
)

type WslName struct {
	Distro string `json:"distro"`
}

type Distro struct {
	Name_ string
}

type WslCmd struct {
	wg      *sync.WaitGroup
	waitErr error
}

func (d *Distro) Name() string {
	return d.Name_
}

func (d *Distro) WslCommand(ctx context.Context, cmd string) *WslCmd {
	return &WslCmd{wg: &sync.WaitGroup{}, waitErr: fmt.Errorf("wsl stub: not available")}
}

func (c *WslCmd) CombinedOutput() (out []byte, err error) {
	return nil, fmt.Errorf("wsl stub: not available")
}
func (c *WslCmd) Output() (out []byte, err error) {
	return nil, fmt.Errorf("wsl stub: not available")
}
func (c *WslCmd) Run() error {
	return fmt.Errorf("wsl stub: not available")
}
func (c *WslCmd) Start() (err error) {
	return fmt.Errorf("wsl stub: not available")
}
func (c *WslCmd) StderrPipe() (r io.ReadCloser, err error) {
	return nil, fmt.Errorf("wsl stub: not available")
}
func (c *WslCmd) StdinPipe() (w io.WriteCloser, err error) {
	return nil, fmt.Errorf("wsl stub: not available")
}
func (c *WslCmd) StdoutPipe() (r io.ReadCloser, err error) {
	return nil, fmt.Errorf("wsl stub: not available")
}
func (c *WslCmd) Wait() (err error) {
	return c.waitErr
}
func (c *WslCmd) ExitCode() int {
	return -1
}
func (c *WslCmd) ExitSignal() string {
	return ""
}
func (c *WslCmd) GetProcess() *os.Process {
	return nil
}
func (c *WslCmd) GetProcessState() *os.ProcessState {
	return nil
}
func (c *WslCmd) SetStdin(stdin io.Reader) {}
func (c *WslCmd) SetStdout(stdout io.Writer) {}
func (c *WslCmd) SetStderr(stderr io.Writer) {}

func RegisteredDistros(ctx context.Context) ([]Distro, error) {
	return nil, fmt.Errorf("wsl stub: not available")
}

func DefaultDistro(ctx context.Context) (Distro, bool, error) {
	return Distro{}, false, fmt.Errorf("wsl stub: not available")
}

func GetDistroCmd(ctx context.Context, wslDistroName string, cmd string) (*WslCmd, error) {
	return nil, fmt.Errorf("wsl stub: not available")
}

func GetDistro(ctx context.Context, wslDistroName WslName) (*Distro, error) {
	return nil, fmt.Errorf("wsl stub: not available")
}
