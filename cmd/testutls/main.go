package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"time"
)

func main() {
	fmt.Println("=== DNS resolution chain ===")
	domains := []string{"anyrouter.top", "bestali.030101.xyz", "bestcf.030101.xyz"}
	for _, d := range domains {
		ips, err := net.LookupHost(d)
		if err != nil {
			fmt.Printf("  %s: lookup failed: %v\n", d, err)
		} else {
			fmt.Printf("  %s: %v\n", d, ips)
		}
	}

	fmt.Println("\n=== Test: Try connecting to different IPs ===")
	ips := []string{"104.17.101.139:443", "104.17.185.207:443", "104.18.10.118:443", "104.18.11.118:443"}
	for _, ip := range ips {
		dialer := &net.Dialer{Timeout: 10 * time.Second}
		conn, err := dialer.DialContext(context.Background(), "tcp", ip)
		if err != nil {
			fmt.Printf("  %s: dial failed: %v\n", ip, err)
			continue
		}

		tlsConn := tls.Client(conn, &tls.Config{
			ServerName:         "anyrouter.top",
			InsecureSkipVerify: true,
		})
		err = tlsConn.HandshakeContext(context.Background())
		if err != nil {
			fmt.Printf("  %s: TLS failed: %v\n", ip, err)
		} else {
			fmt.Printf("  %s: OK!\n", ip)
			tlsConn.Close()
		}
		conn.Close()
	}

	fmt.Println("\n=== Test: Try bestcf.030101.xyz as SNI ===")
	{
		dialer := &net.Dialer{Timeout: 10 * time.Second}
		conn, err := dialer.DialContext(context.Background(), "tcp", "104.17.101.139:443")
		if err != nil {
			fmt.Printf("  Dial failed: %v\n", err)
			return
		}

		tlsConn := tls.Client(conn, &tls.Config{
			ServerName:         "bestcf.030101.xyz",
			InsecureSkipVerify: true,
		})
		err = tlsConn.HandshakeContext(context.Background())
		if err != nil {
			fmt.Printf("  TLS failed: %v\n", err)
		} else {
			fmt.Printf("  OK! Cert: %s\n", tlsConn.ConnectionState().PeerCertificates[0].Subject.CommonName)
			tlsConn.Close()
		}
		conn.Close()
	}
}
