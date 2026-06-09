// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package aiutil

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"

	"golang.org/x/sys/windows/registry"
)

func detectSystemProxy() string {
	if proxyURL := detectProxyFromEnv(); proxyURL != "" {
		return proxyURL
	}

	return detectWindowsProxyFromRegistry()
}

func detectProxyFromEnv() string {
	for _, key := range []string{"HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"} {
		if val := os.Getenv(key); val != "" {
			return normalizeProxyURL(val)
		}
	}
	for _, key := range []string{"HTTP_PROXY", "http_proxy"} {
		if val := os.Getenv(key); val != "" {
			return normalizeProxyURL(val)
		}
	}
	return ""
}

func detectWindowsProxyFromRegistry() string {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Internet Settings`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()

	enabled, _, err := k.GetIntegerValue("ProxyEnable")
	if err != nil || enabled == 0 {
		return ""
	}

	proxyServer, _, err := k.GetStringValue("ProxyServer")
	if err != nil || proxyServer == "" {
		return ""
	}

	return parseWindowsProxyServer(proxyServer)
}

func parseWindowsProxyServer(proxyStr string) string {
	parts := strings.Split(proxyStr, ";")

	var httpsProxy, httpProxy string
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		lower := strings.ToLower(part)
		if strings.HasPrefix(lower, "https=") {
			httpsProxy = strings.TrimSpace(part[6:])
		} else if strings.HasPrefix(lower, "http=") {
			httpProxy = strings.TrimSpace(part[5:])
		} else if !strings.Contains(part, "=") {
			httpProxy = part
			httpsProxy = part
		}
	}

	if httpsProxy != "" {
		return normalizeProxyURL(httpsProxy)
	}
	if httpProxy != "" {
		return normalizeProxyURL(httpProxy)
	}
	return ""
}

func normalizeProxyURL(proxyStr string) string {
	proxyStr = strings.TrimSpace(proxyStr)
	if proxyStr == "" {
		return ""
	}
	if !strings.HasPrefix(proxyStr, "http://") && !strings.HasPrefix(proxyStr, "https://") && !strings.HasPrefix(proxyStr, "socks5://") && !strings.HasPrefix(proxyStr, "socks5h://") {
		proxyStr = fmt.Sprintf("http://%s", proxyStr)
	}
	return proxyStr
}

// getWindowsProxyOverride reads the ProxyOverride list from Windows registry.
// Returns the raw semicolon-separated override string, or empty string if not set.
func getWindowsProxyOverride() string {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Internet Settings`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()

	override, _, err := k.GetStringValue("ProxyOverride")
	if err != nil {
		return ""
	}
	return override
}

// shouldBypassProxy checks if the given target URL should bypass the proxy.
// It first checks if the host is a private/local IP address (always bypass),
// then falls back to the Windows ProxyOverride list.
func shouldBypassProxy(targetURL string) bool {
	parsedURL, err := url.Parse(targetURL)
	if err != nil {
		return false
	}

	host := parsedURL.Hostname()
	if host == "" {
		return false
	}

	// Always bypass proxy for localhost
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return true
	}

	// Always bypass proxy for private/local IP addresses
	// (10.x, 172.16-31.x, 192.168.x, 192.x.x.x, 169.254.x, etc.)
	ip := net.ParseIP(host)
	if ip != nil && isPrivateIP(ip) {
		return true
	}

	// Check Windows ProxyOverride list for additional bypass rules
	override := getWindowsProxyOverride()
	if override == "" {
		return false
	}

	entries := strings.Split(override, ";")
	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}

		// <local> tag - already handled by isPrivateIP above
		if entry == "<local>" {
			return true
		}

		// Wildcard pattern matching (e.g., 192.168.*, 127.*)
		if strings.Contains(entry, "*") {
			if matchWildcardPattern(host, entry) != "" {
				return true
			}
			continue
		}

		// Exact match
		if host == entry {
			return true
		}
	}

	return false
}

// isPrivateIP checks if an IP address is in a private/local range.
// Includes RFC 1918 private ranges, link-local, loopback, and the entire
// 192.x.x.x range (commonly used for internal networks).
func isPrivateIP(ip net.IP) bool {
	privateCIDRs := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.0.0.0/8",
		"127.0.0.0/8",
		"169.254.0.0/16",
		"::1/128",
		"fc00::/7",
		"fe80::/10",
	}
	for _, cidr := range privateCIDRs {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			continue
		}
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// matchWildcardPattern matches a host against a wildcard pattern like "192.168.*" or "127.*"
// Windows ProxyOverride patterns like "192.2.*" mean "any host starting with 192.2.",
// so we use prefix matching: all non-wildcard parts from the start must match,
// and a trailing "*" matches the rest.
func matchWildcardPattern(host, pattern string) string {
	patternParts := strings.Split(pattern, ".")
	hostParts := strings.Split(host, ".")

	// Match all non-wildcard parts from the beginning
	for i := range patternParts {
		if patternParts[i] == "*" {
			// Wildcard matches all remaining parts
			return host
		}
		if i >= len(hostParts) {
			return ""
		}
		if patternParts[i] != hostParts[i] {
			return ""
		}
	}

	// All pattern parts matched exactly (no wildcard), host must match exactly
	if len(hostParts) == len(patternParts) {
		return host
	}
	return ""
}
