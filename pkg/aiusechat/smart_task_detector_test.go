package aiusechat

import (
	"testing"
)

func TestShouldCreateTodo_ChineseComplexTask(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"部署一个 MySQL 数据库", true},
		{"安装 Redis 缓存", true},
		{"配置 Kubernetes 集群", true},
		{"搭建 Kafka 消息队列", true},
		{"生产环境 Redis 集群", true},
		{"线上 MySQL 数据库高可用", true},
		{"部署生产环境", true},
		{"配置集群高可用", true},
		{"首先检查日志，然后分析错误，最后修复问题", true},
		{"1. 安装依赖 2. 配置环境 3. 启动服务", true},
		{"第一阶段搭建环境，第二阶段配置服务，第三阶段验证", true},
		{"排查性能问题", true},
		{"优化系统资源", true},
		{"升级数据库配置并分析异常日志", true},
		{"批量配置所有服务器", true},
		{"全部应用需要迁移", true},
		{"查看并分析系统日志", true},
		{"检查应用监控状态", true},
		{"系统资源监控分析", true},
		{"服务异常日志排查", true},
		{"查看当前目录", false},
		{"你好", false},
		{"ls -la", false},
		{"帮我了解一下 Docker", false},
		{"查看 MySQL 状态", false},
	}
	for _, tt := range tests {
		result := ShouldCreateTodo(tt.input)
		if result != tt.expected {
			t.Errorf("ShouldCreateTodo(%q) = %v, want %v", tt.input, result, tt.expected)
		}
	}
}

func TestShouldCreateTodo_EnglishComplexTask(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"Deploy a MySQL database cluster", true},
		{"Install Redis and configure it", true},
		{"Setup Kubernetes k8s environment", true},
		{"Configure nginx and prometheus", true},
		{"Migrate PostgreSQL to new server", true},
		{"Bootstrap docker compose services", true},
		{"Production Redis cluster high availability", true},
		{"MySQL database disaster recovery plan", true},
		{"Deploy to production cluster", true},
		{"Configure multi-node environment", true},
		{"First check logs, then analyze errors, finally fix the issue", true},
		{"1. Install deps 2. Configure env 3. Start service", true},
		{"Step one: setup, Step two: deploy, Step three: verify", true},
		{"Check and analyze system logs", true},
		{"Deploy then monitor the application", true},
		{"Monitor server resource usage and errors", true},
		{"Analyze database performance issues", true},
		{"Batch configure all servers", true},
		{"Multiple application database migration", true},
		{"Troubleshoot system performance problems", true},
		{"Diagnose application failure issues", true},
		{"Deploy application to production server", true},
		{"Backup and restore database system", true},
		{"Which application process is using high memory", true},
		{"Examine log files for errors", true},
		{"Check the current directory", false},
		{"Hello", false},
		{"ls -la", false},
		{"Tell me about Docker", false},
		{"Check MySQL status", false},
	}
	for _, tt := range tests {
		result := ShouldCreateTodo(tt.input)
		if result != tt.expected {
			t.Errorf("ShouldCreateTodo(%q) = %v, want %v", tt.input, result, tt.expected)
		}
	}
}

func TestIsHighComplexityIntent_ResourcePatterns(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"部署 zookeeper 集群", true},
		{"配置 rabbitmq 消息队列", true},
		{"安装 consul 服务发现", true},
		{"搭建 etcd 集群", true},
		{"配置 vault 密钥管理", true},
		{"部署 istio 服务网格", true},
		{"配置 traefik 网关", true},
		{"安装 haproxy 负载均衡", true},
		{"配置 keepalived 高可用", true},
		{"部署 jenkins CI 环境", true},
		{"配置 gitlab 代码仓库", true},
		{"搭建 harbor 镜像仓库", true},
		{"安装 prometheus 监控", true},
		{"配置 grafana 仪表盘", true},
		{"配置 ssl 证书", true},
		{"设置 wireguard VPN", true},
		{"配置 openvpn 服务", true},
		{"设置域名 DNS 解析", true},
		{"部署数据库集群", true},
		{"配置消息队列服务", true},
		{"搭建缓存系统", true},
		{"配置网关代理", true},
		{"MySQL 是什么", false},
		{"介绍一下 Redis", false},
	}
	for _, tt := range tests {
		result := isHighComplexityIntent(tt.input)
		if result != tt.expected {
			t.Errorf("isHighComplexityIntent(%q) = %v, want %v", tt.input, result, tt.expected)
		}
	}
}

func TestCountSequenceSignals(t *testing.T) {
	tests := []struct {
		input    string
		expected int
	}{
		{"1. 安装 2. 配置 3. 启动", 3},
		{"一、准备 二、部署 三、验证", 3},
		{"首先安装，然后配置，最后启动", 3},
		{"first install, then configure, finally deploy", 3},
		{"查看日志", 0},
	}
	for _, tt := range tests {
		result := countSequenceSignals(tt.input)
		if result != tt.expected {
			t.Errorf("countSequenceSignals(%q) = %d, want %d", tt.input, result, tt.expected)
		}
	}
}

func TestCountPatternSignals(t *testing.T) {
	tests := []struct {
		input    string
		expected int
	}{
		{"排查性能问题", 1},
		{"批量配置所有服务器", 1},
		{"查看并分析日志", 1},
		{"系统资源监控", 1},
		{"排查问题并分析日志", 2},
	}
	for _, tt := range tests {
		result := countPatternSignals(tt.input)
		if result < tt.expected {
			t.Errorf("countPatternSignals(%q) = %d, want >= %d", tt.input, result, tt.expected)
		}
	}
}

func TestShouldCreateTodo_ShortMessages(t *testing.T) {
	if ShouldCreateTodo("hi") {
		t.Error("short messages should not trigger todo creation")
	}
	if ShouldCreateTodo("") {
		t.Error("empty messages should not trigger todo creation")
	}
	if ShouldCreateTodo("hello") {
		t.Error("very short messages should not trigger todo creation")
	}
}
