// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package aiutil

import (
	"fmt"
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
