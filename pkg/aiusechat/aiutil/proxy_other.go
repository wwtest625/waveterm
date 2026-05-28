// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package aiutil

import (
	"fmt"
	"os"
	"strings"
)

func detectSystemProxy() string {
	return detectProxyFromEnv()
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
