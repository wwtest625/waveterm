// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type ipAddrInfo struct {
	Family    string `json:"family"`
	Local     string `json:"local"`
	PrefixLen int    `json:"prefixlen"`
}

type ipInterfaceInfo struct {
	IfName    string       `json:"ifname"`
	Flags     []string     `json:"flags"`
	OperState string       `json:"operstate"`
	Address   string       `json:"address"`
	Mtu       int          `json:"mtu"`
	AltNames  []string     `json:"altnames"`
	AddrInfo  []ipAddrInfo `json:"addr_info"`
}

type ipRouteInfo struct {
	Dst     string `json:"dst"`
	Dev     string `json:"dev"`
	Gateway string `json:"gateway"`
}

type ethtoolInfo struct {
	Driver          string
	FirmwareVersion string
	BusInfo         string
	Speed           string
	PortType        string
	LinkDetected    string
}

func (ws *WshServer) NetworkListCommand(ctx context.Context, data wshrpc.NetworkListRequest) (wshrpc.NetworkListResponse, error) {
	addrStdout, addrStderr, err := runCLI(ctx, data.Connection, "ip", []string{"-j", "addr", "show"})
	if err != nil {
		return wshrpc.NetworkListResponse{
			Interfaces: []wshrpc.NetworkInterfaceSummary{},
			DnsServers: []string{},
			Error:      makeNetworkError(err, addrStdout, addrStderr),
		}, nil
	}

	var interfacesRaw []ipInterfaceInfo
	if parseErr := json.Unmarshal([]byte(addrStdout), &interfacesRaw); parseErr != nil {
		return wshrpc.NetworkListResponse{
			Interfaces: []wshrpc.NetworkInterfaceSummary{},
			DnsServers: []string{},
			Error: &wshrpc.NetworkError{
				Code:    "unknown",
				Message: "Unable to parse network interface list.",
				Detail:  parseErr.Error(),
			},
		}, nil
	}

	defaultRouteInterface := ""
	defaultGateway := ""
	routeStdout, routeStderr, routeErr := runCLI(ctx, data.Connection, "ip", []string{"-j", "route", "show", "default"})
	if routeErr == nil {
		defaultRouteInterface, defaultGateway = parseDefaultRoute(routeStdout)
	} else if makeNetworkError(routeErr, routeStdout, routeStderr).Code == "missing_cli" {
		return wshrpc.NetworkListResponse{
			Interfaces: []wshrpc.NetworkInterfaceSummary{},
			DnsServers: []string{},
			Error:      makeNetworkError(routeErr, routeStdout, routeStderr),
		}, nil
	}

	dnsServers := []string{}
	dnsStdout, _, dnsErr := runCLI(ctx, data.Connection, "cat", []string{"/etc/resolv.conf"})
	if dnsErr == nil {
		dnsServers = parseResolvConf(dnsStdout)
	}

	interfaces := make([]wshrpc.NetworkInterfaceSummary, 0, len(interfacesRaw))
	for _, iface := range interfacesRaw {
		ipv4, ipv6 := pickPrimaryIPs(iface.AddrInfo)
		ifaceGateway := ""
		if iface.IfName == defaultRouteInterface {
			ifaceGateway = defaultGateway
		}
		ethInfo := readEthtoolInfo(ctx, data.Connection, iface.IfName)
		displayName, vendor, product, kindDescription, deviceClass := describeInterface(iface.IfName, guessInterfaceType(iface.IfName), ethInfo)
		interfaces = append(interfaces, wshrpc.NetworkInterfaceSummary{
			Name:            iface.IfName,
			DisplayName:     displayName,
			NameExplanation: explainInterfaceName(iface.IfName),
			AltNames:        iface.AltNames,
			Type:            guessInterfaceType(iface.IfName),
			Status:          normalizeInterfaceStatus(iface.Flags, iface.OperState),
			Ipv4:            ipv4,
			Ipv4Cidr:        joinIPv4Cidr(ipv4, iface.AddrInfo),
			Ipv6:            ipv6,
			Mac:             strings.TrimSpace(iface.Address),
			Mtu:             iface.Mtu,
			DefaultGateway:  ifaceGateway,
			Driver:          ethInfo.Driver,
			FirmwareVersion: ethInfo.FirmwareVersion,
			BusInfo:         ethInfo.BusInfo,
			Vendor:          vendor,
			Product:         product,
			KindDescription: kindDescription,
			DeviceClass:     deviceClass,
			CanRestart:      iface.IfName != "lo",
			CanEditMtu:      iface.IfName != "lo",
		})
	}

	return wshrpc.NetworkListResponse{
		Interfaces:            interfaces,
		DefaultRouteInterface: defaultRouteInterface,
		DefaultGateway:        defaultGateway,
		DnsServers:            dnsServers,
	}, nil
}

func (ws *WshServer) NetworkActionCommand(ctx context.Context, data wshrpc.NetworkActionRequest) (wshrpc.NetworkActionResponse, error) {
	name := strings.TrimSpace(data.Name)
	if name == "" {
		return wshrpc.NetworkActionResponse{
			Error: &wshrpc.NetworkError{Code: "invalid_request", Message: "Interface name is required."},
		}, nil
	}
	var actions [][]string
	switch data.Action {
	case "restart":
		actions = [][]string{
			{"link", "set", "dev", name, "down"},
			{"link", "set", "dev", name, "up"},
		}
	case "down":
		actions = [][]string{{"link", "set", "dev", name, "down"}}
	case "up":
		actions = [][]string{{"link", "set", "dev", name, "up"}}
	case "set_mtu":
		if data.Mtu <= 0 {
			return wshrpc.NetworkActionResponse{
				Error: &wshrpc.NetworkError{Code: "invalid_request", Message: "MTU must be greater than zero."},
			}, nil
		}
		actions = [][]string{{"link", "set", "dev", name, "mtu", strconv.Itoa(data.Mtu)}}
	default:
		return wshrpc.NetworkActionResponse{
			Error: &wshrpc.NetworkError{
				Code:    "invalid_request",
				Message: fmt.Sprintf("Unsupported network action %q.", data.Action),
			},
		}, nil
	}

	for _, args := range actions {
		stdout, stderr, err := runCLI(ctx, data.Connection, "ip", args)
		if err != nil {
			return wshrpc.NetworkActionResponse{Error: makeNetworkActionError(err, stdout, stderr)}, nil
		}
	}
	return wshrpc.NetworkActionResponse{}, nil
}

func (ws *WshServer) NetworkConfigureCommand(ctx context.Context, data wshrpc.NetworkConfigureRequest) (wshrpc.NetworkConfigureResponse, error) {
	name := strings.TrimSpace(data.Name)
	if name == "" {
		return wshrpc.NetworkConfigureResponse{
			Error: &wshrpc.NetworkError{Code: "invalid_request", Message: "Interface name is required."},
		}, nil
	}
	ipv4Cidr := strings.TrimSpace(data.Ipv4Cidr)
	gateway := strings.TrimSpace(data.Gateway)
	dnsServers := compactStrings(data.DnsServers)
	if ipv4Cidr == "" && gateway == "" && len(dnsServers) == 0 {
		return wshrpc.NetworkConfigureResponse{
			Error: &wshrpc.NetworkError{Code: "invalid_request", Message: "No network changes were provided."},
		}, nil
	}
	if ipv4Cidr != "" {
		stdout, stderr, err := runCLI(ctx, data.Connection, "ip", []string{"addr", "replace", ipv4Cidr, "dev", name})
		if err != nil {
			return wshrpc.NetworkConfigureResponse{Error: makeNetworkActionError(err, stdout, stderr)}, nil
		}
	}
	if gateway != "" {
		stdout, stderr, err := runCLI(ctx, data.Connection, "ip", []string{"route", "replace", "default", "via", gateway, "dev", name})
		if err != nil {
			return wshrpc.NetworkConfigureResponse{Error: makeNetworkActionError(err, stdout, stderr)}, nil
		}
	}
	if len(dnsServers) > 0 {
		args := append([]string{"dns", name}, dnsServers...)
		stdout, stderr, err := runCLI(ctx, data.Connection, "resolvectl", args)
		if err != nil {
			return wshrpc.NetworkConfigureResponse{Error: makeNetworkConfigureError(err, stdout, stderr)}, nil
		}
	}
	return wshrpc.NetworkConfigureResponse{}, nil
}

func parseDefaultRoute(output string) (string, string) {
	var routes []ipRouteInfo
	if err := json.Unmarshal([]byte(output), &routes); err != nil {
		return "", ""
	}
	for _, route := range routes {
		if route.Dst == "default" || route.Dst == "" {
			return strings.TrimSpace(route.Dev), strings.TrimSpace(route.Gateway)
		}
	}
	return "", ""
}

func parseResolvConf(content string) []string {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	servers := make([]string, 0)
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, ";") {
			continue
		}
		fields := strings.Fields(trimmed)
		if len(fields) >= 2 && fields[0] == "nameserver" {
			servers = append(servers, fields[1])
		}
	}
	return servers
}

func pickPrimaryIPs(addrInfos []ipAddrInfo) (string, string) {
	var ipv4 string
	var ipv6 string
	for _, addr := range addrInfos {
		if ipv4 == "" && addr.Family == "inet" {
			ipv4 = strings.TrimSpace(addr.Local)
			continue
		}
		if ipv6 == "" && addr.Family == "inet6" {
			ipv6 = strings.TrimSpace(addr.Local)
		}
	}
	return ipv4, ipv6
}

func joinIPv4Cidr(ipv4 string, addrInfos []ipAddrInfo) string {
	if ipv4 == "" {
		return ""
	}
	for _, addr := range addrInfos {
		if addr.Family == "inet" && strings.TrimSpace(addr.Local) == ipv4 && addr.PrefixLen > 0 {
			return fmt.Sprintf("%s/%d", ipv4, addr.PrefixLen)
		}
	}
	return ipv4
}

func guessInterfaceType(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	switch {
	case strings.HasPrefix(lower, "wl"), strings.HasPrefix(lower, "wifi"):
		return "wireless"
	case lower == "lo",
		strings.HasPrefix(lower, "docker"),
		strings.HasPrefix(lower, "br-"),
		strings.HasPrefix(lower, "veth"),
		strings.HasPrefix(lower, "tun"),
		strings.HasPrefix(lower, "tap"),
		strings.HasPrefix(lower, "virbr"),
		strings.HasPrefix(lower, "vmnet"),
		strings.HasPrefix(lower, "tailscale"),
		strings.HasPrefix(lower, "zt"),
		strings.HasPrefix(lower, "wg"),
		strings.HasPrefix(lower, "podman"):
		return "virtual"
	case strings.HasPrefix(lower, "en"), strings.HasPrefix(lower, "eth"), strings.HasPrefix(lower, "ib"):
		return "wired"
	default:
		return "unknown"
	}
}

func normalizeInterfaceStatus(flags []string, operState string) string {
	adminUp := false
	for _, flag := range flags {
		if strings.EqualFold(strings.TrimSpace(flag), "up") {
			adminUp = true
			break
		}
	}
	if !adminUp {
		return "disabled"
	}
	switch strings.ToUpper(strings.TrimSpace(operState)) {
	case "UP", "UNKNOWN":
		return "up"
	default:
		return "down"
	}
}

func readEthtoolInfo(ctx context.Context, connName string, ifaceName string) ethtoolInfo {
	ethtoolCtx, cancel := context.WithTimeout(ctx, 1200*time.Millisecond)
	defer cancel()
	stdout, _, err := runCLI(ethtoolCtx, connName, "ethtool", []string{"-i", ifaceName})
	if err != nil {
		return ethtoolInfo{}
	}
	info := ethtoolInfo{}
	lines := strings.Split(strings.ReplaceAll(stdout, "\r\n", "\n"), "\n")
	for _, line := range lines {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(parts[0]))
		value := strings.TrimSpace(parts[1])
		switch key {
		case "driver":
			info.Driver = value
		case "firmware-version":
			info.FirmwareVersion = value
		case "bus-info":
			info.BusInfo = value
		case "speed":
			info.Speed = value
		case "port":
			info.PortType = value
		case "link detected":
			info.LinkDetected = value
		}
	}
	return info
}

func compactStrings(values []string) []string {
	rtn := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		rtn = append(rtn, trimmed)
	}
	return rtn
}

func describeInterface(name string, ifaceType string, ethInfo ethtoolInfo) (string, string, string, string, string) {
	lowerName := strings.ToLower(strings.TrimSpace(name))
	lowerDriver := strings.ToLower(strings.TrimSpace(ethInfo.Driver))

	if strings.HasPrefix(lowerName, "mlx5_") {
		return name, "NVIDIA", "Mellanox mlx5", "这是 NVIDIA Mellanox 的 RDMA 设备名，不是普通以太网口名称。", "RDMA"
	}
	if strings.Contains(lowerDriver, "mlx5") {
		return "NVIDIA ConnectX", "NVIDIA", "ConnectX / mlx5", "这是 NVIDIA Mellanox 网卡，Linux 驱动是 mlx5_core。", "Ethernet + RDMA"
	}
	switch ifaceType {
	case "wired":
		return name, "", "Ethernet", "有线网卡", "Ethernet"
	case "wireless":
		return name, "", "Wi-Fi", "无线网卡", "Wireless"
	case "virtual":
		return name, "", "Virtual Interface", "虚拟网络接口", "Virtual"
	default:
		return name, "", "", "系统接口", "System"
	}
}

func explainInterfaceName(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	if strings.HasPrefix(lower, "ens") && strings.Contains(lower, "np") {
		return "这类名字通常表示以太网接口，s 后面的数字对应槽位，np 后面的数字对应网卡端口号。"
	}
	if strings.HasPrefix(lower, "enp") {
		return "这类名字通常表示以太网接口，p 后面的数字一般对应 PCI 总线位置。"
	}
	if strings.HasPrefix(lower, "mlx5_") {
		return "这不是普通网口名，而是 NVIDIA Mellanox RDMA 设备名。"
	}
	return ""
}

func makeNetworkError(err error, stdout string, stderr string) *wshrpc.NetworkError {
	detail := strings.TrimSpace(stderr)
	if detail == "" {
		detail = strings.TrimSpace(stdout)
	}
	if detail == "" && err != nil {
		detail = err.Error()
	}
	lowerDetail := strings.ToLower(detail)
	switch {
	case errors.Is(err, exec.ErrNotFound),
		strings.Contains(lowerDetail, "executable file not found"),
		strings.Contains(lowerDetail, "ip: command not found"),
		strings.Contains(lowerDetail, "'ip' is not recognized"),
		strings.Contains(lowerDetail, "cat: command not found"),
		strings.Contains(lowerDetail, "'cat' is not recognized"):
		return &wshrpc.NetworkError{
			Code:    "missing_cli",
			Message: "Network commands are not available on this connection.",
			Detail:  detail,
		}
	case strings.Contains(lowerDetail, "connection") &&
		(strings.Contains(lowerDetail, "not found") || strings.Contains(lowerDetail, "unavailable")):
		return &wshrpc.NetworkError{
			Code:    "connection_unavailable",
			Message: "The target connection is unavailable.",
			Detail:  detail,
		}
	default:
		return &wshrpc.NetworkError{
			Code:    "unknown",
			Message: "Unable to load network interface data.",
			Detail:  detail,
		}
	}
}

func makeNetworkActionError(err error, stdout string, stderr string) *wshrpc.NetworkError {
	detail := strings.TrimSpace(stderr)
	if detail == "" {
		detail = strings.TrimSpace(stdout)
	}
	if detail == "" && err != nil {
		detail = err.Error()
	}
	lowerDetail := strings.ToLower(detail)
	switch {
	case strings.Contains(lowerDetail, "operation not permitted"), strings.Contains(lowerDetail, "permission denied"):
		return &wshrpc.NetworkError{
			Code:    "permission_denied",
			Message: "当前连接没有修改网卡的权限。",
			Detail:  detail,
		}
	case strings.Contains(lowerDetail, "cannot find device"), strings.Contains(lowerDetail, "device not found"):
		return &wshrpc.NetworkError{
			Code:    "not_found",
			Message: "没有找到对应网卡。",
			Detail:  detail,
		}
	default:
		return &wshrpc.NetworkError{
			Code:    "unknown",
			Message: "网卡操作失败。",
			Detail:  detail,
		}
	}
}

func makeNetworkConfigureError(err error, stdout string, stderr string) *wshrpc.NetworkError {
	detail := strings.TrimSpace(stderr)
	if detail == "" {
		detail = strings.TrimSpace(stdout)
	}
	if detail == "" && err != nil {
		detail = err.Error()
	}
	lowerDetail := strings.ToLower(detail)
	switch {
	case errors.Is(err, exec.ErrNotFound),
		strings.Contains(lowerDetail, "resolvectl: command not found"),
		strings.Contains(lowerDetail, "'resolvectl' is not recognized"),
		strings.Contains(lowerDetail, "executable file not found"):
		return &wshrpc.NetworkError{
			Code:    "unsupported_dns",
			Message: "当前系统不支持直接修改 DNS，请先调整 IP 和网关。",
			Detail:  detail,
		}
	default:
		return makeNetworkActionError(err, stdout, stderr)
	}
}
