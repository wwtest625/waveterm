package wshremote

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
)

const (
	pciDevicesPath = "/sys/bus/pci/devices/"
	smiSubdir      = "smi"
	maxGpuCount    = 16
	kbPerGb        = 1048576.0
)

type GpuDevice struct {
	Index  int
	BusId  string
	SmiDir string
}

var (
	gpuDevicesCache []GpuDevice
	gpuCacheMu      sync.RWMutex
)

func discoverGpuDevices() []GpuDevice {
	gpuCacheMu.RLock()
	if gpuDevicesCache != nil {
		defer gpuCacheMu.RUnlock()
		return gpuDevicesCache
	}
	gpuCacheMu.RUnlock()

	gpuCacheMu.Lock()
	defer gpuCacheMu.Unlock()

	if gpuDevicesCache != nil {
		return gpuDevicesCache
	}

	entries, err := os.ReadDir(pciDevicesPath)
	if err != nil {
		log.Printf("gpuinfo: failed to read %s: %v\n", pciDevicesPath, err)
		return nil
	}
	log.Printf("gpuinfo: scanning %s, found %d entries\n", pciDevicesPath, len(entries))

	var busIds []string
	for _, entry := range entries {
		if !entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
			continue
		}
		smiPath := filepath.Join(pciDevicesPath, entry.Name(), smiSubdir)
		info, err := os.Stat(smiPath)
		if err != nil || !info.IsDir() {
			continue
		}
		log.Printf("gpuinfo: found GPU device at %s (smi dir: %s)\n", entry.Name(), smiPath)
		busIds = append(busIds, entry.Name())
	}

	sort.Strings(busIds)

	var devices []GpuDevice
	for i, busId := range busIds {
		if i >= maxGpuCount {
			break
		}
		devices = append(devices, GpuDevice{
			Index:  i,
			BusId:  busId,
			SmiDir: filepath.Join(pciDevicesPath, busId, smiSubdir),
		})
	}

	gpuDevicesCache = devices
	log.Printf("gpuinfo: discovered %d GPU devices\n", len(devices))
	return devices
}

func readSysfsFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

func parseKeyValueLine(line string) (string, float64, error) {
	parts := strings.SplitN(line, ":", 2)
	if len(parts) != 2 {
		return "", 0, fmt.Errorf("invalid format: %s", line)
	}
	key := strings.TrimSpace(parts[0])
	valStr := strings.TrimSpace(parts[1])
	valStr = strings.TrimSuffix(valStr, " KB")
	valStr = strings.TrimSuffix(valStr, " W")
	valStr = strings.TrimSuffix(valStr, " mW")
	val, err := strconv.ParseFloat(valStr, 64)
	if err != nil {
		return key, 0, err
	}
	return key, val, nil
}

func getGpuTemp(smiDir string) float64 {
	content, err := readSysfsFile(filepath.Join(smiDir, "showtemp"))
	if err != nil {
		return -1
	}
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "hotspot:") {
			_, val, err := parseKeyValueLine(line)
			if err == nil {
				return val / 100.0
			}
		}
	}
	return -1
}

func getGpuMemInfo(smiDir string) (usedGb float64, totalGb float64) {
	memuseContent, err := readSysfsFile(filepath.Join(smiDir, "showmemuse"))
	if err != nil {
		return -1, -1
	}
	meminfoContent, err := readSysfsFile(filepath.Join(smiDir, "showmeminfo"))
	if err != nil {
		return -1, -1
	}

	usedGb = parseVisVram(memuseContent)
	totalGb = parseVisVram(meminfoContent)
	return usedGb, totalGb
}

func parseVisVram(content string) float64 {
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "vis_vram:") {
			_, val, err := parseKeyValueLine(line)
			if err == nil {
				return val / kbPerGb
			}
		}
	}
	return -1
}

func getGpuPower(smiDir string) float64 {
	content, err := readSysfsFile(filepath.Join(smiDir, "showpower"))
	if err != nil {
		return -1
	}

	var socPower, corePower, hbmPower float64
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := scanner.Text()
		key, val, err := parseKeyValueLine(line)
		if err != nil {
			continue
		}
		switch key {
		case "soc power":
			socPower = val / 1000.0
		case "core power":
			corePower = val / 1000.0
		case "hbm power":
			hbmPower = val / 1000.0
		}
	}
	return socPower + corePower + hbmPower
}

func getGpuUtil(smiDir string, gpuIdx int) float64 {
	content, err := readSysfsFile(filepath.Join(smiDir, "showxcuse"))
	if err == nil && content != "" {
		scanner := bufio.NewScanner(strings.NewReader(content))
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "total usage:") {
				parts := strings.SplitN(line, ":", 2)
				if len(parts) == 2 {
					valStr := strings.TrimSpace(parts[1])
					valStr = strings.TrimSuffix(valStr, " %")
					val, err := strconv.ParseFloat(valStr, 64)
					if err == nil {
						return val
					}
				}
			}
		}
	}
	return getGpuUtilFromMxSmi(gpuIdx)
}

func getGpuUtilFromMxSmi(gpuIdx int) float64 {
	return -1
}

func GetGpuData(values map[string]float64) {
	devices := discoverGpuDevices()
	if len(devices) == 0 {
		return
	}
	for _, dev := range devices {
		prefix := fmt.Sprintf("gpu:%d", dev.Index)

		temp := getGpuTemp(dev.SmiDir)
		if temp >= 0 {
			values[prefix+":temp"] = temp
		} else {
			log.Printf("gpuinfo: GPU %d temp read failed (smiDir=%s)\n", dev.Index, dev.SmiDir)
		}

		memUsed, memTotal := getGpuMemInfo(dev.SmiDir)
		if memUsed >= 0 {
			values[prefix+":mem_used"] = memUsed
		}
		if memTotal >= 0 {
			values[prefix+":mem_total"] = memTotal
		}
		if memUsed < 0 || memTotal < 0 {
			log.Printf("gpuinfo: GPU %d mem read failed used=%.2f total=%.2f (smiDir=%s)\n", dev.Index, memUsed, memTotal, dev.SmiDir)
		}

		power := getGpuPower(dev.SmiDir)
		if power >= 0 {
			values[prefix+":power"] = power
		} else {
			log.Printf("gpuinfo: GPU %d power read failed (smiDir=%s)\n", dev.Index, dev.SmiDir)
		}

		util := getGpuUtil(dev.SmiDir, dev.Index)
		if util >= 0 {
			values[prefix+":util"] = util
		} else {
			log.Printf("gpuinfo: GPU %d util read failed (smiDir=%s)\n", dev.Index, dev.SmiDir)
		}
	}
	log.Printf("gpuinfo: collected GPU data for %d devices, values count=%d\n", len(devices), len(values))
}
