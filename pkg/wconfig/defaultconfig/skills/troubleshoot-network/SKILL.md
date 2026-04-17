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
