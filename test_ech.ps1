$ProgressPreference = 'SilentlyContinue'
try {
    $r = Invoke-WebRequest -Uri 'https://anyrouter.top/v1/models' -UseBasicParsing -Headers @{Authorization = 'Bearer test-key'}
    Write-Host "Status: $($r.StatusCode)"
    Write-Host "Content: $($r.Content.Substring(0, [Math]::Min(200, $r.Content.Length)))"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    if ($_.Exception.InnerException) {
        Write-Host "Inner: $($_.Exception.InnerException.Message)"
    }
}
